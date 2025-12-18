from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uuid
import re
import os
import random

from app.rooms import rooms, create_room
from app.game_data import GAME_DATA
from app.battleship import (
    make_empty_board,
    validate_fleet,
    apply_shot,
    all_ships_sunk,
)

ROOM_RE = re.compile(r"^\d{4}$")

app = FastAPI()

# CORS (configurable via ALLOWED_ORIGINS env, comma-separated). Defaults to allow current origin only via "*" for simplicity
allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
allow_credentials = "*" not in allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ui/{lang}")
def get_ui_data(lang: str):
    """Return UI strings and ship data for the requested language.
    Falls back to English when lang is unknown.
    """
    lang = (lang or "").strip().lower()
    if lang not in GAME_DATA:
        lang = "en"
    data = GAME_DATA[lang]
    return {"ui": data["ui"], "ships": data.get("ships", {})}


@app.post("/create/{lang}")
def create(lang: str):
    lang = (lang or "").strip().lower()
    if lang not in GAME_DATA:
        lang = "en"
    return {"room_id": create_room(lang)}


async def safe_send(ws: WebSocket, msg: dict):
    try:
        await ws.send_json(msg)
    except Exception:
        pass


async def broadcast(room: dict, msg: dict):
    for p in list(room["players"].values()):
        await safe_send(p["ws"], msg)


def room_snapshot(room: dict) -> dict:
    return {
        "type": "state",
        "phase": room["phase"],
        "turn_name": room["players"].get(room["turn"], {}).get("name") if room.get("turn") else None,
        "players": [
            {
                "name": p["name"],
                "ready": bool(p.get("ready")),
                "placed": bool(p.get("placed")),
                "lang": p["lang"],
            }
            for p in room["players"].values()
        ],
        "winner": room.get("winner"),
    }


