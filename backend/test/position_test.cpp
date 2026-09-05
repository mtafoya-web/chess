#include <gtest/gtest.h>

#include "position.h"

TEST(PositionTest, SetsChecksAndRemovesPiece)
{
    Position position{};
    //Check has piece
    EXPECT_FALSE(position.hasPiece(position, White, Knight, G1));
    //Check set piece
    position.setPiece(position, White, Knight, G1);
    EXPECT_TRUE(position.hasPiece(position, White, Knight, G1));
    //Check remove piece
    position.removePiece(position, White, Knight, G1);
    EXPECT_FALSE(position.hasPiece(position, White, Knight, G1));
}

TEST(PositionTest, KeepsDifferentPiecesSeparate)
{
    Position position{};

    position.setPiece(position, White, Pawn, E2);
    position.setPiece(position, Black, Pawn, E7);

    EXPECT_TRUE(position.hasPiece(position, White, Pawn, E2));
    EXPECT_TRUE(position.hasPiece(position, Black, Pawn, E7));
    EXPECT_FALSE(position.hasPiece(position, White, Pawn, E7));
}