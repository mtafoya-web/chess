#pragma once
#include "piece.h"

struct Move{
    Piece piece;
    Square startSquare;
    Square stopSquare;
};