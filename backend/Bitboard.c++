#include "Bitboard.h"

bool Bitboard::isValidSquare(int square)
{
    return square >= 0 && square < 64;
}

void Bitboard::set(int square)
{
    if (!isValidSquare(square)) {
        return;
    }
    bits |= (1ULL << square);
}

void Bitboard::clear(int square)
{
    if (!isValidSquare(square)) {
        return;
    }

    bits &= ~(1ULL << square);
}

bool Bitboard::test(int square) const
{
    if (!isValidSquare(square)) {
        return false;
    }
    return (bits & (1ULL << square)) != 0;
}

uint64_t Bitboard::value() const
{
    return bits;
}
