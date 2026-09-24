#include <gtest/gtest.h>

#include "chess/position.h"
#include "chess/move.h"
#include "chess/moveGenerator.h"

namespace {

bool containsMove(
    const std::vector<Move>& moves,
    PieceType piece,
    Square startSquare,
    Square stopSquare
)
{
    for (const Move& move : moves)
    {
        if (
            move.piece == piece &&
            move.startSquare == startSquare &&
            move.stopSquare == stopSquare
        )
        {
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

    for (const Move& move : moves)
    {
        if (move.piece == piece && move.startSquare == startSquare)
        {
            moveCount++;
        }
    }

    return moveCount;
}

}

TEST(PositionTest, SetsChecksAndRemovesPiece)
{
    Position board{};
    EXPECT_FALSE(board.hasPiece(White, Knight, G1));
    board.setPiece(White, Knight, G1);
    EXPECT_TRUE(board.hasPiece(White, Knight, G1));
    board.removePiece(White, Knight, G1);
    EXPECT_FALSE(board.hasPiece(White, Knight, G1));
}

TEST(PositionTest, KeepsDifferentPiecesSeparate)
{
    Position board{};

    board.setPiece(White, Pawn, E2);
    board.setPiece(Black, Pawn, E7);

    EXPECT_TRUE(board.hasPiece(White, Pawn, E2));
    EXPECT_TRUE(board.hasPiece(Black, Pawn, E7));
    EXPECT_FALSE(board.hasPiece(White, Pawn, E7));
}

TEST(PositionTest, InitialBoardSetup)
{
    Position board = Position::startingPosition();

    EXPECT_TRUE(board.hasPiece(White, Pawn, A2));
    EXPECT_TRUE(board.hasPiece(Black, Pawn, A7));
    EXPECT_TRUE(board.hasPiece(White, Rook, A1));
    EXPECT_TRUE(board.hasPiece(White, King, E1));
    EXPECT_TRUE(board.hasPiece(Black, King, E8));
    EXPECT_FALSE(board.hasPiece(White, Pawn, E4));
}

TEST(PositionTest, PieceAtReturnsExpectedTokens)
{
    Position board = Position::startingPosition();

    EXPECT_EQ(board.pieceAt(A1), "WR");
    EXPECT_EQ(board.pieceAt(B1), "WN");
    EXPECT_EQ(board.pieceAt(E1), "WK");
    EXPECT_EQ(board.pieceAt(E2), "WP");
    EXPECT_EQ(board.pieceAt(E4), "--");
    EXPECT_EQ(board.pieceAt(A8), "BR");
    EXPECT_EQ(board.pieceAt(E8), "BK");
}

TEST(PositionTest, PrintPiecesOutputsInitialBoard)
{
    Position board = Position::startingPosition();

    testing::internal::CaptureStdout();
    board.printPieces();
    std::string output = testing::internal::GetCapturedStdout();

    std::string expected =
        "8 BR BN BB BQ BK BB BN BR \n"
        "7 BP BP BP BP BP BP BP BP \n"
        "6 -- -- -- -- -- -- -- -- \n"
        "5 -- -- -- -- -- -- -- -- \n"
        "4 -- -- -- -- -- -- -- -- \n"
        "3 -- -- -- -- -- -- -- -- \n"
        "2 WP WP WP WP WP WP WP WP \n"
        "1 WR WN WB WQ WK WB WN WR \n"
        "  a  b  c  d  e  f  g  h\n";

    EXPECT_EQ(output, expected);
}

TEST(MoveGeneratorTest, WhitePawnCanMoveTwoSquaresFromStartingRank)
{
    Position board;

    // Put one white pawn on E2.
    board.setPiece(White, Pawn, E2);

    // Make sure it is White's turn.
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Pawn, E2, E4));
}

TEST(MoveGeneratorTest, WhitePawnCannotMoveTwoSquaresFromNonStartingRank)
{
    Position board;

    board.setPiece(White, Pawn, E3);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Pawn, E3, E5));
}

TEST(MoveGeneratorTest, WhitePawnCannotJumpPieceOnDoubleMove)
{
    Position board;

    board.setPiece(White, Pawn, E2);

    // Block E3.
    board.setPiece(Black, Knight, E3);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Pawn, E2, E4));
}

TEST(MoveGeneratorTest, PawnCapturesEnemyDiagonally)
{
    Position board;

    board.setPiece(White, Pawn, E4);
    board.setPiece(Black, Knight, D5);
    board.setPiece(White, Knight, F5);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_TRUE(containsMove(moves, Pawn, E4, D5));
    EXPECT_FALSE(containsMove(moves, Pawn, E4, F5));
}

TEST(MoveGeneratorTest, KnightMovesFromCenter)
{
    Position board;

    // Put one white knight in the middle of the board.
    board.setPiece(White, Knight, D4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, Knight, D4), 8);
}

TEST(MoveGeneratorTest, KnightMovesFromCorner)
{
    Position board;

    board.setPiece(White, Knight, A1);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, Knight, A1), 2);
}

TEST(MoveGeneratorTest, KnightCannotLandOnFriendlyPiece)
{
    Position board;

    board.setPiece(White, Knight, D4);
    board.setPiece(White, Pawn, E6);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_FALSE(containsMove(moves, Knight, D4, E6));
}

TEST(MoveGeneratorTest, BishopSlidesDiagonallyUntilBlocked)
{
    Position board;

    board.setPiece(White, Bishop, D4);
    board.setPiece(White, Pawn, F6);
    board.setPiece(Black, Pawn, B6);

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

    board.setPiece(White, Rook, D4);
    board.setPiece(White, Pawn, D6);
    board.setPiece(Black, Pawn, G4);

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

    board.setPiece(White, Queen, D4);
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

    board.setPiece(White, King, D4);
    board.setPiece(White, Pawn, D5);
    board.setPiece(Black, Pawn, E5);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    EXPECT_EQ(countMovesForPiece(moves, King, D4), 7);
    EXPECT_FALSE(containsMove(moves, King, D4, D5));
    EXPECT_TRUE(containsMove(moves, King, D4, E5));
}
