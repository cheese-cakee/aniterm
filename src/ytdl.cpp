#include "aniterm.hpp"
#include <cstdlib>
#include <ctime>
#include <string>

static bool is_url(const std::string& s) {
    return s.rfind("http://",  0) == 0 ||
           s.rfind("https://", 0) == 0 ||
           s.rfind("ytdl://",  0) == 0;
}

static bool cmd_exists(const char* cmd) {
    std::string check = std::string("command -v ") + cmd + " >/dev/null 2>&1";
    return std::system(check.c_str()) == 0;
}

std::string resolve_source(const std::string& input) {
    if (!is_url(input)) return input;

    if (!cmd_exists("yt-dlp") && !cmd_exists("yt_dlp"))
        return input;  // let OpenCV try the URL directly

    std::string tmp = "/tmp/aniterm_" + std::to_string(std::time(nullptr)) + ".mp4";
    std::string cmd =
        "yt-dlp -f \"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best\" "
        "--merge-output-format mp4 -o \"" + tmp + "\" \"" + input + "\" "
        "> /dev/null 2>&1";

    if (std::system(cmd.c_str()) != 0) {
        cmd = "python3 -m yt_dlp -f \"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best\" "
              "--merge-output-format mp4 -o \"" + tmp + "\" \"" + input + "\" "
              "> /dev/null 2>&1";
        if (std::system(cmd.c_str()) != 0)
            return "";
    }
    return tmp;
}
