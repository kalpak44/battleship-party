from __future__ import annotations

import random
import string

rooms: dict[str, dict] = {}

def gen_room_id() -> str:
    # 4 digits like in your style
    return "".join(random.choice(string.digits) for _ in range(4))

def create_room(default_lang: str) -> str:
    for _ in range(2000):
        rid = gen_room_id()
        if rid not in rooms:
            rooms[rid] = {
                "room_id": rid,
                "default_lang": default_lang,
                "players": {},  # pid -> {name, lang, ws, ready, placed, ship_map, state_board}
                "phase": "lobby",  # lobby|battle|game_over
                "turn": None,  # pid
                "winner": None,
            }
            return rid
    # fallback
    rid = gen_room_id()
    rooms[rid] = {
        "room_id": rid,
        "default_lang": default_lang,
        "players": {},
        "phase": "lobby",
        "turn": None,
        "winner": None,
    }
    return rid
