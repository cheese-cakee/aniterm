cmake_minimum_required(VERSION 3.16)
project(aniterm VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -DNDEBUG")

find_package(OpenCV REQUIRED)
find_package(Threads REQUIRED)

set(SOURCES
    src/main.cpp
    src/terminal.cpp
    src/renderer.cpp
    src/audio.cpp
    src/ytdl.cpp
    src/player.cpp
)

add_executable(aniterm ${SOURCES})
target_include_directories(aniterm PRIVATE src ${OpenCV_INCLUDE_DIRS})
target_link_libraries(aniterm PRIVATE ${OpenCV_LIBS} Threads::Threads)

install(TARGETS aniterm RUNTIME DESTINATION bin)
