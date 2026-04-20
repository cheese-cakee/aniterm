#include "aniterm.hpp"
#include <csignal>
#include <cstdlib>
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

void AudioHandle::stop() {
    if (pid > 0) {
        kill(pid, SIGTERM);
        waitpid(pid, nullptr, WNOHANG);
        pid = -1;
    }
}

void AudioHandle::toggle_pause() {
    if (pid > 0)
        kill(pid, SIGSTOP);
}

AudioHandle play_audio(const std::string& path) {
    AudioHandle h;
    pid_t p = fork();
    if (p == 0) {
        int null_fd = open("/dev/null", O_RDWR);
        dup2(null_fd, STDOUT_FILENO);
        dup2(null_fd, STDERR_FILENO);
        execlp("ffplay", "ffplay",
               "-nodisp", "-autoexit",
               "-vn",
               "-nostats",
               "-loglevel", "quiet",
               path.c_str(),
               nullptr);
        _exit(1);
    }
    h.pid = p;
    return h;
}
