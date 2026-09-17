#include <gtest/gtest.h>
#include "chess/position.h"
#include "chess/move.h"
#include "chess/moveGenerator.h"

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

TEST(PositionTest, GetPieceLocationsInitialPosition){
    Position board = Position::startingPosition();

    for(int color_val = 0; color_val < ColorEnd; color_val++){
        for(int type_val = 0; type_val < PieceTypeEnd; type_val++){
            Color color = static_cast<Color> (color_val);
            PieceType piece = static_cast<PieceType> (type_val);

            std::vector<Square> pieceLocations = board.getPieceLocations(Piece{color, piece});

            // Check for duplicate locations
            for(int i = 0; i < pieceLocations.size() - 1; i++){
                for(int j = i + 1 ; j < pieceLocations.size(); j++){
                    EXPECT_NE(pieceLocations.at(i), pieceLocations.at(j));
                }
            }

            // Check correct amount of piece locations per piece type
            if(piece == Pawn){
                EXPECT_EQ(8, pieceLocations.size());
            }else if(piece == King || piece == Queen){
                EXPECT_EQ(1, pieceLocations.size());
            }else{
                EXPECT_EQ(2, pieceLocations.size());
            }

            // Checks if each piece location is correct 
            for(Square location: pieceLocations){
                EXPECT_TRUE(board.hasPiece(Piece{color, piece}, location));
            }
        }
    }   
}