#include "chess/moveGenerator.h"
#include "chess/piece.h"

std::vector<Move> MoveGenerator::generateMoves(
    const Position& position
) {
    std::vector<Move> moves;

    generatePawnMoves(position, moves);
    generateKnightMoves(position, moves);

    return moves;
}

void MoveGenerator::generatePawnMoves(
    const Position& position,
    std::vector<Move>& moves
) {
    Color color = position.sideToMove;
    Piece pawn{color, Pawn};

    // White pawns move up the board, black pawn move down
    int direction;
    if (color == White) {
        direction = 8;
    } else {
        direction = -8;
    }

    std::vector<Square> pawnLocations =
        position.getPieceLocations(pawn);

    for (Square from : pawnLocations) {
        int square = static_cast<int>(from);
        int targetSquare = square + direction;
        Square to = static_cast<Square>(targetSquare);

        // Check if another piece blocking move 
        bool targetEmpty =
            !position.getPiece(to).has_value();

        if (targetEmpty) {
            moves.push_back({
                pawn,
                from,
                to
            });
        }

        //Pawns on their starting positions can move 2 squares up
        bool onStartingRank;

        if (color == White) {
            onStartingRank =
                square >= A2 && square <= H2;
        } else {
            onStartingRank =
                square >= A7 && square <= H7;
        }

        if (onStartingRank) {
            int doubleTargetSquare =
                square + (direction * 2);

            Square doubleTo =
                static_cast<Square>(doubleTargetSquare);

            bool doubleTargetEmpty =
                !position.getPiece(doubleTo).has_value();

            if (targetEmpty && doubleTargetEmpty) {
                moves.push_back({
                    pawn,
                    from,
                    doubleTo
                });
            }
        }

        // checking for en passant 
        int enPassantSquare = position.enPassantSquare;
        if(enPassantSquare != -1){          
            /*
                En passant is possible if pawn is one square diagonally 
                above/below (depends on color) the en passant square.
            */
            int enPassantRow = enPassantSquare / 8;
            int enPassantCol = enPassantSquare % 8;
            int fromRow = from / 8;
            int fromCol = from % 8;

            // If pawn is one column away from en passant square 
            if(enPassantCol - fromCol == 1 ||  enPassantCol - fromCol == -1){

                //If pawn is one row above/below en passant square (depends on color)
                if((enPassantRow - fromRow) * 8 == direction){
                    moves.push_back({
                        pawn,
                        from, 
                        static_cast<Square>(enPassantSquare)
                    });
                }
            }
        }
    }
}

void MoveGenerator::generateKnightMoves(
    const Position& position,
    std::vector<Move>& moves
) {
    Color color = position.sideToMove;
    Piece knight{color, Knight};

    int fileOffsets[8] = {
         1,  2,  2,  1,
        -1, -2, -2, -1
    };

    int rankOffsets[8] = {
         2,  1, -1, -2,
        -2, -1,  1,  2
    };

    std::vector<Square> knightLocations =
        position.getPieceLocations(knight);

    for (Square from : knightLocations) {
        int square = static_cast<int>(from);
        int fromFile = square % 8;
        int fromRank = square / 8;

        for (int i = 0; i < 8; ++i) {
            int targetFile =
                fromFile + fileOffsets[i];

            int targetRank =
                fromRank + rankOffsets[i];

            if (
                targetFile < 0 ||
                targetFile > 7 ||
                targetRank < 0 ||
                targetRank > 7
            ) {
                continue;
            }

            int targetSquare =
                targetRank * 8 + targetFile;

            Square to =
                static_cast<Square>(targetSquare);

            // Checking if friendly piece is blocking target square
            std::optional<Piece> targetPiece =
                position.getPiece(to);

            if (
                targetPiece.has_value() &&
                targetPiece->color == color
            ) {
                continue;
            }

            moves.push_back({
                knight,
                from,
                to
            });
        }
    }
}