#include "chess/moveGenerator.h"

namespace {

bool isOnBoard(int file, int rank)
{
    return file >= 0 && file <= 7 && rank >= 0 && rank <= 7;
}

Square makeSquare(int file, int rank)
{
    return static_cast<Square>(rank * 8 + file);
}

bool isEmpty(const Position& position, Square square)
{
    return position.pieceAt(square) == "--";
}

bool hasAnyPiece(const Position& position, Color color, Square square)
{
    return
        position.hasPiece(color, Pawn, square) ||
        position.hasPiece(color, Knight, square) ||
        position.hasPiece(color, Bishop, square) ||
        position.hasPiece(color, Rook, square) ||
        position.hasPiece(color, Queen, square) ||
        position.hasPiece(color, King, square);
}

bool hasFriendlyPiece(const Position& position, Color color, Square square)
{
    return hasAnyPiece(position, color, square);
}

bool hasEnemyPiece(const Position& position, Color color, Square square)
{
    Color enemyColor = color == White ? Black : White;
    return hasAnyPiece(position, enemyColor, square);
}

void addMove(
    std::vector<Move>& moves,
    Color color,
    PieceType piece,
    Square from,
    Square to
)
{
    moves.push_back({
        color,
        piece,
        from,
        to
    });
}

void addMoveIfAllowed(
    const Position& position,
    std::vector<Move>& moves,
    Color color,
    PieceType piece,
    Square from,
    Square to
)
{
    if(hasFriendlyPiece(position, color, to)) return;

    addMove(moves, color, piece, from, to);
}

void addSlidingMovesInDirection(
    const Position& position,
    std::vector<Move>& moves,
    Color color,
    PieceType piece,
    Square from,
    int startFile,
    int startRank,
    int fileStep,
    int rankStep
)
{
    int targetFile = startFile + fileStep;
    int targetRank = startRank + rankStep;

    while(isOnBoard(targetFile, targetRank)){
        Square to = makeSquare(targetFile, targetRank);

        if(hasFriendlyPiece(position, color, to)) return;

        addMove(moves, color, piece, from, to);

        if(hasEnemyPiece(position, color, to)) return;

        targetFile += fileStep;
        targetRank += rankStep;
    }
}

}

std::vector<Move> MoveGenerator::generateMoves(const Position& position)
{
    std::vector<Move> moves;

    generatePawnMoves(position, moves);
    generateKnightMoves(position, moves);
    generateBishopMoves(position, moves);
    generateRookMoves(position, moves);
    generateQueenMoves(position, moves);
    generateKingMoves(position, moves);

    return moves;
}

void MoveGenerator::generatePawnMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    int forwardStep = color == White ? 8 : -8;

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Pawn, from)) continue;

        int oneSquareForward = square + forwardStep;

        if(oneSquareForward >= A1 && oneSquareForward <= H8){
            Square to = static_cast<Square>(oneSquareForward);

            if(isEmpty(position, to)){
                addMove(moves, color, Pawn, from, to);
            }
        }

        bool onStartingRank =
            (color == White && square >= A2 && square <= H2) ||
            (color == Black && square >= A7 && square <= H7);

        int twoSquaresForward = square + (forwardStep * 2);

        if(onStartingRank && twoSquaresForward >= A1 && twoSquaresForward <= H8){
            Square middle = static_cast<Square>(oneSquareForward);
            Square to = static_cast<Square>(twoSquaresForward);

            if(isEmpty(position, middle) && isEmpty(position, to)){
                addMove(moves, color, Pawn, from, to);
            }
        }

        int fromFile = square % 8;
        int leftCapture = square + forwardStep - 1;
        int rightCapture = square + forwardStep + 1;

        if(fromFile > 0 && leftCapture >= A1 && leftCapture <= H8){
            Square to = static_cast<Square>(leftCapture);

            if(hasEnemyPiece(position, color, to)){
                addMove(moves, color, Pawn, from, to);
            }
        }

        if(fromFile < 7 && rightCapture >= A1 && rightCapture <= H8){
            Square to = static_cast<Square>(rightCapture);

            if(hasEnemyPiece(position, color, to)){
                addMove(moves, color, Pawn, from, to);
            }
        }
    }
}

void MoveGenerator::generateKnightMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;

    int fileOffsets[8] = { 1, 2, 2, 1, -1, -2, -2, -1 };
    int rankOffsets[8] = { 2, 1, -1, -2, -2, -1, 1, 2 };

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Knight, from)) continue;

        int fromFile = square % 8;
        int fromRank = square / 8;

        for(int i = 0; i < 8; i++){
            int targetFile = fromFile + fileOffsets[i];
            int targetRank = fromRank + rankOffsets[i];

            if(!isOnBoard(targetFile, targetRank)) continue;

            Square to = makeSquare(targetFile, targetRank);
            addMoveIfAllowed(position, moves, color, Knight, from, to);
        }
    }
}

void MoveGenerator::generateBishopMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Bishop, from)) continue;

        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, color, Bishop, from, fromFile, fromRank, 1, 1);
        addSlidingMovesInDirection(position, moves, color, Bishop, from, fromFile, fromRank, 1, -1);
        addSlidingMovesInDirection(position, moves, color, Bishop, from, fromFile, fromRank, -1, 1);
        addSlidingMovesInDirection(position, moves, color, Bishop, from, fromFile, fromRank, -1, -1);
    }
}

void MoveGenerator::generateRookMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Rook, from)) continue;

        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, color, Rook, from, fromFile, fromRank, 1, 0);
        addSlidingMovesInDirection(position, moves, color, Rook, from, fromFile, fromRank, -1, 0);
        addSlidingMovesInDirection(position, moves, color, Rook, from, fromFile, fromRank, 0, 1);
        addSlidingMovesInDirection(position, moves, color, Rook, from, fromFile, fromRank, 0, -1);
    }
}

void MoveGenerator::generateQueenMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Queen, from)) continue;

        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, 1, 0);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, -1, 0);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, 0, 1);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, 0, -1);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, 1, 1);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, 1, -1);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, -1, 1);
        addSlidingMovesInDirection(position, moves, color, Queen, from, fromFile, fromRank, -1, -1);
    }
}

void MoveGenerator::generateKingMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;

    int fileOffsets[8] = { 1, 1, 0, -1, -1, -1, 0, 1 };
    int rankOffsets[8] = { 0, 1, 1, 1, 0, -1, -1, -1 };

    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, King, from)) continue;

        int fromFile = square % 8;
        int fromRank = square / 8;

        for(int i = 0; i < 8; i++){
            int targetFile = fromFile + fileOffsets[i];
            int targetRank = fromRank + rankOffsets[i];

            if(!isOnBoard(targetFile, targetRank)) continue;

            Square to = makeSquare(targetFile, targetRank);
            addMoveIfAllowed(position, moves, color, King, from, to);
        }
    }
}
