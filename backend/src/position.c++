#include <iostream>
#include "chess/position.h"
#include <vector>
#include <cmath>
#include "chess/utils.h"

bool Position::hasPiece(Piece piece, Square square) const {
    return pieces[piece.color][piece.type] & squareMask(square);
}

void Position::setPiece(Piece piece, Square square) {
    pieces[piece.color][piece.type] |= squareMask(square);
}

std::optional<Piece> Position::getPiece(Square square) const{
    uint64_t squareMask_ = squareMask(square);

    for(int color = 0;  color < ColorEnd ; color++){
        for(int type = 0; type < PieceTypeEnd; type++){
            if((squareMask_ & pieces[color][type]) > 0){
                Piece p {static_cast<Color>(color), static_cast<PieceType>(type)};
                return p; 
            }
        }
    }

    return std::nullopt;
}

void Position::removePiece(Piece piece, Square square) {
    pieces[piece.color][piece.type] &= ~squareMask(square);
}

void Position::removePiece(Square square) {
    std::optional<Piece> res = getPiece(square);
    Piece targetPiece = res.value();
    pieces[targetPiece.color][targetPiece.type] &= ~squareMask(square);
}

std::vector<Square> Position::getPieceLocations(Piece piece) const{
    uint64_t pieceBitboard = pieces[piece.color][piece.type];
    std::vector<Square> locations = {}; 

    while(pieceBitboard > 0){
        uint64_t pieceBitboardMinusLSB = pieceBitboard & (pieceBitboard - 1);
        locations.push_back(static_cast<Square>(std::log2(pieceBitboard - pieceBitboardMinusLSB)));
        pieceBitboard = pieceBitboardMinusLSB;
    }

    return locations;
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
        board.setPiece(Piece{White, Pawn}, static_cast<Square>(square));
    }
    //Black pawns
    for(int square = A7; square <= H7; square++){
        board.setPiece(Piece{Black, Pawn}, static_cast<Square>(square));
    }

    // White back rank
    board.setPiece(Piece{White, Rook}, A1);
    board.setPiece(Piece{White, Knight}, B1);
    board.setPiece(Piece{White, Bishop}, C1);
    board.setPiece(Piece{White, Queen}, D1);
    board.setPiece(Piece{White, King}, E1);
    board.setPiece(Piece{White, Bishop}, F1);
    board.setPiece(Piece{White, Knight}, G1);
    board.setPiece(Piece{White, Rook}, H1);

    // Black back rank
    board.setPiece(Piece{Black, Rook}, A8);
    board.setPiece(Piece{Black, Knight}, B8);
    board.setPiece(Piece{Black, Bishop}, C8);
    board.setPiece(Piece{Black, Queen}, D8);
    board.setPiece(Piece{Black, King}, E8);
    board.setPiece(Piece{Black, Bishop}, F8);
    board.setPiece(Piece{Black, Knight}, G8);
    board.setPiece(Piece{Black, Rook}, H8);

    return board;
}

std::string Position::pieceAt(Square square) const{
    if (hasPiece(Piece{White, Pawn}, square))   return "WP";
    if (hasPiece(Piece{White, Knight}, square)) return "WN";
    if (hasPiece(Piece{White, Bishop}, square)) return "WB";
    if (hasPiece(Piece{White, Rook}, square))   return "WR";
    if (hasPiece(Piece{White, Queen}, square))  return "WQ";
    if (hasPiece(Piece{White, King}, square))   return "WK";

    if (hasPiece(Piece{Black, Pawn}, square))   return "BP";
    if (hasPiece(Piece{Black, Knight}, square)) return "BN";
    if (hasPiece(Piece{Black, Bishop}, square)) return "BB";
    if (hasPiece(Piece{Black, Rook}, square))   return "BR";
    if (hasPiece(Piece{Black, Queen}, square))  return "BQ";
    if (hasPiece(Piece{Black, King}, square))   return "BK";

    return "--";
}
