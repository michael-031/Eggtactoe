"""
Egg Chess game logic.

Board: 3x3 grid (indices 0-8, left-to-right, top-to-bottom).
Each cell holds a stack of pieces; only the top piece is visible and counts.

Piece sizes (ascending): small=1, medium=2, large=3
  - A piece can be placed on an empty cell.
  - A piece can be placed on an opponent's smaller piece (gobbling).
  - A piece cannot be placed on any of your own pieces.
  - A piece cannot be placed on an opponent's equal-or-larger piece.

Each player starts with: 3 small, 3 medium, 2 large.
Win: 3 cells in a row/column/diagonal all showing the same player.
"""

WIN_LINES = [
    (0, 1, 2), (3, 4, 5), (6, 7, 8),  # rows
    (0, 3, 6), (1, 4, 7), (2, 5, 8),  # columns
    (0, 4, 8), (2, 4, 6),              # diagonals
]

SIZE_VALUE = {"small": 1, "medium": 2, "large": 3}


class EggChessGame:
    def __init__(self):
        self.reset()

    def reset(self):
        # board[i] = list of {"player": 1|2, "size": str} stacked from bottom to top
        self.board = [[] for _ in range(9)]
        self.players = {
            1: {"small": 3, "medium": 3, "large": 2},
            2: {"small": 3, "medium": 3, "large": 2},
        }
        self.current_player = 1
        self.winner = None          # 1, 2, or "draw"
        self.game_over = False
        self.winning_line = None    # list of 3 indices when won by line
        self.win_reason = None      # 'line' | 'score' | 'noMoves'
        self.score_details = None   # set for 'score' wins
        self.last_move = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def top_piece(self, cell_index: int):
        """Return the top piece on a cell, or None if empty."""
        stack = self.board[cell_index]
        return stack[-1] if stack else None

    def can_place(self, player: int, size: str, cell_index: int):
        """Return (ok: bool, reason: str)."""
        if self.game_over:
            return False, "Game is already over"
        if player != self.current_player:
            return False, "It is not your turn"
        if size not in SIZE_VALUE:
            return False, f"Unknown size '{size}'"
        if self.players[player][size] <= 0:
            return False, f"No {size} pieces left"
        if not 0 <= cell_index <= 8:
            return False, "Invalid cell index"

        top = self.top_piece(cell_index)
        if top is None:
            return True, "ok"
        if top["player"] == player:
            return False, "Cannot place on your own piece"
        if SIZE_VALUE[size] <= SIZE_VALUE[top["size"]]:
            return False, "Can only goble smaller opponent pieces"
        return True, "ok"

    # ------------------------------------------------------------------
    # Moves
    # ------------------------------------------------------------------

    def place_piece(self, player: int, size: str, cell_index: int):
        ok, reason = self.can_place(player, size, cell_index)
        if not ok:
            return {"success": False, "message": reason}

        self.players[player][size] -= 1
        self.board[cell_index].append({"player": player, "size": size})
        self.last_move = {"player": player, "size": size, "cellIndex": cell_index}

        # 1. Three-in-a-row win
        winner = self._check_win()
        if winner:
            self.winner = winner
            self.win_reason = "line"
            self.game_over = True
        elif all(self.top_piece(i) is not None for i in range(9)):
            # 2. Board is full → score-based tiebreaker
            self.winner, self.score_details = self._score_board_winner()
            self.win_reason = "score"
            self.game_over = True
        else:
            # 3. Advance turn and check if next player is stuck
            next_player = 2 if player == 1 else 1
            self.current_player = next_player
            if self._no_valid_moves(next_player):
                self.winner = "draw"
                self.win_reason = "noMoves"
                self.game_over = True

        return {"success": True, "gameState": self.get_state()}

    # ------------------------------------------------------------------
    # Win / draw detection
    # ------------------------------------------------------------------

    def _check_win(self):
        for line in WIN_LINES:
            tops = [self.top_piece(i) for i in line]
            if all(t is not None and t["player"] == tops[0]["player"] for t in tops):
                self.winning_line = list(line)
                return tops[0]["player"]
        return None

    def _no_valid_moves(self, player: int) -> bool:
        for size in SIZE_VALUE:
            if self.players[player][size] <= 0:
                continue
            for i in range(9):
                ok, _ = self.can_place(player, size, i)
                if ok:
                    return False
        return True

    def _score_board_winner(self):
        """Called when all 9 cells are occupied.

        Winner = player with more visible (top) eggs.
        Tiebreak = player with higher total size score
                   (small=1, medium=2, large=3).
        Returns (winner, score_details).
        """
        counts      = {1: 0, 2: 0}
        size_scores = {1: 0, 2: 0}
        for i in range(9):
            top = self.top_piece(i)
            if top:
                p = top["player"]
                counts[p]      += 1
                size_scores[p] += SIZE_VALUE[top["size"]]

        score_details = {
            "1": {"count": counts[1], "sizeScore": size_scores[1]},
            "2": {"count": counts[2], "sizeScore": size_scores[2]},
        }

        if counts[1] != counts[2]:
            winner = 1 if counts[1] > counts[2] else 2
        elif size_scores[1] != size_scores[2]:
            winner = 1 if size_scores[1] > size_scores[2] else 2
        else:
            winner = "draw"

        return winner, score_details

    # ------------------------------------------------------------------
    # State serialisation
    # ------------------------------------------------------------------

    def get_state(self):
        board_state = []
        for idx, stack in enumerate(self.board):
            top = self.top_piece(idx)
            board_state.append({
                "index": idx,
                "topPiece": top,
                "stackSize": len(stack),
            })
        return {
            "board": board_state,
            "players": {
                "1": dict(self.players[1]),
                "2": dict(self.players[2]),
            },
            "currentPlayer": self.current_player,
            "winner": self.winner,
            "gameOver": self.game_over,
            "winningLine": self.winning_line,
            "winReason": self.win_reason,
            "scoreDetails": self.score_details,
            "lastMove": self.last_move,
        }
