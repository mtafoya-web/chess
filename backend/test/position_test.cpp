#include <gtest/gtest.h>
#include "chess/position.h"

TEST(PositionTest, SetsChecksAndRemovesPiece)
{
    Position board{};
    EXPECT_FALSE(board.hasPiece(Piece{White, Knight}, G1));
    board.setPiece(Piece{White, Knight}, G1);
    EXPECT_TRUE(board.hasPiece(Piece{White, Knight}, G1));
    board.removePiece(Piece{White, Knight}, G1);
    EXPECT_FALSE(board.hasPiece(Piece{White, Knight}, G1));
}

TEST(PositionTest, KeepsDifferentPiecesSeparate)
{
    Position board{};

    board.setPiece(Piece{White, Pawn}, E2);
    board.setPiece(Piece{Black, Pawn}, E7);

    EXPECT_TRUE(board.hasPiece(Piece{White, Pawn}, E2));
    EXPECT_TRUE(board.hasPiece(Piece{Black, Pawn}, E7));
    EXPECT_FALSE(board.hasPiece(Piece{White, Pawn}, E7));
}

TEST(PositionTest, InitialBoardSetup)
{
    Position board = Position::startingPosition();

    EXPECT_TRUE(board.hasPiece(Piece{White, Pawn}, A2));
    EXPECT_TRUE(board.hasPiece(Piece{Black, Pawn}, A7));
    EXPECT_TRUE(board.hasPiece(Piece{White, Rook}, A1));
    EXPECT_TRUE(board.hasPiece(Piece{White, King}, E1));
    EXPECT_TRUE(board.hasPiece(Piece{Black, King}, E8));
    EXPECT_FALSE(board.hasPiece(Piece{White, Pawn}, E4));
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

TEST(PositionTest, GetPieceLocationsInitialPosition)
{
    Position board = Position::startingPosition();

    for (int colorValue = 0; colorValue < ColorEnd; colorValue++) {
        for (int typeValue = 0; typeValue < PieceTypeEnd; typeValue++) {
            Color color = static_cast<Color>(colorValue);
            PieceType type = static_cast<PieceType>(typeValue);
            std::vector<Square> locations =
                board.getPieceLocations(Piece{color, type});

            for (int i = 0; i < static_cast<int>(locations.size()) - 1; i++) {
                for (int j = i + 1; j < static_cast<int>(locations.size()); j++) {
                    EXPECT_NE(locations.at(i), locations.at(j));
                }
            }

            if (type == Pawn) {
                EXPECT_EQ(8, locations.size());
            } else if (type == King || type == Queen) {
                EXPECT_EQ(1, locations.size());
            } else {
                EXPECT_EQ(2, locations.size());
            }

            for (Square location : locations) {
                EXPECT_TRUE(board.hasPiece(Piece{color, type}, location));
            }
        }
    }
}
