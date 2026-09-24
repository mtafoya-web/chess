# Developer Manual

This project contains a C++ chess backend and a frontend shell. The backend is the part that currently builds and runs tests.

## 1. Prerequisites

You need the following installed on the machine where you want to develop:

- Git
- CMake 3.20 or newer
- A C++ compiler
  - Windows: Visual Studio 2022 Build Tools or MSVC
  - macOS: Xcode Command Line Tools
  - Linux: build-essential and g++

If you are using Docker, you only need:

- Docker
- Docker Compose (optional, but recommended)

## 2. Clone the repository

```bash
git clone https://github.com/<your-user>/<your-repo>.git
cd chess
```

## 3. Local setup on Windows

Open PowerShell or Command Prompt in the repository root.

### 3.1 Configure the backend

```powershell
cd backend
cmake -S . -B build
```

### 3.2 Build the tests

```powershell
cmake --build build --target position_test
```

### 3.3 Run the tests

```powershell
ctest --test-dir build --output-on-failure
```

If the tests pass, the backend is set up correctly.

## 4. Local setup on macOS or Linux

```bash
cd backend
cmake -S . -B build
cmake --build build --target position_test
ctest --test-dir build --output-on-failure
```

## 5. Typical project layout

```text
chess/
├── backend/
│   ├── CMakeLists.txt
│   ├── include/
│   ├── src/
│   ├── test/
│   └── build/
├── frontend/
├── README.md
├── DEVELOPER_MANUAL.md
├── docker-compose.yml
└── .dockerignore
```

## 6. Build troubleshooting

### CMake cannot find the source files

Check that the project path is correct and that the backend folder has:

- `CMakeLists.txt`
- `include/chess/position.h`
- `include/chess/square.h`
- `src/position.c++`
- `test/position_test.cpp`

### Compiler is missing

Install MSVC, GCC, or Clang depending on your operating system.

### Include errors

Make sure your include directories are correct and that the file names match the project imports exactly.

## 7. Containerized setup (recommended for sharing across machines)

This project can be run in a Docker container so that other developers do not need to install the same toolchain manually.

### 7.1 Build the Docker image

From the repository root:

```bash
docker build -f backend/Dockerfile -t chess-backend .
```

### 7.2 Run the container interactively

```bash
docker run --rm -it -v "${PWD}:/workspace" -w /workspace chess-backend bash
```

### 7.3 Run the backend checks inside the container

```bash
cmake -S backend -B backend/build
cmake --build backend/build --target position_test
ctest --test-dir backend/build --output-on-failure
```

### 7.4 Using Docker Compose

From the repository root:

```bash
docker compose up --build
```

This runs the backend build/test workflow in a consistent environment.

## 8. Recommended workflow for a team

- Keep the project buildable with plain CMake for local development.
- Keep the Docker setup as the default reproducible environment for onboarding.
- Share the repo with the same commands so every developer gets the same compiler and dependency versions.

## 9. Move generator and rules model

Pseudo-legal piece movement is implemented in `backend/src/moveGenerator.c++` and documented in `backend/MOVE_GENERATOR_README.md`. Read that file before changing movement rules; it explains how each piece is generated, why the code uses shared sliding-piece logic for bishops, rooks, and queens, and how to call `MoveGenerator::generateMoves()`.

The current backend uses these core types:

- `Position` stores the board, side to move, castling flags, en passant square, and move counters.
- `Piece` stores a `color` and `type`.
- `Move` stores the moving `Piece`, the `startSquare`, and the `stopSquare`.
- `MoveGenerator::generateMoves(position)` returns all pseudo-legal moves for `position.sideToMove`.

Pseudo-legal means the generator enforces basic piece movement, board bounds, friendly-piece blocking, enemy captures, and sliding-piece blockers. It does not yet enforce all complete chess rules.

Currently generated:

- pawn one-square moves
- pawn starting-rank double moves
- pawn diagonal captures
- pawn en passant target moves when `Position::enPassantSquare` is already set
- knight moves
- bishop moves
- rook moves
- queen moves
- king one-square moves

Not fully implemented yet:

- check detection
- rejecting moves that leave the king in check
- checkmate
- stalemate
- castling move generation
- promotion
- automatic en passant state updates after double pawn moves
- special en passant captured-pawn removal in the driver

## 10. Console driver simulation

The console driver lives in `backend/src/driver.c++`. It is a simple player-vs-player pseudo-legal move demo.

At runtime it:

1. Creates `Position::startingPosition()`.
2. Prints the board.
3. Prompts the current side for a move like `e2 e4`.
4. Parses the two text squares into `Square` enum values.
5. Calls `MoveGenerator::generateMoves(board)`.
6. Looks for a generated move with the requested start and stop squares.
7. Applies that move if found:
   - removes an enemy piece from the destination square, if present
   - removes the moving piece from its start square
   - places the moving piece on its stop square
   - flips `board.sideToMove`
8. Repeats until the user enters `quit` or input ends.

Because the driver uses pseudo-legal moves, it can currently allow positions that would be illegal in a full chess engine. For example, it does not prevent a king from moving into check, does not detect checkmate, and does not update castling or en passant state during play.

To run the driver after building:

```powershell
.\build\Debug\chess_driver.exe
```

## 11. Summary

The simplest path is:

1. Install Git, CMake, and a C++ compiler.
2. Run the backend CMake configure/build/test commands.
3. Use Docker as a standard way to reproduce the same environment on another machine.

This gives you both a native workflow and a portable team workflow.