def get_ui(lang: str, room: dict) -> dict:
    if lang not in GAME_DATA:
        lang = room.get("default_lang", "en")
    return GAME_DATA[lang]["ui"]


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    room_id = (room_id or "").strip()
    await ws.accept()

    # validate room_id format and existence
    if not ROOM_RE.match(room_id) or room_id not in rooms:
        # best-effort localized error
        try:
            peek = await ws.receive_json()
            lang = (peek.get("lang") or "en").strip().lower()
        except Exception:
            lang = "en"
        ui = GAME_DATA.get(lang, GAME_DATA["en"])["ui"]
        await safe_send(ws, {"type": "error", "message": ui.get("invalid_move", "Error")})
        await ws.close(code=1008)
        return

    room = rooms[room_id]
    pid = uuid.uuid4().hex

    try:
        join = await ws.receive_json()
        name = (join.get("name") or "").strip()
        lang = (join.get("lang") or room["default_lang"]).strip().lower()
        if lang not in GAME_DATA:
            lang = room["default_lang"]

        ui = get_ui(lang, room)
        fleet = GAME_DATA[lang]["ships"]["fleet"]

        if not name:
            await safe_send(ws, {"type": "error", "message": ui["enter_name"]})
            await ws.close(code=1008)
            return

        # only 2 players
        if len(room["players"]) >= 2 and pid not in room["players"]:
            # use English fallback; could be extended to GAME_DATA if needed
            await safe_send(ws, {"type": "error", "message": "Room is full"})
            await ws.close(code=1008)
            return

        # unique name
        if name.casefold() in {p["name"].casefold() for p in room["players"].values()}:
            await safe_send(ws, {"type": "error", "message": "Name already taken"})
            await ws.close(code=1008)
            return

        room["players"][pid] = {
            "pid": pid,
            "ws": ws,
            "name": name,
            "lang": lang,
            "ready": False,
            "placed": False,
            "ship_map": None,     # placement map 0/1
            "state_board": None,  # server internal state board: hit/miss marks on top of ship_map
        }

        # init message (send ui + fleet)
        await safe_send(ws, {
            "type": "init",
            "room_id": room_id,
            "pid": pid,
            "ui": ui,
            "fleet": fleet,
            "board_size": 10,
        })

        await broadcast(room, room_snapshot(room))

        while True:
            msg = await ws.receive_json()
            t = msg.get("type")

            # Place ships
            if t == "place":
                p = room["players"].get(pid)
                if not p or room["phase"] != "lobby":
                    continue

                board = msg.get("board")
                if not isinstance(board, list):
                    await safe_send(ws, {"type": "error", "message": ui["invalid_placement"]})
                    continue

                if not validate_fleet(board, fleet):
                    await safe_send(ws, {"type": "error", "message": ui["invalid_placement"]})
                    continue

                p["ship_map"] = board
                p["state_board"] = [row[:] for row in board]  # copy for state tracking (hits overwrite)
                p["placed"] = True
                await broadcast(room, room_snapshot(room))

            # Ready / unready
            elif t == "set_ready":
                p = room["players"].get(pid)
                if not p or room["phase"] != "lobby":
                    continue
                ready = bool(msg.get("ready"))
                # can only be ready if placed
                if ready and not p.get("placed"):
                    await safe_send(ws, {"type": "error", "message": ui["invalid_placement"]})
                    continue
                p["ready"] = ready
                await broadcast(room, room_snapshot(room))

                # start game if both ready
                if len(room["players"]) == 2 and all(x.get("ready") for x in room["players"].values()):
                    room["phase"] = "battle"
                    # choose first turn randomly to be fair
                    pids = list(room["players"].keys())
                    room["turn"] = random.choice(pids)
                    await broadcast(room, {"type": "phase", "phase": "battle"})
                    await broadcast(room, room_snapshot(room))
                    # notify whose turn per player
                    for apid, ap in room["players"].items():
                        aui = get_ui(ap["lang"], room)
                        await safe_send(ap["ws"], {
                            "type": "turn",
                            "your_turn": (room["turn"] == apid),
                            "text": aui["your_turn"] if room["turn"] == apid else aui["opponent_turn"],
                        })

            # Update player's language preference during a session
            elif t == "set_lang":
                p = room["players"].get(pid)
                if not p:
                    continue
                new_lang = (msg.get("lang") or p["lang"]).strip().lower()
                if new_lang not in GAME_DATA:
                    new_lang = p["lang"]
                p["lang"] = new_lang
                # Send updated UI to the requester and refresh state for everyone
                await safe_send(p["ws"], {
                    "type": "init_ui",
                    "ui": GAME_DATA[new_lang]["ui"],
                    "fleet": GAME_DATA[new_lang]["ships"]["fleet"],
                })
                await broadcast(room, room_snapshot(room))

            # Shooting
            elif t == "shot":
                if room["phase"] != "battle":
                    continue
                if room.get("turn") != pid:
                    continue

                x = int(msg.get("x", -1))
                y = int(msg.get("y", -1))

                # opponent
                op_pid = next((k for k in room["players"].keys() if k != pid), None)
                if not op_pid:
                    continue
                shooter = room["players"][pid]
                opponent = room["players"][op_pid]

                op_ship_map = opponent.get("ship_map")
                op_state = opponent.get("state_board")
                if op_ship_map is None or op_state is None:
                    continue

                ok, res, sunk_cells = apply_shot(op_state, op_ship_map, x, y)
                if not ok or res == "invalid":
                    await safe_send(ws, {"type": "error", "message": get_ui(shooter["lang"], room)["invalid_move"]})
                    continue

                # Turn rules: shooter continues on hit/sunk; switch only on miss.
                # "repeat" (already fired cell) leaves turn unchanged.
                if res == "miss":
                    room["turn"] = op_pid

                # check win
                game_over = False
                winner_pid = None
                if all_ships_sunk(op_state, op_ship_map):
                    game_over = True
                    winner_pid = pid
                    room["phase"] = "game_over"
                    room["winner"] = shooter["name"]

                # broadcast shot result to both
                for apid, ap in room["players"].items():
                    aui = get_ui(ap["lang"], room)
                    # who fired?
                    fired_by_you = (apid == pid)
                    result_text = {
                        "miss": aui["miss"],
                        "hit": aui["hit"],
                        "sunk": aui["sunk"],
                        "repeat": aui["invalid_move"],
                    }.get(res, "")

                    await safe_send(ap["ws"], {
                        "type": "shot_result",
                        "x": x,
                        "y": y,
                        "result": res,             # miss|hit|sunk|repeat
                        "sunk_cells": list(sunk_cells) if sunk_cells else None,
                        "fired_by_you": fired_by_you,
                        "your_turn": (room.get("turn") == apid) if room["phase"] == "battle" else False,
                        "result_text": result_text,
                        "phase": room["phase"],
                        "winner": room.get("winner"),
                    })

                await broadcast(room, room_snapshot(room))

                if game_over and winner_pid:
                    # personalized end messages
                    for apid, ap in room["players"].items():
                        aui = get_ui(ap["lang"], room)
                        await safe_send(ap["ws"], {
                            "type": "game_over",
                            "message": aui["you_win"] if apid == winner_pid else aui["you_lose"]
                        })

            # simple ping
            elif t == "ping":
                await safe_send(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        # cleanup
        if room_id in rooms:
            room = rooms[room_id]
            left = room["players"].pop(pid, None)
            if room["players"]:
                # if we were mid-battle, declare winner as the one who stayed
                if room.get("phase") == "battle":
                    # the only remaining player wins
                    remaining_pid = next(iter(room["players"].keys()))
                    winner_name = room["players"][remaining_pid]["name"]
                    room["phase"] = "game_over"
                    room["winner"] = winner_name
                    # notify remaining player with localized message
                    for apid, ap in room["players"].items():
                        aui = get_ui(ap["lang"], room)
                        await safe_send(ap["ws"], {
                            "type": "game_over",
                            "message": aui.get("you_win", "You win!"),
                        })
                else:
                    # lobby or already game over: just inform
                    for ap in room["players"].values():
                        aui = get_ui(ap["lang"], room)
                        await safe_send(ap["ws"], {"type": "info", "message": aui["opponent_left"]})

                await broadcast(room, room_snapshot(room))
            else:
                rooms.pop(room_id, None)
