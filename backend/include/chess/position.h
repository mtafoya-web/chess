/*
    This class contains the minimal base information to
    derive a full chess position.
*/
#pragma once
#include <cstdint>
#include <string>
#include "square.h"
#include "piece.h"
#include <vector>
#include <optional>

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
    blackLong = 1 << 3,
};




struct Position {
    /* The enum values are used as indices to access piece data
        E.g to get the bitboard for black knights:
        std::uint64_t blackKnights = pieces[Black][Knight]
    */
    std::uint64_t pieces[2][6]{};

    Color sideToMove = White;
    std::uint8_t castlingRights = noCastle;

    // -1 = no en passant
    int enPassantSquare = -1;
    // Resets after pawn move or capture played
    int halfmoveClock = 0;
    int fullmoveCount = 1;

    static Position startingPosition();
    bool hasPiece(Piece piece, Square square) const;
    void setPiece(Piece piece, Square square);
    void removePiece(Piece piece, Square square);
    void removePiece(Square square);
    std::optional<Piece> getPiece(Square square) const;
    std::vector<Square> getPieceLocations(Piece piece) const;
    void printPieces() const;
    std::string pieceAt(Square square) const;
};
