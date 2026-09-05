#include "Bitboard.h"

void Bitboard::set(int square)
{
    if (square < 0 || square > 63){
        return;
    }
    bits |= (1ULL << square)
}

void Bitboard::clear(int square){
    if (square < 0 || square > 63){
        return;
    }

    bits &= ~(1ULL << square)
}

void Bitboard::test(int square) const{
    if (square < 0 || square > 63){
        return;
    }
    return (bits & (1ULL << square)) != 0;
}