#include <iostream>
#include "chess/position.h"

std::uint64_t Position::squareMask(Square square) const {
    return 1ULL << square;
}

bool Position::hasPiece(Color color, PieceType type, Square square) const {
    return pieces[color][type] & squareMask(square);
}

void Position::setPiece(Color color, PieceType type, Square square) {
    pieces[color][type] |= squareMask(square);
}

void Position::removePiece(Color color, PieceType type, Square square) {
    pieces[color][type] &= ~squareMask(square);
}

void Position::printPieces() const {
    for (int rank = 7; rank >= 0; --rank) {
        std::cout << rank + 1 << " ";
        for (int file = 0; file < 8; ++file) {
            Square square = static_cast<Square>(rank * 8 + file);
            std::cout << pieceAt(square) << " ";
        }
        std::cout << '\n';
    }
    std::cout << "  a  b  c  d  e  f  g  h\n";
}

Position Position::startingPosition(){
    //Create board
    Position board;

    //All castling possible 1111
    board.castlingRights =
        static_cast<CastlingRights>(
            whiteShort |
            whiteLong |
            blackShort |
            blackLong
        );
    

    //White pawns
    for(int square = A2; square <= H2; square++){
        board.setPiece(White, Pawn, static_cast<Square>(square));
    }
    //Black pawns
    for(int square = A7; square <= H7; square++){
        board.setPiece(Black, Pawn, static_cast<Square>(square));
    }

    // White back rank
    board.setPiece(White, Rook, A1);
    board.setPiece(White, Knight, B1);
    board.setPiece(White, Bishop, C1);
    board.setPiece(White, Queen, D1);
    board.setPiece(White, King, E1);
    board.setPiece(White, Bishop, F1);
    board.setPiece(White, Knight, G1);
    board.setPiece(White, Rook, H1);

    // Black back rank
    board.setPiece(Black, Rook, A8);
    board.setPiece(Black, Knight, B8);
    board.setPiece(Black, Bishop, C8);
    board.setPiece(Black, Queen, D8);
    board.setPiece(Black, King, E8);
    board.setPiece(Black, Bishop, F8);
    board.setPiece(Black, Knight, G8);
    board.setPiece(Black, Rook, H8);

    return board;
}

std::string Position::pieceAt(Square square) const{
    if (hasPiece(White, Pawn, square))   return "WP";
    if (hasPiece(White, Knight, square)) return "WN";
    if (hasPiece(White, Bishop, square)) return "WB";
    if (hasPiece(White, Rook, square))   return "WR";
    if (hasPiece(White, Queen, square))  return "WQ";
    if (hasPiece(White, King, square))   return "WK";

    if (hasPiece(Black, Pawn, square))   return "BP";
    if (hasPiece(Black, Knight, square)) return "BN";
    if (hasPiece(Black, Bishop, square)) return "BB";
    if (hasPiece(Black, Rook, square))   return "BR";
    if (hasPiece(Black, Queen, square))  return "BQ";
    if (hasPiece(Black, King, square))   return "BK";

    return "--";
}