#include <iostream>
#include "chess/position.h"

int main(){
    Position board = Position::startingPosition();
    board.printPieces();
    return 0;
}