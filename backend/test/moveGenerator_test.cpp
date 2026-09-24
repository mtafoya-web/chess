#include <gtest/gtest.h>
#include "chess/move.h"
#include "chess/moveGenerator.h"
#include "chess/position.h"

namespace {

bool containsMove(
    const std::vector<Move>& moves,
    PieceType piece,
    Square startSquare,
    Square stopSquare
)
{
    for (const Move& move : moves) {
        if (
            move.piece.type == piece &&
            move.startSquare == startSquare &&
            move.stopSquare == stopSquare
        ) {
            return true;
        }
    }

    return false;
}

int countMovesForPiece(
    const std::vector<Move>& moves,
    PieceType piece,
    Square startSquare
)
{
    int moveCount = 0;

    for (const Move& move : moves) {
        if (move.piece.type == piece && move.startSquare == startSquare) {
            moveCount++;
        }
    }

    return moveCount;
}

}

TEST(MoveGeneratorTest, WhitePawnCanMoveTwoSquaresFromStartingRank)
{
    Position board;

    board.setPiece(Piece{White, Pawn}, E2);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Pawn, E2, E4));
}

TEST(MoveGeneratorTest, WhitePawnCannotMoveTwoSquaresFromNonStartingRank)
{
    Position board;

    board.setPiece(Piece{White, Pawn}, E3);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Pawn, E3, E5));
}

TEST(MoveGeneratorTest, WhitePawnCannotJumpPieceOnDoubleMove)
{
    Position board;

    board.setPiece(Piece{White, Pawn}, E2);
    board.setPiece(Piece{Black, Knight}, E3);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Pawn, E2, E4));
}

TEST(MoveGeneratorTest, PawnCapturesEnemyDiagonally)
{
    Position board;

    board.setPiece(Piece{White, Pawn}, E4);
    board.setPiece(Piece{Black, Knight}, D5);
    board.setPiece(Piece{White, Knight}, F5);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Pawn, E4, D5));
    EXPECT_FALSE(containsMove(moves, Pawn, E4, F5));
}

TEST(MoveGeneratorTest, EnPassantUsesPositionTargetSquare)
{
    Position board;

    board.setPiece(Piece{White, Pawn}, E5);
    board.sideToMove = White;
    board.enPassantSquare = D6;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Pawn, E5, D6));
}

TEST(MoveGeneratorTest, KnightMovesFromCenter)
{
    Position board;

    board.setPiece(Piece{White, Knight}, D4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, Knight, D4), 8);
}

TEST(MoveGeneratorTest, KnightMovesFromCorner)
{
    Position board;

    board.setPiece(Piece{White, Knight}, A1);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, Knight, A1), 2);
}

TEST(MoveGeneratorTest, KnightCannotLandOnFriendlyPiece)
{
    Position board;

    board.setPiece(Piece{White, Knight}, D4);
    board.setPiece(Piece{White, Pawn}, E6);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Knight, D4, E6));
}

TEST(MoveGeneratorTest, BishopSlidesDiagonallyUntilBlocked)
{
    Position board;

    board.setPiece(Piece{White, Bishop}, D4);
    board.setPiece(Piece{White, Pawn}, F6);
    board.setPiece(Piece{Black, Pawn}, B6);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Bishop, D4, E5));
    EXPECT_FALSE(containsMove(moves, Bishop, D4, F6));
    EXPECT_TRUE(containsMove(moves, Bishop, D4, B6));
    EXPECT_FALSE(containsMove(moves, Bishop, D4, A7));
}

TEST(MoveGeneratorTest, RookSlidesOrthogonallyUntilBlocked)
{
    Position board;

    board.setPiece(Piece{White, Rook}, D4);
    board.setPiece(Piece{White, Pawn}, D6);
    board.setPiece(Piece{Black, Pawn}, G4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Rook, D4, D5));
    EXPECT_FALSE(containsMove(moves, Rook, D4, D6));
    EXPECT_TRUE(containsMove(moves, Rook, D4, G4));
    EXPECT_FALSE(containsMove(moves, Rook, D4, H4));
}

TEST(MoveGeneratorTest, QueenCombinesRookAndBishopDirections)
{
    Position board;

    board.setPiece(Piece{White, Queen}, D4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Queen, D4, D8));
    EXPECT_TRUE(containsMove(moves, Queen, D4, H4));
    EXPECT_TRUE(containsMove(moves, Queen, D4, H8));
    EXPECT_TRUE(containsMove(moves, Queen, D4, A1));
}

TEST(MoveGeneratorTest, KingMovesOneSquareInAnyDirection)
{
    Position board;

    board.setPiece(Piece{White, King}, D4);
    board.setPiece(Piece{White, Pawn}, D5);
    board.setPiece(Piece{Black, Pawn}, E5);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, King, D4), 7);
    EXPECT_FALSE(containsMove(moves, King, D4, D5));
    EXPECT_TRUE(containsMove(moves, King, D4, E5));
}
