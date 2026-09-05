#include <iostream>
#include "chess/position.h"

int main(){
    Position board = Position::initPosition();
    board.printPieces();
    return 0;
}