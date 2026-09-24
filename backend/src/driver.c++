#include <cctype>
#include <iostream>
#include <string>
#include <vector>

#include "chess/move.h"
#include "chess/moveGenerator.h"
#include "chess/position.h"

namespace {

std::string colorName(Color color)
{
    return color == White ? "White" : "Black";
}

bool parseSquare(const std::string& text, Square& square)
{
    if(text.size() != 2) return false;

    char fileChar = static_cast<char>(std::tolower(text[0]));
    char rankChar = text[1];

    if(fileChar < 'a' || fileChar > 'h') return false;
    if(rankChar < '1' || rankChar > '8') return false;

    int file = fileChar - 'a';
    int rank = rankChar - '1';

    square = static_cast<Square>(rank * 8 + file);
    return true;
}

bool findMove(
    const std::vector<Move>& moves,
    Square from,
    Square to,
    Move& selectedMove
)
{
    for(const Move& move : moves){
        if(move.startSquare == from && move.stopSquare == to){
            selectedMove = move;
            return true;
        }
    }

    return false;
}

void removeCapturedPiece(Position& board, Color movingColor, Square square)
{
    Color enemyColor = movingColor == White ? Black : White;

    for(int piece = Pawn; piece <= King; piece++){
        PieceType pieceType = static_cast<PieceType>(piece);

        if(board.hasPiece(enemyColor, pieceType, square)){
            board.removePiece(enemyColor, pieceType, square);
            return;
        }
    }
}

void applyMove(Position& board, const Move& move)
{
    removeCapturedPiece(board, move.pieceColor, move.stopSquare);

    board.removePiece(move.pieceColor, move.piece, move.startSquare);
    board.setPiece(move.pieceColor, move.piece, move.stopSquare);

    board.sideToMove = board.sideToMove == White ? Black : White;
}

void printHelp()
{
    std::cout << "Enter moves as two squares, like: e2 e4\n";
    std::cout << "Type quit to stop the demo.\n";
    std::cout << "This demo uses pseudo-legal moves, so check and checkmate are not enforced yet.\n\n";
}

}

int main()
{
    Position board = Position::startingPosition();

    std::cout << "Player vs Player Chess Demo\n";
    printHelp();

    while(true){
        board.printPieces();
        std::cout << colorName(board.sideToMove) << " to move: ";

        std::string fromText;
        std::cin >> fromText;

        if(!std::cin || fromText == "quit" || fromText == "Quit"){
            break;
        }

        std::string toText;
        std::cin >> toText;

        Square from;
        Square to;

        if(!parseSquare(fromText, from) || !parseSquare(toText, to)){
            std::cout << "Invalid input. Use a move like e2 e4.\n\n";
            continue;
        }

        std::vector<Move> legalMoves = MoveGenerator::generateMoves(board);
        Move selectedMove;

        if(!findMove(legalMoves, from, to, selectedMove)){
            std::cout << "That move is not available for " << colorName(board.sideToMove) << ".\n\n";
            continue;
        }

        applyMove(board, selectedMove);
        std::cout << '\n';
    }

    std::cout << "Game ended.\n";
    return 0;
}
