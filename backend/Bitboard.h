#pragma once
#include <cstdint>

class Bitboard{
    private:
        /* 8x8 board*/
        uint64_t bits = 0;

        static bool isValidSquare(int square);
    public:
        void set(int square);
        void clear(int square);
        bool test(int square) const;

        uint64_t value() const;
};
