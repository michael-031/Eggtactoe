"""
Egg Chess – Gemini AI opponent.

Public API
----------
get_ai_move(game_state, ai_player, api_key="")
    → {"size": "small|medium|large", "cellIndex": 0-8, "source": "gemini|random"}

API key priority:
  1. `api_key` argument (sent by the frontend)
  2. GEMINI_API_KEY environment variable
  3. No key → random valid move (silent fallback, no crash)
"""

import json
import os
import random
import re

from game import SIZE_VALUE

# ── Valid-move helper (mirrors frontend getValidCells) ────────────────────────

def get_valid_moves(game_state: dict, player: int) -> list[dict]:
    """Return every legal {size, cellIndex} move for *player* given *game_state*."""
    moves = []
    for size, rank in SIZE_VALUE.items():
        remaining = game_state["players"][str(player)].get(size, 0)
        if remaining <= 0:
            continue
        for cell in game_state["board"]:
            top = cell["topPiece"]
            if top is None:
                moves.append({"size": size, "cellIndex": cell["index"]})
            elif top["player"] != player and rank > SIZE_VALUE[top["size"]]:
                moves.append({"size": size, "cellIndex": cell["index"]})
    return moves


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt(game_state: dict, ai_player: int) -> str:
    human = 2 if ai_player == 1 else 1

    # Board description
    rows = []
    for cell in game_state["board"]:
        idx = cell["index"]
        top = cell["topPiece"]
        if top is None:
            rows.append(f"  Cell {idx}: empty")
        else:
            owner = "YOUR egg" if top["player"] == ai_player else "OPPONENT egg"
            rows.append(f"  Cell {idx}: {owner} ({top['size']})")
    board_str = "\n".join(rows)

    p = game_state["players"][str(ai_player)]

    return f"""You are playing Egg Chess as Player {ai_player}. Your opponent is Player {human}.

BOARD LAYOUT (cell indices):
  [0][1][2]   ← top row
  [3][4][5]   ← middle row
  [6][7][8]   ← bottom row

WIN LINES (need 3 in a line):
  Rows: [0,1,2] [3,4,5] [6,7,8]
  Cols: [0,3,6] [1,4,7] [2,5,8]
  Diagonals: [0,4,8] [2,4,6]

RULES:
- Place on any EMPTY cell.
- Place a LARGER piece on an OPPONENT'S SMALLER piece (gobbling — your piece covers theirs).
- You CANNOT place on your own piece.
- Sizes: small(1) < medium(2) < large(3).
- Only the TOP piece of each cell counts for winning.

CURRENT BOARD:
{board_str}

YOUR REMAINING PIECES: small×{p['small']}, medium×{p['medium']}, large×{p['large']}

STRATEGY (apply in order):
1. Win immediately if you can complete a line.
2. Block opponent from winning next turn.
3. Prefer center (cell 4), then corners (0, 2, 6, 8), then edges (1, 3, 5, 7).
4. Use gobbling to steal cells the opponent controls when tactically useful.

Reply with ONLY a JSON object — no markdown, no explanation:
{{"size": "small", "cellIndex": 4}}"""


# ── Response parser ───────────────────────────────────────────────────────────

def _parse_move(text: str) -> dict | None:
    """Extract {size, cellIndex} from a Gemini response string."""
    # Try direct JSON parse first
    try:
        data = json.loads(text.strip())
        if "size" in data and "cellIndex" in data:
            return {"size": str(data["size"]), "cellIndex": int(data["cellIndex"])}
    except (json.JSONDecodeError, KeyError, ValueError):
        pass

    # Try to pull a JSON object out of surrounding text
    match = re.search(r'\{\s*"size"\s*:\s*"(\w+)"\s*,\s*"cellIndex"\s*:\s*(\d)\s*\}', text)
    if match:
        return {"size": match.group(1), "cellIndex": int(match.group(2))}

    return None


# ── Main entry point ──────────────────────────────────────────────────────────

def get_ai_move(game_state: dict, ai_player: int, api_key: str = "") -> dict:
    """
    Ask Gemini for the best move.
    Falls back to a random valid move on any error (missing key, API failure,
    invalid/illegal response).
    """
    valid_moves = get_valid_moves(game_state, ai_player)
    if not valid_moves:
        return {"error": "No valid moves available for AI"}

    # Resolve API key
    key = (api_key or "").strip() or os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return {**random.choice(valid_moves), "source": "random"}

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)
        prompt = _build_prompt(game_state, ai_player)

        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,       # deterministic enough for strategy
                max_output_tokens=64,  # only a short JSON needed
            ),
        )

        move = _parse_move(response.text.strip())

        # Validate the parsed move is actually legal
        if move and any(
            m["size"] == move["size"] and m["cellIndex"] == move["cellIndex"]
            for m in valid_moves
        ):
            return {**move, "source": "gemini"}

        # Illegal / unparseable response → random fallback
        print(f"[AI] Unusable Gemini response: {response.text!r}")

    except Exception as exc:
        print(f"[AI] Gemini error: {exc}")

    return {**random.choice(valid_moves), "source": "random"}
