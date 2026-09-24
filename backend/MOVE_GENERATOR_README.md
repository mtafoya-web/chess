# Move Generator Notes

This file explains `backend/src/moveGenerator.c++` in plain language.

The move generator answers one question:

```text
Given this board, where can the side-to-move pieces go?
```

Call it like this:

```cpp
#include "chess/moveGenerator.h"

Position board = Position::startingPosition();
board.sideToMove = White;

std::vector<Move> moves = MoveGenerator::generateMoves(board);
```

Each `Move` contains:

- `piece`: a `Piece` struct with `color` and `type`
- `startSquare`: where the piece starts
- `stopSquare`: where the piece moves

The generator only creates move descriptions. It does not update the board.

## Pseudo-Legal Moves

The current generator creates pseudo-legal moves.

That means it enforces basic piece movement:

- The piece moves in the correct shape.
- The destination is on the board.
- The destination is empty or has an enemy piece.
- The destination does not have a friendly piece.
- Sliding pieces stop when another piece blocks the path.

It does not yet enforce every complete chess rule:

- Moving into check is not rejected.
- Leaving your king in check is not rejected.
- Checkmate and stalemate are not detected.
- Castling is not generated.
- Promotion is not generated.
- En passant moves can be generated from `Position::enPassantSquare`, but the driver does not maintain that square during play and does not remove the captured pawn as a special en passant capture.

So this generator is the basic movement layer, not the final legal-move layer.

## Board Coordinates

Squares are stored as numbers from `A1 = 0` to `H8 = 63`.

The code often converts a square number into:

```cpp
int file = square % 8; // column, A through H
int rank = square / 8; // row, 1 through 8
```

Then it converts back with:

```cpp
Square to = makeSquare(file, rank);
```

This makes edge checks easier. A move is off the board if `file` or `rank` is outside `0..7`.

## Position and Piece Lookup

The position stores pieces by color and type. The generator uses:

- `position.sideToMove` to decide which color should generate moves
- `position.getPiece(square)` to see what occupies a square
- `position.getPieceLocations(Piece{color, type})` to iterate only the pieces that can move

This means each piece generator starts with the current side to move, builds a `Piece`, finds all matching squares, and appends valid destinations.

## Helper Functions

The top of `moveGenerator.c++` has small helper functions.

`isOnBoard(file, rank)` checks whether a file/rank pair is inside the chess board.

`isSquareIndexOnBoard(square)` checks whether a raw square index is inside `A1..H8`.

`isEmpty(position, square)` checks whether a square has no piece.

`hasFriendlyPiece(position, color, square)` checks whether the moving side already owns that square.

`hasEnemyPiece(position, color, square)` checks whether the opposite side owns that square.

`addMove(...)` adds a move to the move list.

`addMoveIfAllowed(...)` adds a move only if the destination does not contain a friendly piece.

`addSlidingMovesInDirection(...)` is used by bishops, rooks, and queens. It keeps walking in one direction until it reaches the board edge or a piece blocks the path.

## Pawns

Pawns are handled in `generatePawnMoves()`.

The code first decides which way the pawn moves:

```cpp
int forwardStep = color == White ? 8 : -8;
```

White pawns move toward higher square numbers. Black pawns move toward lower square numbers.

A pawn can:

- Move forward one square if that square is empty.
- Move forward two squares from its starting rank if both the middle and destination squares are empty.
- Capture one square diagonally forward if that square has an enemy piece.
- Move to `position.enPassantSquare` when that square is one file away and one pawn step forward.

Example:

- White pawn on `E2`
- `E3` is empty
- `E4` is empty

Generated moves:

```text
E2 -> E3
E2 -> E4
```

Capture example:

- White pawn on `E4`
- Black piece on `D5`

Generated move:

```text
E4 -> D5
```

## Knights

Knights are handled in `generateKnightMoves()`.

A knight can jump to eight possible target squares. The code stores those jumps as file/rank offsets:

```cpp
int fileOffsets[8] = { 1, 2, 2, 1, -1, -2, -2, -1 };
int rankOffsets[8] = { 2, 1, -1, -2, -2, -1, 1, 2 };
```

For each possible jump, the code checks:

- Is the target still on the board?
- Is the target free of friendly pieces?

Knights can jump over pieces, so the code does not check any squares between the start and destination.

## Bishops

Bishops are handled in `generateBishopMoves()`.

A bishop slides diagonally. The code checks these four directions:

```text
up-right
down-right
up-left
down-left
```

For each direction, `addSlidingMovesInDirection()` walks one square at a time.

It stops when:

- It reaches the edge of the board.
- It hits a friendly piece.
- It captures an enemy piece.

## Rooks

Rooks are handled in `generateRookMoves()`.

A rook slides in straight lines. The code checks these four directions:

```text
right
left
up
down
```

It uses the same sliding helper as bishops.

## Queens

Queens are handled in `generateQueenMoves()`.

A queen moves like a rook plus a bishop, so the code checks all eight sliding directions.

## Kings

Kings are handled in `generateKingMoves()`.

A king moves one square in any direction. For each possible king move, the code checks:

- Is the target on the board?
- Is the target free of friendly pieces?

The generator does not check whether the destination square is attacked.

## How the Driver Uses These Moves

The console driver in `backend/src/driver.c++` uses `MoveGenerator::generateMoves()` to simulate a simple player-vs-player game.

The loop works like this:

1. Start from `Position::startingPosition()`.
2. Print the board.
3. Prompt the current side for a move like `e2 e4`.
4. Parse the two square names into `Square` values.
5. Generate pseudo-legal moves for `board.sideToMove`.
6. Search for a generated move with the requested start and stop squares.
7. If the move exists, apply it:
   - remove an enemy piece from the destination square, if present
   - remove the moving piece from the start square
   - place the moving piece on the destination square
   - switch `sideToMove`
8. Repeat until the user enters `quit` or input ends.

The driver does not currently:

- reject moves that expose or ignore check
- detect check, checkmate, or stalemate
- update castling rights
- generate or apply castling
- update `enPassantSquare` after double pawn moves
- perform the special captured-pawn removal for en passant
- promote pawns
- track halfmove/fullmove clocks during play

The driver is therefore a pseudo-legal movement demo, not a complete chess rules engine.

## Simple Reading Order

If you are new to this file, read it in this order:

1. `generateMoves()`
2. `generatePawnMoves()`
3. `generateKnightMoves()`
4. `addSlidingMovesInDirection()`
5. `generateBishopMoves()`
6. `generateRookMoves()`
7. `generateQueenMoves()`
8. `generateKingMoves()`
9. `driver.c++`

That order starts with the easiest pieces, then explains the shared sliding logic, then shows how the generated moves are used by the console demo.
