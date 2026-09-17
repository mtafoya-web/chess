#include <gtest/gtest.h>
#include "chess/position.h"
#include "chess/move.h"
#include "chess/moveGenerator.h"

TEST(MoveGeneratorTest, WhitePawnCanMoveTwoSquaresFromStartingRank)
{
    Position board;

    // Put one white pawn on E2.
    board.setPiece(Piece{White, Pawn}, E2);

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

    board.setPiece(Piece{White, Pawn}, E3);
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

    board.setPiece(Piece{White, Pawn}, E2);

    // Block E3.
    board.setPiece(Piece{Black, Knight}, E3);

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
    board.setPiece(Piece{White, Knight}, D4);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    // A knight in the center should have 8 possible moves.
    int knightMoveCount = 0;

    for (const Move& move : moves)
    {
        if (move.piece.type == Knight && move.startSquare == D4)
        {
            knightMoveCount++;
        }
    }

    EXPECT_EQ(knightMoveCount, 8);
}

TEST(MoveGeneratorTest, KnightMovesFromCorner)
{
    Position board;

    board.setPiece(Piece{White, Knight}, A1);
    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    int knightMoveCount = 0;

    for (const Move& move : moves)
    {
        if (
            move.piece.type == Knight &&
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

    board.setPiece(Piece{White, Knight}, D4);
    board.setPiece(Piece{White, Pawn}, E6);

    board.sideToMove = White;

    std::vector<Move> moves =
        MoveGenerator::generateMoves(board);

    bool foundBlockedMove = false;

    for (const Move& move : moves)
    {
        if (
            move.piece.type == Knight &&
            move.startSquare == D4 &&
            move.stopSquare == E6
        )
        {
            foundBlockedMove = true;
        }
    }

    EXPECT_FALSE(foundBlockedMove);
}

TEST(MoveGeneratorTest, BishopMovesFromCenter){
    Position board; 

    board.setPiece(Piece{White, Bishop}, D4);
    board.sideToMove = White;

    std::vector<Move> moves = MoveGenerator::generateMoves(board);

    std::vector<Square> expectedStopSquares = {A1, B2, C3, E5, F6, G7, H8,
                                                G1, F2, E3, C5, B6, A7};
    
    int expectedMoveCount = expectedStopSquares.size();
    
    ASSERT_EQ(expectedMoveCount, moves.size()) << "Wrong amount of moves.";

    for(Move m:moves){
        for(Square stopSquare: expectedStopSquares){
            EXPECT_EQ(m.stopSquare, stopSquare) << "Bad move generated.";
            EXPECT_EQ(m.startSquare, D4) << "Bad move generated.";

        }
    }
}

TEST(MoveGeneratorTest, BishopMovesFromCorner){
    Position board; 

    board.setPiece(Piece{White, Bishop}, D4);
    board.sideToMove = White;

    std::vector<Move> moves = MoveGenerator::generateMoves(board);
    std::vector<Square> expectedStopSquares = {B2, C3, D4, E5, F6, G7, H8};
    int expectedMoveCount = expectedStopSquares.size();
    
    ASSERT_EQ(expectedMoveCount, moves.size()) << "Wrong amount of moves.";

    for(Move m:moves){
        for(Square stopSquare: expectedStopSquares){
            EXPECT_EQ(m.stopSquare, stopSquare) << "Bad move generated.";
            EXPECT_EQ(m.startSquare, A1) << "Bad move generated.";
        }
    }
}