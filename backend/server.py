"""
Egg Chess – Flask REST API
Run:  python server.py
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from game import EggChessGame

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


if __name__ == "__main__":
    app.run(port=3001, debug=True)
