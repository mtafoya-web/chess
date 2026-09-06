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


# ---------------------------------------------------------
# CHESS CORE LIBRARY
# ---------------------------------------------------------

add_library(chess_core STATIC
    src/position.c++
    src/moveGenerator.c++
)

target_include_directories(chess_core PUBLIC
    include
)

target_sources(chess_core PUBLIC
    include/chess/position.h
    include/chess/square.h
    include/chess/move.h
    include/chess/moveGenerator.h
)


# ---------------------------------------------------------
# DRIVER
# ---------------------------------------------------------

add_executable(chess_driver
    src/driver.c++
)

target_link_libraries(chess_driver PRIVATE
    chess_core
)


# ---------------------------------------------------------
# TESTS
# ---------------------------------------------------------

add_executable(chess_tests
    test/position_test.cpp
)

target_link_libraries(chess_tests PRIVATE
    chess_core
    GTest::gtest_main
)


# ---------------------------------------------------------
# GOOGLE TEST DISCOVERY
# ---------------------------------------------------------

include(GoogleTest)

gtest_discover_tests(chess_tests)

# ---------------------------------------------------------
# CUSTOM TEST RUNNER TARGET
# ---------------------------------------------------------

add_custom_target(run_tests
    COMMAND $<TARGET_FILE:chess_tests>
    DEPENDS chess_tests
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
)