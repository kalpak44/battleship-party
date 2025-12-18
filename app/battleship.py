from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple, Optional, Set

N = 10  # board size

WATER = 0
SHIP = 1
HIT = 2
MISS = -1

Coord = Tuple[int, int]  # (x, y)

def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < N and 0 <= y < N

def neighbors8(x: int, y: int):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if in_bounds(nx, ny):
                yield nx, ny

def make_empty_board() -> List[List[int]]:
    return [[WATER for _ in range(N)] for _ in range(N)]

def validate_fleet(board: List[List[int]], fleet: List[int]) -> bool:
    """
    Validate:
    - all ships are straight (H/V)
    - ship counts match fleet by lengths
    - ships do not touch each other even diagonally
    - only values 0/1 are allowed in placement board
    """
    if len(board) != N or any(len(row) != N for row in board):
        return False
    for row in board:
        for v in row:
            if v not in (WATER, SHIP):
                return False

    # quick touch check: any SHIP cell cannot have any SHIP in 8-neighborhood not part of same ship adjacency?
    # We'll do full component extraction (4-neighborhood) then ensure diagonal/side-touch between different comps doesn't exist.
    visited = [[False] * N for _ in range(N)]

    comps: List[Set[Coord]] = []

    def dfs(sx: int, sy: int) -> Set[Coord]:
        stack = [(sx, sy)]
        comp: Set[Coord] = set()
        visited[sy][sx] = True
        while stack:
            x, y = stack.pop()
            comp.add((x, y))
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = x + dx, y + dy
                if in_bounds(nx, ny) and not visited[ny][nx] and board[ny][nx] == SHIP:
                    visited[ny][nx] = True
                    stack.append((nx, ny))
        return comp

    for y in range(N):
        for x in range(N):
            if board[y][x] == SHIP and not visited[y][x]:
                comps.append(dfs(x, y))

    # Each component must be a straight line
    lengths: List[int] = []
    for comp in comps:
        xs = {x for x, _ in comp}
        ys = {y for _, y in comp}
        if len(xs) != 1 and len(ys) != 1:
            return False
        # contiguous check
        if len(xs) == 1:
            x = next(iter(xs))
            y_list = sorted([y for _, y in comp])
            if y_list != list(range(y_list[0], y_list[0] + len(y_list))):
                return False
        else:
            y = next(iter(ys))
            x_list = sorted([x for x, _ in comp])
            if x_list != list(range(x_list[0], x_list[0] + len(x_list))):
                return False
        lengths.append(len(comp))

    # ships cannot touch diagonally or by side if different comps:
    ship_cells = [(x, y) for y in range(N) for x in range(N) if board[y][x] == SHIP]
    comp_id = {}
    for i, comp in enumerate(comps):
        for c in comp:
            comp_id[c] = i

    for x, y in ship_cells:
        for nx, ny in neighbors8(x, y):
            if board[ny][nx] == SHIP and comp_id[(nx, ny)] != comp_id[(x, y)]:
                return False

    # Fleet match
    want = sorted(fleet)
    got = sorted(lengths)
    return want == got

def apply_shot(op_board: List[List[int]], op_ship_map: List[List[int]], x: int, y: int):
    """
    op_board: visible state board containing WATER/SHIP/HIT/MISS? We keep separate:
      - op_ship_map is the original placement map with WATER/SHIP
      - op_board is "state board": WATER/SHIP/HIT/MISS (SHIP used internally)
    Returns tuple (ok, result_type, sunk_cells_or_none)
      result_type: "miss" | "hit" | "sunk" | "repeat"
    """
    if not in_bounds(x, y):
        return False, "invalid", None

    cur = op_board[y][x]
    if cur in (HIT, MISS):
        return True, "repeat", None

    if op_ship_map[y][x] == SHIP:
        op_board[y][x] = HIT
        # check if that ship is sunk: find component on ship_map, see if all cells hit on state board
        comp = ship_component(op_ship_map, x, y)
        if all(op_board[cy][cx] == HIT for cx, cy in comp):
            return True, "sunk", comp
        return True, "hit", None
    else:
        op_board[y][x] = MISS
        return True, "miss", None

def ship_component(ship_map: List[List[int]], sx: int, sy: int) -> Set[Coord]:
    if ship_map[sy][sx] != SHIP:
        return set()
    seen = set()
    stack = [(sx, sy)]
    seen.add((sx, sy))
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x + dx, y + dy
            if in_bounds(nx, ny) and (nx, ny) not in seen and ship_map[ny][nx] == SHIP:
                seen.add((nx, ny))
                stack.append((nx, ny))
    return seen

def all_ships_sunk(state_board: List[List[int]], ship_map: List[List[int]]) -> bool:
    for y in range(N):
        for x in range(N):
            if ship_map[y][x] == SHIP and state_board[y][x] != HIT:
                return False
    return True
