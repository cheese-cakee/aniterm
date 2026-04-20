#include "aniterm.hpp"
#include <algorithm>
#include <cmath>
#include <sstream>

// ─── helpers ─────────────────────────────────────────────────────────────────

static inline void append_truecolor_bg(std::string& s, int r, int g, int b) {
    s += "\x1b[48;2;";
    s += std::to_string(r); s += ';';
    s += std::to_string(g); s += ';';
    s += std::to_string(b); s += 'm';
}

static inline void append_truecolor_fg(std::string& s, int r, int g, int b) {
    s += "\x1b[38;2;";
    s += std::to_string(r); s += ';';
    s += std::to_string(g); s += ';';
    s += std::to_string(b); s += 'm';
}

// Boost channel with gamma correction
static inline uchar boost_channel(uchar val, double gamma) {
    double n = val / 255.0;
    return static_cast<uchar>(std::clamp(std::pow(n, gamma) * 255.0, 0.0, 255.0));
}

// ─── Preprocessing: contrast + CLAHE + edge sharpen ──────────────────────────

static cv::Mat preprocess(const cv::Mat& frame, const RenderOptions& opts) {
    cv::Mat out = frame.clone();

    // Contrast / brightness
    if (opts.contrast != 1.0 || opts.brightness != 0.0) {
        double c = std::clamp(opts.contrast, 0.1, 10.0);
        double b = std::clamp(opts.brightness, -100.0, 100.0);
        frame.convertTo(out, -1, c, b);
    }

    if (!opts.use_clahe && !opts.edge_sharpen)
        return out;

    if (opts.use_clahe) {
        cv::Mat lab;
        cv::cvtColor(out, lab, cv::COLOR_BGR2Lab);
        std::vector<cv::Mat> channels(3);
        cv::split(lab, channels);
        auto clahe = cv::createCLAHE(1.5, cv::Size(8, 8));
        clahe->apply(channels[0], channels[0]);
        cv::merge(channels, lab);
        cv::cvtColor(lab, out, cv::COLOR_Lab2BGR);
    }

    if (opts.edge_sharpen) {
        cv::Mat gray, grad_x, grad_y, gradient, edge_mask;
        cv::cvtColor(out, gray, cv::COLOR_BGR2GRAY);
        cv::Sobel(gray, grad_x, CV_32F, 1, 0, 3);
        cv::Sobel(gray, grad_y, CV_32F, 0, 1, 3);
        cv::magnitude(grad_x, grad_y, gradient);
        cv::threshold(gradient, edge_mask, 30, 1.0, cv::THRESH_BINARY);
        edge_mask.convertTo(edge_mask, CV_32F);

        cv::Mat sharp_kernel = (cv::Mat_<float>(3,3) << 0,-0.2f,0, -0.2f,1.8f,-0.2f, 0,-0.2f,0);
        cv::Mat gentle_kernel = (cv::Mat_<float>(3,3) << 0,-0.05f,0, -0.05f,1.2f,-0.05f, 0,-0.05f,0);
        cv::Mat sharp_out, gentle_out;
        cv::filter2D(out, sharp_out,  out.depth(), sharp_kernel);
        cv::filter2D(out, gentle_out, out.depth(), gentle_kernel);

        for (int y = 0; y < out.rows; y++) {
            for (int x = 0; x < out.cols; x++) {
                float e = edge_mask.at<float>(y, x);
                cv::Vec3b orig   = out.at<cv::Vec3b>(y, x);
                cv::Vec3b sharp  = sharp_out.at<cv::Vec3b>(y, x);
                cv::Vec3b gentle = gentle_out.at<cv::Vec3b>(y, x);
                cv::Vec3b res;
                for (int c = 0; c < 3; c++) {
                    float blended = e * sharp[c] + (1.f - e) * gentle[c];
                    res[c] = static_cast<uchar>(
                        std::clamp(0.8f * orig[c] + 0.2f * blended, 0.f, 255.f));
                }
                out.at<cv::Vec3b>(y, x) = res;
            }
        }
    }

    return out;
}

// ─── Halfblock renderer (▀ upper/lower half) with gamma ──────────────────────
// frame: BGR, size = width x (height*2)

std::string render_frame(const cv::Mat& src_frame, const RenderOptions& opts) {
    cv::Mat frame = preprocess(src_frame, opts);

    const int w   = frame.cols;
    const int h2  = frame.rows;       // h2 = display_rows * 2
    const int h   = h2 / 2;

    std::string out;
    out.reserve(w * h * 40);

    for (int row = 0; row < h; row++) {
        for (int x = 0; x < w; x++) {
            int y_top    = row * 2;
            int y_bottom = row * 2 + 1;
            if (y_bottom >= h2) y_bottom = y_top;

            cv::Vec3b top    = frame.at<cv::Vec3b>(y_top,    x);
            cv::Vec3b bottom = frame.at<cv::Vec3b>(y_bottom, x);

            // Apply gamma; BGR → RGB for ANSI
            int tr = boost_channel(top[2],    opts.gamma);
            int tg = boost_channel(top[1],    opts.gamma);
            int tb = boost_channel(top[0],    opts.gamma);
            int br = boost_channel(bottom[2], opts.gamma);
            int bg = boost_channel(bottom[1], opts.gamma);
            int bb = boost_channel(bottom[0], opts.gamma);

            // fg = top (▀ upper half), bg = bottom
            append_truecolor_fg(out, tr, tg, tb);
            append_truecolor_bg(out, br, bg, bb);
            out += "\xe2\x96\x80";  // ▀ UTF-8
        }
        out += RESET;
        out += '\n';
    }

    return out;
}

// ─── FrameQueue ───────────────────────────────────────────────────────────────

FrameQueue::FrameQueue(int capacity) : cap_(capacity) {}

void FrameQueue::push(FrameEntry entry) {
    std::unique_lock<std::mutex> lk(mu_);
    cv_push_.wait(lk, [&]{ return (int)q_.size() < cap_ || done_; });
    if (done_) return;
    q_.push_back(std::move(entry));
    cv_pop_.notify_one();
}

bool FrameQueue::pop(FrameEntry& out) {
    std::unique_lock<std::mutex> lk(mu_);
    cv_pop_.wait(lk, [&]{ return !q_.empty() || done_; });
    if (q_.empty()) return false;
    out = std::move(q_.front());
    q_.pop_front();
    cv_push_.notify_one();
    return true;
}

void FrameQueue::mark_done() {
    std::unique_lock<std::mutex> lk(mu_);
    done_ = true;
    cv_pop_.notify_all();
    cv_push_.notify_all();
}

void FrameQueue::clear() {
    std::unique_lock<std::mutex> lk(mu_);
    q_.clear();
    cv_push_.notify_all();
}

bool FrameQueue::is_done() const {
    std::unique_lock<std::mutex> lk(mu_);
    return done_ && q_.empty();
}

int FrameQueue::size() const {
    std::unique_lock<std::mutex> lk(mu_);
    return static_cast<int>(q_.size());
}
