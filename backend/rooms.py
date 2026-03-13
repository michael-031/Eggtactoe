"""
Egg Chess – in-memory room registry for online multiplayer.

API
---
create_room()         → room_id (str)
join_room(rid)        → (room_dict | None, error_str | None)
get_room(rid)         → room_dict | None
cleanup_expired()     → None  (removes rooms idle > ROOM_TTL seconds)

Room dict shape:
{
    "game":          EggChessGame instance,
    "player2Joined": bool,
    "lastActivity":  float  (Unix timestamp),
}
"""

import random
import string
import time

from game import EggChessGame

ROOM_TTL = 1800  # seconds – expire rooms after 30 min of inactivity
_rooms: dict = {}


def _gen_id() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def create_room() -> str:
    """Create a new room and return its ID."""
    rid = _gen_id()
    while rid in _rooms:
        rid = _gen_id()
    _rooms[rid] = {
        "game": EggChessGame(),
        "player2Joined": False,
        "lastActivity": time.time(),
    }
    return rid


def join_room(rid: str):
    """Join an existing room as Player 2.

    Returns (room_dict, None) on success, or (None, error_str) on failure.
    """
    room = _rooms.get(rid)
    if not room:
        return None, "Room not found"
    if room["player2Joined"]:
        return None, "Room is full"
    room["player2Joined"] = True
    room["lastActivity"] = time.time()
    return room, None


def get_room(rid: str):
    """Return the room dict (and update lastActivity), or None."""
    room = _rooms.get(rid)
    if room:
        room["lastActivity"] = time.time()
    return room


def cleanup_expired() -> None:
    """Delete rooms that have been idle for more than ROOM_TTL seconds."""
    cutoff = time.time() - ROOM_TTL
    expired = [rid for rid, r in list(_rooms.items()) if r["lastActivity"] < cutoff]
    for rid in expired:
        del _rooms[rid]
