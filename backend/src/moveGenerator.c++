#include "chess/moveGenerator.h"

std::vector<Move> MoveGenerator::generateMoves(const Position& position){
    std::vector<Move> moves;
    generatePawnMoves(position, moves);
    generateKnightMoves(position, moves);
    return moves;
}

void MoveGenerator::generatePawnMoves(
    const Position& position,
    std::vector<Move>& moves
)
{
    Color color = position.sideToMove;
    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);
        //Does square contain pawns?
        if(!position.hasPiece(color, Pawn, from)) continue;
        
        //Orientation subtract for black add for white
        int direction;
        if(color == White) direction = 8;
        else direction = -8;
        // -----------------------------------------
        // Move forward one square
        // -----------------------------------------
        int targetSquare = square + direction;
        //bounds
        if(targetSquare < A1 || targetSquare > H8) continue;

        Square to = static_cast<Square>(targetSquare);

        if(position.pieceAt(to) == "--"){
            moves.push_back({
                color,
                Pawn,
                from,
                to
            });
        }
            // -----------------------------------------
        // Move forward two squares
        // -----------------------------------------

        bool onStartingRank;
        //Must be at starting point
        if(color == White) onStartingRank = square >= A2 && square <= H2;
        else onStartingRank = square >= A7 && square <= H7;

        if (onStartingRank){
            //Move two ranks foward
            int doubleTargetSquare = square + (direction * 2);
            Square doubleTo = static_cast<Square>(doubleTargetSquare);

            //Pawn cannot jump to another piece
            if(position.pieceAt(to) == "--" && position.pieceAt(doubleTo) == "--"){
                moves.push_back({
                    color,
                    Pawn,
                    from,
                    doubleTo
                });
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
    //Possible file offset  for a knight
    int fileOffsets[8] = {
        1, 2, 2, 1,
        -1, -2, -2, -1
    };
    //Matching rank offset
    int rankOffsets[8] = {
        2, 1, -1, -2,
        -2, -1, 1, 2
    };
    
    for(int square = A1; square <= H8; square++){
        Square from = static_cast<Square>(square);

        if(!position.hasPiece(color, Knight, from)) continue;

        //Convert square num into board coordinates
        int fromFile = square % 8;
        int fromRank = square / 8;

        //A knight has at most 8 possible destinations
        for(int i = 0; i < 8; i++)
        {
            int targetFile = fromFile + fileOffsets[i];
            int targentRank = fromRank + rankOffsets[i];
            
            //ignore moves that leave the board
            if(targetFile < 0 || targetFile > 7 || targentRank < 0 || targentRank > 7) continue;

            //Convert back to square num
            int targetSquare = targentRank * 8 + targetFile;
            Square to = static_cast<Square>(targetSquare);

            //Knights can't land on their own pieces.
            bool friendlyPiece =
                position.hasPiece(color, Pawn, to) ||
                position.hasPiece(color, Knight, to) ||
                position.hasPiece(color, Bishop, to) ||
                position.hasPiece(color, Rook, to) ||
                position.hasPiece(color, Queen, to) ||
                position.hasPiece(color, King, to);
            
            if (friendlyPiece) continue;

            //Destination is empty or enemy piece
            moves.push_back({
                color,
                Knight,
                from,
                to
            });
        }
    }
}