# Chess

This is a chess engine project built from scratch with a C++ backend. The backend currently contains the board-position model, initial board setup, piece lookup, terminal board printing, a runnable driver, and GoogleTest coverage. The `frontend` directory is reserved for the future user interface.

## Quick Start

### 1. Install prerequisites

For a native build, install Git, CMake 3.20 or newer, and a C++17 compiler. On Windows, install Visual Studio 2022 or Build Tools with C++ support. On Linux, install GCC or Clang and the usual build tools. On macOS, install the Xcode Command Line Tools.

Docker can be used instead of installing CMake and a compiler locally. See [DEVELOPER_MANUAL.md](DEVELOPER_MANUAL.md) for the longer setup guide.

### 2. Clone and open the repository

```bash
git clone <repository-url>
cd chess
```

Open the `chess` folder in VS Code. Do not open only `backend/src` or the generated `build` directory.

### 3. Configure the backend

Run these commands from the repository root:

```bash
cmake -S backend -B backend/build
```

This creates the CMake build directory and downloads GoogleTest through CMake's `FetchContent` configuration.

### 4. Build the driver and tests

```bash
cmake --build backend/build --target chess_driver position_test
```

The important targets are `chess_driver`, which prints the initial position, and `position_test`, which runs the backend tests.

### 5. Run the driver

On Windows with the Visual Studio generator:

```powershell
.\backend\build\Debug\chess_driver.exe
```

On Make or Ninja generators:

```bash
./backend/build/chess_driver
```

### 6. Run the tests

```bash
ctest --test-dir backend/build --output-on-failure
```

Use this CMake/CTest path so the correct include directories, library, and GoogleTest dependency are used.

## Running from VS Code

Install the Microsoft **CMake Tools** and **C/C++** extensions.

1. Open the repository root in VS Code.
2. Run `CMake: Configure` from the Command Palette and choose an installed C++ kit.
3. Select the `chess_driver` target in the CMake status bar.
4. Run `CMake: Build`.
5. Run `CMake: Run Without Debugging` to launch the driver.
6. Run `CMake: Run Test` or use the Testing panel for GoogleTest.

Do not use `C/C++: g++.exe build active file`. That compiles only the open file and bypasses CMake's include paths and library linking.

## How the repository works

The backend has three parts:

1. **Position library**: `backend/src/position.c++` implements the `Position` type declared in `backend/include/chess/position.h`.
2. **Driver executable**: `backend/src/driver.c++` calls `Position::initPosition()` and `printPieces()` so the board can be viewed in a terminal.
3. **Tests**: `backend/test/position_test.cpp` verifies piece placement, removal, initial setup, `pieceAt()`, and printed board output.

`Position` stores one bitboard for each color and piece type:

```text
pieces[color][piece type]
```

The `Square` enum maps the 64 chess squares to bit positions from `A1` through `H8`. `setPiece()` turns on a bit, `removePiece()` clears it, and `hasPiece()` checks it. `pieceAt()` returns a display token such as `WR` for a white rook or `--` for an empty square.

## Repository layout

```text
chess/
├── backend/
│   ├── CMakeLists.txt       # Backend targets and GoogleTest setup
│   ├── Dockerfile           # Container build environment
│   ├── include/chess/       # Public C++ headers
│   ├── src/                 # Backend implementations and driver
│   ├── test/                # GoogleTest tests
│   └── build/               # Generated files; recreate with CMake
├── frontend/                # Reserved for the future UI
├── DEVELOPER_MANUAL.md      # Longer setup and Docker instructions
├── docker-compose.yml       # Containerized backend workflow
└── README.md
```

Build directories contain generated files and should not be edited by hand. If a build becomes stale, remove `backend/build` and configure it again. In Bash:

```bash
rm -rf backend/build
cmake -S backend -B backend/build
```

In PowerShell:

```powershell
Remove-Item -Recurse -Force backend\build
cmake -S backend -B backend/build
```

## Docker

From the repository root, with Docker installed:

```bash
docker compose up --build
```

The container configures CMake, builds `position_test`, and runs CTest. Docker is optional; the native CMake workflow is the primary development path.

## Current scope and next steps

Implemented now:

- Bitboard-backed position storage
- Initial chess position setup
- Piece placement and removal
- Piece lookup by square
- Terminal board printing
- GoogleTest coverage

Not implemented yet:

- Legal move generation
- Check and checkmate detection
- Castling and en passant behavior
- Promotion
- Game/session server
- Frontend gameplay UI

When adding a feature, put its public header in `backend/include/chess/`, its implementation in `backend/src/`, and its tests in `backend/test/`. Add new implementation and test source files to the appropriate target in `backend/CMakeLists.txt`, then configure, build, and run CTest again.