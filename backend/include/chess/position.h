/*
    This class contains the minimal base information to
    derive a full chess position.
*/
#pragma once
#include <cstdint>
#include <string>
#include "chess/square.h"

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
enum CastlingRights : std::uint8_t {
    noCastle = 0,
    whiteShort = 1 << 0,
    whiteLong = 1 << 1,
    blackShort = 1 << 2,
    blackLong = 1 << 3
};

struct Position {
    /* The enum values are used as indices to access piece data
        E.g to get the bitboard for black knights:
        std::uint64_t blackKnights = pieces[Color:Black][PieceType:Knight]
    */
    std::uint64_t pieces[2][6]{};

    Color sideToMove = White;
    std::uint8_t castlingRights = noCastle;

    // -1 = no en passant
    int enPassantSquare = -1;
    // Resets after non-repeatable move is played
    int halfmoveClock = 0;
    int fullmoveCount = 1;

    static Position startingPosition();
    std::uint64_t squareMask(Square square) const;
    bool hasPiece(Color color, PieceType type, Square square) const;
    void setPiece(Color color, PieceType type, Square square);
    void removePiece(Color color, PieceType type, Square square);
    void printPieces() const;
    std::string pieceAt(Square square) const;
};
