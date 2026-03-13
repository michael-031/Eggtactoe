"""
Egg Chess – Flask REST API
Run:  python server.py
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from game import EggChessGame
from ai import get_ai_move
from rooms import create_room, join_room, get_room, cleanup_expired

app = Flask(__name__)
CORS(app)

game = EggChessGame()


@app.get("/api/state")
def get_state():
    return jsonify(game.get_state())


@app.post("/api/move")
def make_move():
    data = request.get_json(force=True)
    player = data.get("player")
    size = data.get("size")
    cell_index = data.get("cellIndex")

    if player is None or size is None or cell_index is None:
        return jsonify({"success": False, "message": "Missing required fields"}), 400

    result = game.place_piece(int(player), size, int(cell_index))
    status = 200 if result["success"] else 400
    return jsonify(result), status


@app.post("/api/reset")
def reset_game():
    game.reset()
    return jsonify({"success": True, "gameState": game.get_state()})


@app.post("/api/ai-move")
def ai_move():
    data      = request.get_json(force=True)
    ai_player = int(data.get("aiPlayer", 2))
    api_key   = data.get("apiKey", "")

    state = game.get_state()

    if state["gameOver"]:
        return jsonify({"success": False, "message": "Game is already over"}), 400
    if state["currentPlayer"] != ai_player:
        return jsonify({"success": False, "message": "Not the AI's turn"}), 400

    move = get_ai_move(state, ai_player, api_key=api_key)

    if "error" in move:
        return jsonify({"success": False, "message": move["error"]}), 400

    result = game.place_piece(ai_player, move["size"], move["cellIndex"])
    if result["success"]:
        result["aiMove"] = move
    return jsonify(result), 200 if result["success"] else 400


# ── Room helpers ──────────────────────────────────────────────────────────────

def _room_state(room: dict, rid: str) -> dict:
    return {
        "roomId":        rid,
        "player2Joined": room["player2Joined"],
        "gameState":     room["game"].get_state(),
    }


# ── Room routes ───────────────────────────────────────────────────────────────

@app.post("/api/rooms")
def create_room_route():
    cleanup_expired()
    rid = create_room()
    return jsonify({"success": True, "roomId": rid, "playerNumber": 1})


@app.post("/api/rooms/<rid>/join")
def join_room_route(rid):
    room, err = join_room(rid.upper())
    if err:
        return jsonify({"success": False, "message": err}), 400
    return jsonify({"success": True, "roomId": rid.upper(), "playerNumber": 2})


@app.get("/api/rooms/<rid>/state")
def room_state_route(rid):
    room = get_room(rid.upper())
    if not room:
        return jsonify({"success": False, "message": "Room not found"}), 404
    return jsonify({"success": True, **_room_state(room, rid.upper())})


@app.post("/api/rooms/<rid>/move")
def room_move_route(rid):
    room = get_room(rid.upper())
    if not room:
        return jsonify({"success": False, "message": "Room not found"}), 404
    if not room["player2Joined"]:
        return jsonify({"success": False, "message": "Waiting for Player 2"}), 400
    data   = request.get_json(force=True)
    result = room["game"].place_piece(
        int(data["player"]), data["size"], int(data["cellIndex"])
    )
    if result["success"]:
        return jsonify({"success": True, "gameState": result["gameState"]})
    return jsonify(result), 400


@app.post("/api/rooms/<rid>/reset")
def room_reset_route(rid):
    room = get_room(rid.upper())
    if not room:
        return jsonify({"success": False, "message": "Room not found"}), 404
    room["game"].reset()
    return jsonify({"success": True, "gameState": room["game"].get_state()})


if __name__ == "__main__":
    app.run(port=3001, debug=True)
