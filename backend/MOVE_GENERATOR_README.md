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

- `pieceColor`: the moving side, `White` or `Black`
- `piece`: the moving piece type, such as `Pawn` or `Knight`
- `startSquare`: where the piece starts
- `stopSquare`: where the piece moves

The generator only creates move descriptions. It does not update the board.

## Important Meaning: Pseudo-Legal

The current generator creates pseudo-legal moves.

That means:

- The piece moves in the correct shape.
- The destination is on the board.
- The destination is empty or has an enemy piece.
- The destination does not have a friendly piece.

But it does not yet check every chess rule.

Not handled yet:

- Moving into check
- Leaving your king in check
- Checkmate
- Stalemate
- Castling
- En passant
- Promotion

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

This makes edge checks easier. For example, a move is off the board if `file` is less than `0` or greater than `7`.

## Helper Functions

The top of `moveGenerator.c++` has small helper functions.

`isOnBoard(file, rank)` checks whether a file/rank pair is inside the chess board.

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

Why:

- White pawns move toward higher square numbers.
- Black pawns move toward lower square numbers.

A pawn can:

- Move forward one square if that square is empty.
- Move forward two squares from its starting rank if both squares are empty.
- Capture one square diagonally forward if that square has an enemy piece.

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

Example:

- White knight on `D4`
- `E6` is empty

Generated move:

```text
D4 -> E6
```

If `E6` has a white piece, that move is not generated.

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

Example:

- White bishop on `D4`
- Empty squares on `E5` and `F6`

Generated moves include:

```text
D4 -> E5
D4 -> F6
```

If a black piece is on `F6`, then `D4 -> F6` is generated, but squares past `F6` are not.

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

Example:

- White rook on `D4`
- Empty square on `D5`
- Black piece on `D6`

Generated moves include:

```text
D4 -> D5
D4 -> D6
```

The rook stops at `D6` because that square has a captured enemy piece.

## Queens

Queens are handled in `generateQueenMoves()`.

A queen moves like a rook plus a bishop.

So the code checks all eight directions:

```text
right, left, up, down
up-right, down-right, up-left, down-left
```

It uses the same sliding helper as bishops and rooks.

Example:

- White queen on `D4`

Generated moves can include:

```text
D4 -> D8
D4 -> H4
D4 -> H8
D4 -> A1
```

## Kings

Kings are handled in `generateKingMoves()`.

A king moves one square in any direction. The code uses eight file/rank offsets, just like the knight code, but each offset is only one square away.

For each possible king move, the code checks:

- Is the target on the board?
- Is the target free of friendly pieces?

Example:

- White king on `D4`
- Black piece on `E5`
- White piece on `D5`

Generated:

```text
D4 -> E5
```

Not generated:

```text
D4 -> D5
```

The `D5` move is blocked by a friendly piece.

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

That order starts with the easiest pieces, then explains the shared sliding logic, then shows how the sliding pieces use it.
