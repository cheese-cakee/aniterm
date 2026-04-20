#include "aniterm.hpp"
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

static const char* BANNER = R"(
 █████╗ ███╗   ██╗██╗████████╗███████╗██████╗ ███╗   ███╗
██╔══██╗████╗  ██║██║╚══██╔══╝██╔════╝██╔══██╗████╗ ████║
███████║██╔██╗ ██║██║   ██║   █████╗  ██████╔╝██╔████╔██║
██╔══██║██║╚██╗██║██║   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║
██║  ██║██║ ╚████║██║   ██║   ███████╗██║  ██║██║ ╚═╝ ██║
╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
)";

static const char* VERSION = "2.0.0";

static const char* USAGE = R"(
usage:
  aniterm [options] [video-or-url ...]

options:
  --fps <n>            target fps (default: source fps)
  --no-audio           disable audio playback
  --contrast <n>       contrast multiplier (default: 1.2)
  --brightness <n>     brightness offset  (default: 0.0)
  --gamma <n>          gamma correction   (default: 0.9)
  --no-clahe           disable CLAHE enhancement
  --no-sharpen         disable edge sharpening
  --max-cols <n>       limit terminal columns
  --max-rows <n>       limit terminal rows
  --dither <0|1|2>     0=none 1=floyd-steinberg 2=atkinson (default: 1)
  -h, --help           show this help
  -v, --version        show version

controls during playback:
  /p   pause / resume
  /q   quit
  /r   replay current video
  /add <path>   add to queue
  /menu         show queue
  /h            show help
)";

static const char* MENU_TEXT = R"(
  play      play a video (path or URL)
  add       add video to queue
  playall   play the queue
  list      show queue
  remove    remove from queue
  clear     clear queue
  quit      exit
)";

static double parse_double(const char* s, double fallback) {
    try { return std::stod(s); } catch (...) { return fallback; }
}
static int parse_int(const char* s, int fallback) {
    try { return std::stoi(s); } catch (...) { return fallback; }
}

int main(int argc, char* argv[]) {
    PlayOptions opts;
    std::vector<std::string> inputs;
    bool show_help = false, show_version = false;

    for (int i = 1; i < argc; i++) {
        std::string tok = argv[i];
        auto next = [&]() -> const char* {
            return (i + 1 < argc) ? argv[++i] : "0";
        };

        if      (tok == "-h" || tok == "--help")       show_help    = true;
        else if (tok == "-v" || tok == "--version")    show_version = true;
        else if (tok == "--no-audio")                  opts.no_audio = true;
        else if (tok == "--no-clahe")                  opts.render.use_clahe    = false;
        else if (tok == "--no-sharpen")                opts.render.edge_sharpen = false;
        else if (tok == "--fps")        opts.render.target_fps  = parse_double(next(), 0);
        else if (tok == "--contrast")   opts.render.contrast    = parse_double(next(), 1.2);
        else if (tok == "--brightness") opts.render.brightness  = parse_double(next(), 0);
        else if (tok == "--gamma")      opts.render.gamma       = parse_double(next(), 0.9);
        else if (tok == "--max-cols")   opts.max_cols           = parse_int(next(), 0);
        else if (tok == "--max-rows")   opts.max_rows           = parse_int(next(), 0);
        else if (tok == "--dither")     opts.render.dither      = parse_int(next(), 1);
        else if (!tok.empty() && tok[0] != '-') inputs.push_back(tok);
        else std::cerr << "unknown option: " << tok << "\n";
    }

    if (show_version) { printf("aniterm v%s\n", VERSION); return 0; }

    printf("%s%s%s", RED, BANNER, RESET);
    printf("%s%s  anime openings and videos in your terminal\n", DIM, RED);
    printf("  /p pause  /q quit  /h help%s\n\n", RESET);

    if (show_help) { puts(USAGE); return 0; }

    // Direct play mode
    if (!inputs.empty()) {
        std::vector<QueueItem> queue;
        for (auto& inp : inputs) {
            auto label = inp.substr(inp.find_last_of("/\\") + 1);
            queue.push_back({inp, label});
        }
        play_queue(queue, opts);
        return 0;
    }

    // Interactive menu mode
    std::vector<QueueItem> queue;
    bool running = true;

    while (running) {
        puts(MENU_TEXT);
        printf("  > "); fflush(stdout);

        std::string choice;
        if (!std::getline(std::cin, choice)) break;
        while (!choice.empty() && (choice.back() == '\r' || choice.back() == '\n'))
            choice.pop_back();

        auto get_input = [](const char* prompt) -> std::string {
            printf("%s", prompt); fflush(stdout);
            std::string s;
            if (!std::getline(std::cin, s)) return "";
            while (!s.empty() && (s.back() == '\r' || s.back() == '\n')) s.pop_back();
            return s;
        };

        if (choice == "quit" || choice == "q") {
            running = false;
        } else if (choice == "play") {
            std::string inp = get_input("  path or url: ");
            if (!inp.empty()) {
                auto label = inp.substr(inp.find_last_of("/\\") + 1);
                std::vector<QueueItem> single = {{inp, label}};
                play_queue(single, opts);
            }
        } else if (choice == "add") {
            std::string inp = get_input("  path or url: ");
            if (!inp.empty()) {
                auto label = inp.substr(inp.find_last_of("/\\") + 1);
                queue.push_back({inp, label});
                printf("  added: %s (%zu in queue)\n", label.c_str(), queue.size());
            }
        } else if (choice == "playall") {
            if (queue.empty()) puts("  queue is empty");
            else play_queue(queue, opts);
        } else if (choice == "list") {
            if (queue.empty()) puts("  queue is empty");
            else for (size_t i = 0; i < queue.size(); i++)
                printf("    %zu. %s\n", i + 1, queue[i].label.c_str());
        } else if (choice == "remove") {
            if (queue.empty()) { puts("  queue is empty"); continue; }
            for (size_t i = 0; i < queue.size(); i++)
                printf("    %zu. %s\n", i + 1, queue[i].label.c_str());
            std::string n_str = get_input("  remove number: ");
            try {
                int n = std::stoi(n_str) - 1;
                if (n >= 0 && n < (int)queue.size()) {
                    printf("  removed: %s\n", queue[n].label.c_str());
                    queue.erase(queue.begin() + n);
                } else puts("  invalid number");
            } catch (...) { puts("  invalid number"); }
        } else if (choice == "clear") {
            queue.clear();
            puts("  queue cleared");
        } else if (!choice.empty()) {
            puts("  unknown command");
        }
        putchar('\n');
    }

    puts("  bye");
    return 0;
}
