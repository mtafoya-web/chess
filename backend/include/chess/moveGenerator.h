#pragma once
#include "position.h"
#include "move.h"
#include <vector>

struct MoveGenerator{
    static std::vector<Move> generateMoves(const Position& position);

    private:
        static void generatePawnMoves(const Position& position, std::vector<Move>& moves);
        static void generateKnightMoves(const Position& position, std::vector<Move>& moves);
        static void generateBishopMoves(const Position& position, std::vector<Move>& moves);
        static void generateRookMoves(const Position& position, std::vector<Move>& moves);
        static void generateQueenMoves(const Position& position, std::vector<Move>& moves);
        static void generateKingMoves(const Position& position, std::vector<Move>& moves);
};
