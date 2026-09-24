#pragma once
#include "piece.h"
#include "square.h"

struct Move{
    Piece piece;
    Square startSquare;
    Square stopSquare;
};
