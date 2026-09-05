/*
    This class contains the minimal base information to 
    derive a full chess position. 
*/
#pragma once
#include <cstdint>

enum Color {
    White = 0,
    Black = 1
};

enum PieceType {
    Pawn = 0,
    Knight = 1,
    Bishop = 2,
    Rook = 3,
    Queen = 4,
    King = 5
};
/*
    Bit position determines castle rights.
    A game with full castle rights would be 00001111.
    A game with only white castling rights would be 00000011.
*/
enum CastlingRights : std::uint8_t{
    noCastle = 0,
    whiteShort = 1 << 0,
    whiteLong = 1 << 1,
    blackShort = 1 << 2,
    blackLong =  1 << 3
};

struct Position {
    /* The enum values are used as indices to access piece data
        E.g to get the bitboard for black knights:
        std::uint64_t blackKnights = pieces[Color:Black][PieceType:Knight] 
    */
    std::uint64_t pieces[2][6];

    Color sideToMove;
    CastlingRights castlingRights;

    // -1 = no en passant 
    int enPassantSquare;

    // Resets after non-repeatable move is played
    int halfmoveClock;

    int fullmoveCount;
};
