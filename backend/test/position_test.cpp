#include <gtest/gtest.h>

#include "chess/position.h"

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
    Position board = Position::initPosition();

    EXPECT_TRUE(board.hasPiece(White, Pawn, A2));
    EXPECT_TRUE(board.hasPiece(Black, Pawn, A7));
    EXPECT_TRUE(board.hasPiece(White, Rook, A1));
    EXPECT_TRUE(board.hasPiece(White, King, E1));
    EXPECT_TRUE(board.hasPiece(Black, King, E8));
    EXPECT_FALSE(board.hasPiece(White, Pawn, E4));
}

TEST(PositionTest, PieceAtReturnsExpectedTokens)
{
    Position board = Position::initPosition();

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
    Position board = Position::initPosition();

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
