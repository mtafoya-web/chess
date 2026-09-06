#include <gtest/gtest.h>

#include "chess/position.h"
#include "chess/move.h"
#include "chess/moveGenerator.h"

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

    bool foundDoubleMove = false;

    for (const Move& move : moves)
    {
        if (
            move.startSquare == E2 &&
            move.stopSquare == E4
        )
        {
            foundDoubleMove = true;
        }
    }

    EXPECT_TRUE(foundDoubleMove);
}

TEST(MoveGeneratorTest, WhitePawnCannotMoveTwoSquaresFromNonStartingRank)
{
    Position board;

    board.setPiece(White, Pawn, E3);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    bool foundIllegalDoubleMove = false;

    for (const Move& move : moves)
    {
        if (
            move.startSquare == E3 &&
            move.stopSquare == E5
        )
        {
            foundIllegalDoubleMove = true;
        }
    }

    EXPECT_FALSE(foundIllegalDoubleMove);
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

    bool foundDoubleMove = false;

    for (const Move& move : moves)
    {
        if (
            move.startSquare == E2 &&
            move.stopSquare == E4
        )
        {
            foundDoubleMove = true;
        }
    }

    EXPECT_FALSE(foundDoubleMove);
}

TEST(MoveGeneratorTest, KnightMovesFromCenter)
{
    Position board;

    // Put one white knight in the middle of the board.
    board.setPiece(White, Knight, D4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    // A knight in the center should have 8 possible moves.
    int knightMoveCount = 0;

    for (const Move& move : moves)
    {
        if (move.piece == Knight && move.startSquare == D4)
        {
            knightMoveCount++;
        }
    }

    EXPECT_EQ(knightMoveCount, 8);
}

TEST(MoveGeneratorTest, KnightMovesFromCorner)
{
    Position board;

    board.setPiece(White, Knight, A1);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    int knightMoveCount = 0;

    for (const Move& move : moves)
    {
        if (
            move.piece == Knight &&
            move.startSquare == A1
        )
        {
            knightMoveCount++;
        }
    }

    EXPECT_EQ(knightMoveCount, 2);
}

TEST(MoveGeneratorTest, KnightCannotLandOnFriendlyPiece)
{
    Position board;

    board.setPiece(White, Knight, D4);
    board.setPiece(White, Pawn, E6);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    bool foundBlockedMove = false;

    for (const Move& move : moves)
    {
        if (
            move.piece == Knight &&
            move.startSquare == D4 &&
            move.stopSquare == E6
        )
        {
            foundBlockedMove = true;
        }
    }

    EXPECT_FALSE(foundBlockedMove);
}