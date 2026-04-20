#include "aniterm.hpp"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <signal.h>
#include <string>
#include <sys/wait.h>
#include <termios.h>
#include <thread>
#include <unistd.h>
#include <vector>

// ─── Raw-mode input ───────────────────────────────────────────────────────────

struct RawMode {
    struct termios old_termios;
    bool active = false;

    void enter() {
        if (!isatty(STDIN_FILENO)) return;
        tcgetattr(STDIN_FILENO, &old_termios);
        struct termios raw = old_termios;
        raw.c_lflag &= ~(ICANON | ECHO);
        raw.c_cc[VMIN]  = 0;
        raw.c_cc[VTIME] = 0;
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
        active = true;
    }

    void exit_raw() {
        if (active && isatty(STDIN_FILENO)) {
            tcsetattr(STDIN_FILENO, TCSAFLUSH, &old_termios);
            active = false;
        }
    }

    ~RawMode() { exit_raw(); }
};

// ─── Input state shared between input thread and render loop ─────────────────

struct InputState {
    std::string buffer;
    std::atomic<bool> quit{false};
    std::atomic<bool> pause{false};
    std::atomic<bool> replay{false};
    std::string add_path;
    std::atomic<bool> show_menu{false};
    std::atomic<bool> show_help{false};
    std::mutex mu;
};

static void process_command(const std::string& cmd, InputState& state,
                             std::vector<QueueItem>& queue) {
    if (cmd.empty() || cmd[0] != '/') return;

    std::string rest = cmd.substr(1);
    auto sp   = rest.find(' ');
    std::string verb = (sp == std::string::npos) ? rest : rest.substr(0, sp);
    std::string arg  = (sp == std::string::npos) ? "" : rest.substr(sp + 1);
    for (auto& c : verb) c = tolower(c);

    if      (verb == "q" || verb == "quit")   state.quit   = true;
    else if (verb == "p" || verb == "pause")  state.pause  = !state.pause;
    else if (verb == "r" || verb == "replay") state.replay = true;
    else if (verb == "h" || verb == "help")   state.show_help = true;
    else if (verb == "menu")                  state.show_menu = true;
    else if (verb == "add" && !arg.empty()) {
        std::lock_guard<std::mutex> lk(state.mu);
        state.add_path = arg;
    }
}

