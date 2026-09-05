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

add_library(chess_position INTERFACE)

target_sources(chess_position INTERFACE
    src/position.h
    src/square.h
)

target_include_directories(chess_position INTERFACE src)

add_executable(position_test
    test/position_test.cpp
)

target_link_libraries(position_test PRIVATE
    chess_position
    GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(position_test)