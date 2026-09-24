#include "chess/moveGenerator.h"

namespace {

bool isOnBoard(int file, int rank)
{
    return file >= 0 && file <= 7 && rank >= 0 && rank <= 7;
}

bool isSquareIndexOnBoard(int square)
{
    return square >= A1 && square <= H8;
}

Square makeSquare(int file, int rank)
{
    return static_cast<Square>(rank * 8 + file);
}

bool isEmpty(const Position& position, Square square)
{
    return !position.getPiece(square).has_value();
}

bool hasFriendlyPiece(const Position& position, Color color, Square square)
{
    std::optional<Piece> piece = position.getPiece(square);
    return piece.has_value() && piece->color == color;
}

bool hasEnemyPiece(const Position& position, Color color, Square square)
{
    std::optional<Piece> piece = position.getPiece(square);
    return piece.has_value() && piece->color != color;
}

void addMove(
    std::vector<Move>& moves,
    Piece piece,
    Square from,
    Square to
)
{
    moves.push_back({
        piece,
        from,
        to
    });
}

void addMoveIfAllowed(
    const Position& position,
    std::vector<Move>& moves,
    Piece piece,
    Square from,
    Square to
)
{
    if (hasFriendlyPiece(position, piece.color, to)) return;

    addMove(moves, piece, from, to);
}

void addSlidingMovesInDirection(
    const Position& position,
    std::vector<Move>& moves,
    Piece piece,
    Square from,
    int startFile,
    int startRank,
    int fileStep,
    int rankStep
)
{
    int targetFile = startFile + fileStep;
    int targetRank = startRank + rankStep;

    while (isOnBoard(targetFile, targetRank)) {
        Square to = makeSquare(targetFile, targetRank);

        if (hasFriendlyPiece(position, piece.color, to)) return;

        addMove(moves, piece, from, to);

        if (hasEnemyPiece(position, piece.color, to)) return;

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
    Piece pawn{color, Pawn};
    int forwardStep = color == White ? 8 : -8;

    for (Square from : position.getPieceLocations(pawn)) {
        int square = static_cast<int>(from);
        int oneSquareForward = square + forwardStep;

        if (isSquareIndexOnBoard(oneSquareForward)) {
            Square to = static_cast<Square>(oneSquareForward);

            if (isEmpty(position, to)) {
                addMove(moves, pawn, from, to);
            }
        }

        bool onStartingRank =
            (color == White && square >= A2 && square <= H2) ||
            (color == Black && square >= A7 && square <= H7);

        int twoSquaresForward = square + (forwardStep * 2);

        if (onStartingRank && isSquareIndexOnBoard(twoSquaresForward)) {
            Square middle = static_cast<Square>(oneSquareForward);
            Square to = static_cast<Square>(twoSquaresForward);

            if (isEmpty(position, middle) && isEmpty(position, to)) {
                addMove(moves, pawn, from, to);
            }
        }

        int fromFile = square % 8;
        int leftCapture = square + forwardStep - 1;
        int rightCapture = square + forwardStep + 1;

        if (fromFile > 0 && isSquareIndexOnBoard(leftCapture)) {
            Square to = static_cast<Square>(leftCapture);

            if (hasEnemyPiece(position, color, to)) {
                addMove(moves, pawn, from, to);
            }
        }

        if (fromFile < 7 && isSquareIndexOnBoard(rightCapture)) {
            Square to = static_cast<Square>(rightCapture);

            if (hasEnemyPiece(position, color, to)) {
                addMove(moves, pawn, from, to);
            }
        }

        int enPassantSquare = position.enPassantSquare;
        if (enPassantSquare != -1) {
            int enPassantRow = enPassantSquare / 8;
            int enPassantCol = enPassantSquare % 8;
            int fromRow = square / 8;
            int fromCol = square % 8;

            bool oneFileAway =
                enPassantCol - fromCol == 1 ||
                enPassantCol - fromCol == -1;

            if (oneFileAway && (enPassantRow - fromRow) * 8 == forwardStep) {
                addMove(
                    moves,
                    pawn,
                    from,
                    static_cast<Square>(enPassantSquare)
                );
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
    Piece knight{color, Knight};

    int fileOffsets[8] = { 1, 2, 2, 1, -1, -2, -2, -1 };
    int rankOffsets[8] = { 2, 1, -1, -2, -2, -1, 1, 2 };

    for (Square from : position.getPieceLocations(knight)) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        for (int i = 0; i < 8; i++) {
            int targetFile = fromFile + fileOffsets[i];
            int targetRank = fromRank + rankOffsets[i];

            if (!isOnBoard(targetFile, targetRank)) continue;

            Square to = makeSquare(targetFile, targetRank);
            addMoveIfAllowed(position, moves, knight, from, to);
        }
    }
}

void MoveGenerator::generateBishopMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    Piece bishop{color, Bishop};

    for (Square from : position.getPieceLocations(bishop)) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, bishop, from, fromFile, fromRank, 1, 1);
        addSlidingMovesInDirection(position, moves, bishop, from, fromFile, fromRank, 1, -1);
        addSlidingMovesInDirection(position, moves, bishop, from, fromFile, fromRank, -1, 1);
        addSlidingMovesInDirection(position, moves, bishop, from, fromFile, fromRank, -1, -1);
    }
}

void MoveGenerator::generateRookMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    Piece rook{color, Rook};

    for (Square from : position.getPieceLocations(rook)) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, rook, from, fromFile, fromRank, 1, 0);
        addSlidingMovesInDirection(position, moves, rook, from, fromFile, fromRank, -1, 0);
        addSlidingMovesInDirection(position, moves, rook, from, fromFile, fromRank, 0, 1);
        addSlidingMovesInDirection(position, moves, rook, from, fromFile, fromRank, 0, -1);
    }
}

void MoveGenerator::generateQueenMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    Piece queen{color, Queen};

    for (Square from : position.getPieceLocations(queen)) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, 1, 0);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, -1, 0);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, 0, 1);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, 0, -1);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, 1, 1);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, 1, -1);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, -1, 1);
        addSlidingMovesInDirection(position, moves, queen, from, fromFile, fromRank, -1, -1);
    }
}

void MoveGenerator::generateKingMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    Piece king{color, King};

    int fileOffsets[8] = { 1, 1, 0, -1, -1, -1, 0, 1 };
    int rankOffsets[8] = { 0, 1, 1, 1, 0, -1, -1, -1 };

    for (Square from : position.getPieceLocations(king)) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        for (int i = 0; i < 8; i++) {
            int targetFile = fromFile + fileOffsets[i];
            int targetRank = fromRank + rankOffsets[i];

            if (!isOnBoard(targetFile, targetRank)) continue;

            Square to = makeSquare(targetFile, targetRank);
            addMoveIfAllowed(position, moves, king, from, to);
        }
    }
}
