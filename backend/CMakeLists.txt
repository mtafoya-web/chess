cmake_minimum_required(VERSION 3.20)

project(chess_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)

FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.zip
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

enable_testing()

add_library(chess_position STATIC
    src/position.c++
    src/driver.c++
)

target_include_directories(chess_position PUBLIC
    include
    include/chess
)

target_sources(chess_position PUBLIC
    include/chess/position.h
    include/chess/square.h
)
add_executable(position_test
    test/position_test.cpp
)

target_include_directories(position_test PRIVATE
    include
    include/chess
)

target_link_libraries(position_test PRIVATE
    chess_position
    GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(position_test)