static void input_thread_fn(InputState& state, std::vector<QueueItem>& queue) {
    char c;
    while (!state.quit) {
        ssize_t n = read(STDIN_FILENO, &c, 1);
        if (n <= 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }
        if (c == '\r' || c == '\n') {
            std::string cmd;
            { std::lock_guard<std::mutex> lk(state.mu); cmd = state.buffer; state.buffer.clear(); }
            process_command(cmd, state, queue);
        } else if (c == 127 || c == '\b') {
            std::lock_guard<std::mutex> lk(state.mu);
            if (!state.buffer.empty()) state.buffer.pop_back();
        } else if (c >= 32 && c <= 126) {
            std::lock_guard<std::mutex> lk(state.mu);
            state.buffer += c;
        }
    }
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

static std::string render_progress(double elapsed, double total, int cols, bool paused) {
    if (total <= 0) return "";
    int bar_w = std::max(10, cols - 32);
    double ratio  = std::clamp(elapsed / total, 0.0, 1.0);
    int    filled = static_cast<int>(ratio * bar_w);

    auto fmt_time = [](double t) -> std::string {
        int s = static_cast<int>(t);
        char buf[16];
        snprintf(buf, sizeof(buf), "%d:%02d", s / 60, s % 60);
        return buf;
    };

    std::string bar;
    bar += RED;
    bar += paused ? " \xe2\x8f\xb8 " : " \xe2\x96\xb6 ";  // ⏸ or ▶
    bar += RESET;
    bar += "[";
    for (int i = 0; i < bar_w; i++)
        bar += (i < filled) ? "\xe2\x96\x88" : "\xe2\x94\x80";  // █ or ─
    bar += "] ";
    bar += fmt_time(elapsed) + "/" + fmt_time(total);
    bar += "  /p /q /r /h";
    return bar;
}

// ─── Core playback (one file) ─────────────────────────────────────────────────

static std::string play_one_impl(const std::string& file_path,
                                  std::vector<QueueItem>& queue,
                                  const PlayOptions& opts,
                                  InputState& state) {
    cv::VideoCapture cap;
    cap.open(file_path);
    if (!cap.isOpened()) {
        std::cerr << RED << "error: cannot open: " << file_path << RESET << "\n";
        return "next";
    }

    double fps       = cap.get(cv::CAP_PROP_FPS);
    double total_dur = cap.get(cv::CAP_PROP_FRAME_COUNT) / (fps > 0 ? fps : 30.0);
    if (fps <= 0) fps = 30.0;
    double actual_fps  = (opts.render.target_fps > 0) ? opts.render.target_fps : fps;

    // Compute render dimensions
    TermSize ts  = get_term_size();
    int cols     = opts.max_cols > 0 ? std::min(ts.cols, opts.max_cols) : ts.cols;
    int rows     = opts.max_rows > 0 ? std::min(ts.rows, opts.max_rows) : ts.rows;
    int rend_rows = std::max(2, rows - 2);  // reserve rows for progress bar

    double vid_w = cap.get(cv::CAP_PROP_FRAME_WIDTH);
    double vid_h = cap.get(cv::CAP_PROP_FRAME_HEIGHT);
    if (vid_w <= 0) vid_w = 1280;
    if (vid_h <= 0) vid_h = 720;

    // Each terminal char = 2 pixel rows (halfblock), so account for that
    double aspect = vid_w / vid_h;
    int rw = cols;
    int rh = static_cast<int>(rw / aspect / 0.5);
    if (rh > rend_rows) {
        rh = rend_rows;
        rw = static_cast<int>(rh * aspect * 0.5);
    }
    rw = std::max(1, rw);
    rh = std::max(1, rh);

    RenderOptions ropts = opts.render;
    ropts.width  = rw;
    ropts.height = rh;

    // Start audio
    AudioHandle audio;
    if (!opts.no_audio)
        audio = play_audio(file_path);

    // Frame queue + decoder thread
    FrameQueue fq(32);
    std::thread decoder([&]() {
        cv::Mat frame, resized;
        double src_frame_idx = 0;
        while (cap.read(frame)) {
            if (state.quit || state.replay) break;

            // Frame-drop for target_fps < source fps
            src_frame_idx++;
            if (opts.render.target_fps > 0 && fps > 0 && fps > actual_fps) {
                double skip = fps / actual_fps;
                if (fmod(src_frame_idx, skip) >= 1.0 && skip > 1.5) continue;
            }

            cv::resize(frame, resized, cv::Size(rw, rh * 2), 0, 0, cv::INTER_AREA);
            double pts = cap.get(cv::CAP_PROP_POS_MSEC) / 1000.0;
            fq.push({resized.clone(), pts});

            // Spin while paused
            while (state.pause && !state.quit && !state.replay)
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
        fq.mark_done();
    });

    // Render loop
    auto wall_start  = std::chrono::steady_clock::now();
    auto paused_dur  = std::chrono::nanoseconds{0};
    std::chrono::time_point<std::chrono::steady_clock> pause_start;
    bool was_paused  = false;

    fwrite(CLEAR_SCREEN, 1, strlen(CLEAR_SCREEN), stdout);
    fwrite(HIDE_CURSOR,  1, strlen(HIDE_CURSOR),  stdout);

    FrameEntry fe;
    while (fq.pop(fe)) {
        if (state.quit || state.replay) break;

        // Handle pause
        if (state.pause) {
            if (!was_paused) {
                pause_start = std::chrono::steady_clock::now();
                was_paused  = true;
                if (audio.pid > 0) kill(audio.pid, SIGSTOP);
            }
            while (state.pause && !state.quit && !state.replay)
                std::this_thread::sleep_for(std::chrono::milliseconds(30));
            if (was_paused) {
                paused_dur += std::chrono::steady_clock::now() - pause_start;
                was_paused  = false;
                if (audio.pid > 0) kill(audio.pid, SIGCONT);
            }
        }

        // Handle /add command
        {
            std::lock_guard<std::mutex> lk(state.mu);
            if (!state.add_path.empty()) {
                std::string p = state.add_path;
                state.add_path.clear();
                auto label = p.substr(p.find_last_of("/\\") + 1);
                queue.push_back({p, label});
            }
        }

        // PTS-based frame pacing
        auto now         = std::chrono::steady_clock::now();
        double elapsed_s = ((now - wall_start) - paused_dur).count() / 1e9;
        double wait_s    = fe.pts - elapsed_s;
        if (wait_s > 0.002)
            std::this_thread::sleep_for(
                std::chrono::microseconds(static_cast<long long>(wait_s * 1e6)));

        // Build and write full frame in one syscall
        std::string rendered = render_frame(fe.mat, ropts);
        now       = std::chrono::steady_clock::now();
        elapsed_s = ((now - wall_start) - paused_dur).count() / 1e9;

        std::string prog    = render_progress(elapsed_s, total_dur, cols, (bool)state.pause);
        std::string buf_str = HOME;
        buf_str += rendered;
        buf_str += "\x1b[2K";  // clear current line
        buf_str += prog;
        buf_str += "  ";
        { std::lock_guard<std::mutex> lk(state.mu); buf_str += state.buffer; }

        fwrite(buf_str.c_str(), 1, buf_str.size(), stdout);
        fflush(stdout);
    }

    decoder.join();
    audio.stop();
    fwrite(SHOW_CURSOR, 1, strlen(SHOW_CURSOR), stdout);

    if (state.quit)   return "quit";
    if (state.replay) return "replay";
    return "next";
}

// ─── Public API ───────────────────────────────────────────────────────────────

std::string play_one(const QueueItem& item,
                     std::vector<QueueItem>& queue,
                     const PlayOptions& opts) {
    std::string resolved = resolve_source(item.source);
    if (resolved.empty()) {
        std::cerr << RED << "error: could not resolve: " << item.source << RESET << "\n";
        return "next";
    }

    RawMode raw;
    raw.enter();

    InputState state;
    std::thread inp(input_thread_fn, std::ref(state), std::ref(queue));

    printf("%s  now playing: %s%s\n", RED, item.label.c_str(), RESET);

    std::string result;
    do {
        state.replay = false;
        result = play_one_impl(resolved, queue, opts, state);
    } while (result == "replay" && !state.quit);

    state.quit = true;
    inp.detach();
    raw.exit_raw();

    // Clean up tmp download
    if (resolved != item.source && resolved.rfind("/tmp/aniterm_", 0) == 0)
        std::remove(resolved.c_str());

    return result;
}

void play_queue(std::vector<QueueItem>& queue, const PlayOptions& opts) {
    for (size_t i = 0; i < queue.size(); ) {
        std::string r = play_one(queue[i], queue, opts);
        if (r == "quit") break;
        if (r == "next") i++;
    }
}
