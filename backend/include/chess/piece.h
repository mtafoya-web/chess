#pragma once

enum Color {
    White = 0,
    Black = 1,
    ColorEnd = 2
};

enum PieceType {
    Pawn = 0,
    Knight = 1,
    Bishop = 2,
    Rook = 3,
    Queen = 4,
    King = 5,
    PieceTypeEnd = 6
};

struct Piece{
    Color color;
    PieceType type;       
};