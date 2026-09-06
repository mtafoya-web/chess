#pragma once
#include "position.h"

struct Move{
    Color pieceColor;
    PieceType piece;
    Square startSquare;
    Square stopSquare;
};