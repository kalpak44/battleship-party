# Battleship Party

## What it is
- A light, fast browser-based take on the classic Battleship for two players.
- Create or join a 4-digit room and play in real time in your browser.
- Multilingual UI: English, Русский, Български (switchable at any time).
- Mobile-friendly layout and controls.
- No sign-up, no database; rooms live in memory.

## How to play
1. Open the app in your browser.
2. Enter your name and choose a language.
3. Create a new game to get a 4-digit room code, or join an existing room.
4. Place your ships according to the fleet and press Ready.
5. The game starts only when both players are Ready.
6. Shooting phase:
   - Click/tap a cell on the enemy board to fire.
   - If you hit (or sink) a ship, you shoot again.
   - If you miss, the turn passes to your opponent.
   - When a ship is sunk, surrounding cells are auto-marked as misses to avoid meaningless shots.
7. The game ends when one player sinks all enemy ships. A win/lose message is shown to both.

## Game rules (quick)
- Board size: 10×10.
- Fleet: lengths `[4, 3, 3, 2, 2, 2, 1, 1, 1, 1]`.
- Ships must be straight (horizontal or vertical), contiguous, and cannot touch each other even diagonally.
- One shot per action; hitting (or sinking) grants another shot; only a miss switches the turn.
- Winner is the first to sink all opponent ships.

## Tech overview
- Backend: FastAPI + WebSockets
- Frontend: Vanilla HTML + Tailwind CSS
- Real-time: WebSocket game state sync
- Storage: In-memory rooms (no database)
- Auth: None (enter a name and play)

## Play locally (without Docker)
1. Install Python 3.12 or newer.
2. In the project folder run:
   ```bash
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
3. Open http://localhost:8000 in your browser.

## Run with Docker
- Build and run locally:
  ```bash
  docker build -t battleship-party:local .
  docker run --rm -p 8000:8000 battleship-party:local
  ```
- Or use the published image:
  ```bash
  docker run --rm -p 8000:8000 kalpak44/battleship-party:latest
  ```

Open the game at: http://localhost:8000

## Notes
- Room codes are four digits; rooms are destroyed automatically when empty.
- State is in-process memory; run a single instance or use a shared store (e.g., Redis) if you plan to scale horizontally.
- Touch interactions and layout are optimized for mobile.
---

Have fun — and good hunting!