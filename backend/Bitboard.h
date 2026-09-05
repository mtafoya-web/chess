#pragma once
#include <cstdint>

class Bitboard{
    private:
        /* 8x8 board all set to 0*/
        uint64_t bits = 0;

        // True if square is in the 0..63 bit range.
        static bool isValidSquare(int square);
    public:
        // Set a square bit to 1.
        void set(int square);
        // Clear a square bit to 0.
        void clear(int square);
        // Return whether a square bit is set.
        bool test(int square) const;
        // Return the raw bitboard value.
        uint64_t value() const;
};
