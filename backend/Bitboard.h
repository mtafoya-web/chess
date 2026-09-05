#pragma once
#include <cstdint>

class Bitboard{
    private:
        /* 8x8 board*/
        uint64_t bits = 0;
    public:
        void set(int square);
        void clear(int square);
        void test(int square);

        uint64_t value() const;
}