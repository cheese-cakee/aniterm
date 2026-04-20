#include "aniterm.hpp"
#include <sys/ioctl.h>
#include <unistd.h>

TermSize get_term_size() {
    struct winsize w;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &w) == 0 && w.ws_col > 0 && w.ws_row > 0)
        return {w.ws_col, w.ws_row};
    return {120, 36};
}
