/* ============================================================
   Egg Chess — frontend logic
   Communicates with Flask backend at localhost:3001
   ============================================================ */

const API = "http://localhost:3001/api";

const SIZE_VALUE = { small: 1, medium: 2, large: 3 };
const SIZE_LABEL  = { small: "S", medium: "M", large: "L" };

// ── App state ─────────────────────────────────────────────
let gameState    = null;   // latest state from backend
let selectedSize = null;   // 'small' | 'medium' | 'large' | null
let lastPlaced   = -1;     // cell index just placed (for drop animation)
let dragState    = null;   // { player, size } while a drag is in flight

// ── AI mode state ──────────────────────────────────────────
let gameMode        = "pvp"; // "pvp" | "pva" | "online"
let aiPlayer        = 2;     // AI always plays as Player 2
let aiThinking      = false; // true while waiting for Gemini response
let aiMoveScheduled = false; // prevents double setTimeout scheduling

// ── Online mode state ──────────────────────────────────────
let roomId    = null;   // active room code, e.g. "XK8M2P"
let myPlayer  = null;   // 1 | 2 | null  (null = not in a room)
let pollTimer = null;   // setInterval ID for state polling

// ── DOM refs ──────────────────────────────────────────────
const boardEl    = document.getElementById("board-grid");
const p1TrayEl   = document.getElementById("p1-tray");
const p2TrayEl   = document.getElementById("p2-tray");
const p1PipEl    = document.getElementById("p1-pip");
const p2PipEl    = document.getElementById("p2-pip");
const p1ZoneEl   = document.getElementById("p1-zone");
const p2ZoneEl   = document.getElementById("p2-zone");
const statusEl   = document.getElementById("status-msg");
const hintEl     = document.getElementById("hint-bubble");
const overlayEl  = document.getElementById("win-overlay");
const winCardEl  = overlayEl.querySelector(".win-card");
const winEggEl   = document.getElementById("win-egg");
const winTitleEl = document.getElementById("win-title");
const winSubEl   = document.getElementById("win-sub");

// ── AI DOM refs ────────────────────────────────────────────
const modePvpEl     = document.getElementById("mode-pvp");
const modePvaEl     = document.getElementById("mode-pva");
const apiKeyRowEl   = document.getElementById("api-key-row");
const apiKeyInputEl = document.getElementById("api-key-input");
const aiThinkingEl  = document.getElementById("ai-thinking");
const p2AiBadgeEl   = document.getElementById("p2-ai-badge");

// ── Online DOM refs ────────────────────────────────────────
const modeOnlineEl      = document.getElementById("mode-online");
const onlineLobbyEl     = document.getElementById("online-lobby");
const lobbyCreateEl     = document.getElementById("lobby-create");
const lobbyWaitingEl    = document.getElementById("lobby-waiting");
const roomCodeDisplayEl = document.getElementById("room-code-display");
const waitingMsgEl      = document.getElementById("waiting-msg");
const joinCodeInputEl   = document.getElementById("join-code-input");

// ── Bootstrap ─────────────────────────────────────────────
document.getElementById("btn-reset").addEventListener("click", onReset);
document.getElementById("btn-win-reset").addEventListener("click", onReset);

// ── AI mode event listeners ────────────────────────────────
modePvpEl.addEventListener("change", () => {
  gameMode = "pvp";
  apiKeyRowEl.classList.add("hidden");
  onlineLobbyEl.classList.add("hidden");
  p2AiBadgeEl.classList.add("hidden");
  if (roomId) resetOnlineState();
  onReset();
});
modePvaEl.addEventListener("change", () => {
  gameMode = "pva";
  apiKeyRowEl.classList.remove("hidden");
  onlineLobbyEl.classList.add("hidden");
  if (roomId) resetOnlineState();
  // Restore saved key if any
  apiKeyInputEl.value = localStorage.getItem("geminiApiKey") || "";
  onReset();
});
modeOnlineEl.addEventListener("change", () => {
  gameMode = "online";
  apiKeyRowEl.classList.add("hidden");
  onlineLobbyEl.classList.remove("hidden");
  resetOnlineState();
});
document.getElementById("save-key-btn").addEventListener("click", () => {
  const key = apiKeyInputEl.value.trim();
  localStorage.setItem("geminiApiKey", key);
  showHint(key ? "API key saved!" : "Key cleared.");
  setTimeout(hideHint, 1600);
});
document.getElementById("btn-create-room").addEventListener("click", createRoom);
document.getElementById("btn-join-room").addEventListener("click", () =>
  joinRoom(joinCodeInputEl.value.trim().toUpperCase())
);

// ── API helpers ───────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API + path, opts);
    return await res.json();
  } catch {
    showError("Cannot reach server — make sure the backend is running on port 3001.");
    return null;
  }
}

async function onReset() {
  selectedSize     = null;
  aiThinking       = false;
  aiMoveScheduled  = false;
  hideHint();
  if (gameMode === "online" && roomId) {
    const data = await apiFetch(`/rooms/${roomId}/reset`, { method: "POST" });
    if (data && data.success) {
      overlayEl.classList.add("hidden");
      render(data.gameState);
      startPolling();
    }
  } else if (gameMode !== "online") {
    const data = await apiFetch("/reset", { method: "POST" });
    if (data && data.success) {
      overlayEl.classList.add("hidden");
      render(data.gameState);
    }
  }
}

// ── Valid move helper (client-side, avoids chatty API) ────
function getValidCells(state, player, size) {
  if (!state || state.gameOver) return [];
  if ((state.players[String(player)][size] ?? 0) <= 0) return [];
  return state.board
    .filter(cell => {
      const top = cell.topPiece;
      if (!top) return true;
      if (top.player === player) return false;
      return SIZE_VALUE[size] > SIZE_VALUE[top.size];
    })
    .map(c => c.index);
}

// ── Render ────────────────────────────────────────────────
function render(state) {
  gameState = state;
  const cp      = state.currentPlayer;
  const isP1    = cp === 1 && !state.gameOver;
  const isP2    = cp === 2 && !state.gameOver;

  // Turn pips & zone highlights
  p1PipEl.classList.toggle("active", isP1);
  p2PipEl.classList.toggle("active", isP2);
  p1ZoneEl.classList.toggle("active-turn", isP1);
  p2ZoneEl.classList.toggle("active-turn", isP2);

  renderTray(p1TrayEl, state, 1, isP1);
  renderTray(p2TrayEl, state, 2, isP2);
  renderBoard(state);

  // Status / overlay
  if (state.gameOver) {
    selectedSize = null;
    hideHint();
    if (state.winner === "draw") {
      const drawSub = state.winReason === "score"
        ? "Perfectly tied — no tiebreaker!"
        : "No valid moves remaining.";
      statusEl.innerHTML = `<strong>Draw!</strong> ${drawSub}`;
      showWinOverlay(null, state.winReason, state.scoreDetails);
    } else {
      statusEl.innerHTML = `<strong>Player ${state.winner}</strong> wins!`;
      showWinOverlay(state.winner, state.winReason, state.scoreDetails);
    }
  } else {
    overlayEl.classList.add("hidden");
    statusEl.innerHTML = `<strong>Player ${cp}</strong>'s turn`;
    // Re-validate selected size (in case it ran out after opponent's move)
    if (selectedSize && (state.players[String(cp)][selectedSize] ?? 0) > 0) {
      showHint("Click a highlighted cell to place");
    } else {
      selectedSize = null;
      hideHint();
    }
  }

  // Show/hide AI badge on Player 2's zone
  p2AiBadgeEl.classList.toggle("hidden", gameMode !== "pva");

  // Auto-schedule AI move when it's the AI's turn
  if (!state.gameOver && gameMode === "pva"
      && state.currentPlayer === aiPlayer
      && !aiThinking && !aiMoveScheduled) {
    aiMoveScheduled = true;
    setTimeout(triggerAiMove, 700);
  }
}

function renderTray(trayEl, state, player, isActive) {
  trayEl.innerHTML = "";
  ["small", "medium", "large"].forEach(size => {
    const count      = state.players[String(player)][size] ?? 0;
    const isEmpty    = count <= 0;
    const isSelected = isActive && !state.gameOver && selectedSize === size;
    const isDisabled = !isActive || isEmpty || state.gameOver
                    || (gameMode === "pva" && player === aiPlayer)
                    || aiThinking
                    || (gameMode === "online" && player !== myPlayer);

    const group = document.createElement("div");
    group.className = [
      "piece-group",
      isEmpty    ? "empty"    : "",
      isDisabled ? "disabled" : "",
      isSelected ? "selected" : "",
    ].filter(Boolean).join(" ");

    const egg = makeEgg(player, size);
    const labelEl = document.createElement("span");
    labelEl.className = "piece-label";
    labelEl.textContent = SIZE_LABEL[size];
    const cntEl = document.createElement("span");
    cntEl.className = "piece-count";
    cntEl.textContent = `×${count}`;

    group.append(egg, labelEl, cntEl);

    if (!isDisabled) {
      group.addEventListener("click", () => onPickSize(player, size));
      group.draggable = true;
      group.addEventListener("dragstart", e => onDragStart(e, player, size));
      group.addEventListener("dragend",   onDragEnd);
    }
    trayEl.appendChild(group);
  });
}

function renderBoard(state) {
  const cp         = state.currentPlayer;
  const validCells = selectedSize ? getValidCells(state, cp, selectedSize) : [];
  const winLine    = state.winningLine ?? [];

  boardEl.innerHTML = "";

  state.board.forEach(cellData => {
    const cell      = document.createElement("div");
    const isValid   = validCells.includes(cellData.index);
    const isWinCell = winLine.includes(cellData.index);

    cell.className = [
      "cell",
      isValid   ? "valid-move"   : "",
      isWinCell ? "winning-cell" : "",
      isWinCell && state.winner === 1 ? "p1-win" : "",
    ].filter(Boolean).join(" ");

    cell.dataset.index = cellData.index;

    if (cellData.topPiece) {
      const egg = makeEgg(cellData.topPiece.player, cellData.topPiece.size);
      if (lastPlaced === cellData.index) egg.classList.add("just-placed");
      cell.appendChild(egg);

      if (cellData.stackSize > 1) {
        const badge = document.createElement("span");
        badge.className = "stack-badge";
        badge.textContent = `+${cellData.stackSize - 1}`;
        cell.appendChild(badge);
      }
    }

    if (!state.gameOver) {
      cell.addEventListener("click",     () => onCellClick(cellData.index, isValid));
      cell.addEventListener("dragover",  e  => onCellDragOver(e, cellData.index));
      cell.addEventListener("dragenter", e  => onCellDragEnter(e, cellData.index));
      cell.addEventListener("dragleave", e  => onCellDragLeave(e));
      cell.addEventListener("drop",      e  => onCellDrop(e, cellData.index));
    }
    boardEl.appendChild(cell);
  });

  lastPlaced = -1;
}

// ── Egg element factory ───────────────────────────────────
function makeEgg(player, size) {
  const el = document.createElement("div");
  el.className = `egg p${player} ${size}`;
  return el;
}

// ── Interactions ─────────────────────────────────────────
function onPickSize(player, size) {
  if (!gameState || gameState.gameOver) return;
  if (aiThinking) return;
  if (gameMode === "pva" && player === aiPlayer) return;
  if (gameMode === "online" && player !== myPlayer) return;
  if (gameState.currentPlayer !== player) return;
  if ((gameState.players[String(player)][size] ?? 0) <= 0) return;

  if (selectedSize === size) {
    // Toggle off
    selectedSize = null;
    hideHint();
  } else {
    selectedSize = size;
    const valid = getValidCells(gameState, player, size);
    if (valid.length === 0) {
      showHint("No valid cells for that piece");
      setTimeout(hideHint, 1800);
      selectedSize = null;
    } else {
      showHint("Click a highlighted cell to place");
    }
  }

  // Redraw board highlights and tray selection
  renderBoard(gameState);
  const isP1 = gameState.currentPlayer === 1;
  renderTray(p1TrayEl, gameState, 1, isP1);
  renderTray(p2TrayEl, gameState, 2, !isP1);
}

async function onCellClick(cellIndex, isValid) {
  if (!gameState || gameState.gameOver) return;
  if (aiThinking) return;
  if (gameMode === "online" && gameState.currentPlayer !== myPlayer) return;
  if (!selectedSize) {
    showHint("Select a piece from your tray first");
    setTimeout(hideHint, 1600);
    return;
  }
  if (!isValid) return;

  const player = gameState.currentPlayer;
  const size   = selectedSize;   // capture before clearing

  selectedSize = null;
  lastPlaced   = cellIndex;
  hideHint();

  const endpoint = gameMode === "online" ? `/rooms/${roomId}/move` : "/move";
  const data = await apiFetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ player, size, cellIndex }),
  });

  if (!data) return;

  if (data.success) {
    render(data.gameState);
    if (gameMode === "online" && !data.gameState.gameOver) startPolling();
  } else {
    // Restore selection on failure
    selectedSize = size;
    lastPlaced   = -1;
    showHint(data.message ?? "Invalid move");
    setTimeout(hideHint, 1800);
    renderBoard(gameState);
    const isP1 = gameState.currentPlayer === 1;
    renderTray(p1TrayEl, gameState, 1, isP1);
    renderTray(p2TrayEl, gameState, 2, !isP1);
  }
}

// ── Drag & drop ───────────────────────────────────────────
function onDragStart(e, player, size) {
  if (!gameState || gameState.gameOver) { e.preventDefault(); return; }
  if (gameState.currentPlayer !== player) { e.preventDefault(); return; }
  if (aiThinking || (gameMode === "pva" && player === aiPlayer)) { e.preventDefault(); return; }
  if (gameMode === "online" && player !== myPlayer) { e.preventDefault(); return; }

  dragState    = { player, size };
  selectedSize = null;
  hideHint();

  // Use the egg element as the drag image so it looks like you're picking up the egg
  const egg = e.currentTarget.querySelector(".egg");
  if (egg) {
    const r = egg.getBoundingClientRect();
    e.dataTransfer.setDragImage(egg, r.width / 2, r.height / 2);
  }
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", JSON.stringify({ player, size }));

  e.currentTarget.classList.add("dragging");

  // Highlight valid drop targets on the next frame (DOM must be ready)
  requestAnimationFrame(() => {
    if (!gameState) return;
    const valid = getValidCells(gameState, player, size);
    document.querySelectorAll(".cell").forEach(cell => {
      cell.classList.toggle("valid-move", valid.includes(Number(cell.dataset.index)));
    });
  });
}

function onDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  dragState = null;
  // Full re-render clears valid-move, drag-over, etc.
  if (gameState) renderBoard(gameState);
}

function onCellDragOver(e, cellIndex) {
  if (!dragState || !gameState) return;
  const valid = getValidCells(gameState, dragState.player, dragState.size);
  if (valid.includes(cellIndex)) {
    e.preventDefault();                       // signal: drop allowed here
    e.dataTransfer.dropEffect = "move";
  }
}

function onCellDragEnter(e, cellIndex) {
  if (!dragState || !gameState) return;
  e.preventDefault();
  const valid = getValidCells(gameState, dragState.player, dragState.size);
  const cell  = e.currentTarget;
  cell.classList.remove("drag-over", "drag-over-invalid");
  cell.classList.add(valid.includes(cellIndex) ? "drag-over" : "drag-over-invalid");
}

function onCellDragLeave(e) {
  const cell = e.currentTarget;
  // Only fire when truly leaving the cell (not crossing into a child element)
  if (!cell.contains(e.relatedTarget)) {
    cell.classList.remove("drag-over", "drag-over-invalid");
  }
}

async function onCellDrop(e, cellIndex) {
  e.preventDefault();
  if (!dragState || !gameState) return;

  const { player, size } = dragState;
  dragState = null;

  const valid = getValidCells(gameState, player, size);
  if (!valid.includes(cellIndex)) return;

  // Strip highlight classes before the async call to avoid flash
  document.querySelectorAll(".cell").forEach(c =>
    c.classList.remove("drag-over", "drag-over-invalid", "valid-move")
  );

  lastPlaced = cellIndex;
  const dropEndpoint = gameMode === "online" ? `/rooms/${roomId}/move` : "/move";
  const data = await apiFetch(dropEndpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ player, size, cellIndex }),
  });

  if (data && data.success) {
    render(data.gameState);
    if (gameMode === "online" && !data.gameState.gameOver) startPolling();
  } else if (data) {
    lastPlaced = -1;
    showHint(data.message ?? "Invalid move");
    setTimeout(hideHint, 1800);
    renderBoard(gameState);
  }
}

// ── Online room ───────────────────────────────────────────
function resetOnlineState() {
  stopPolling();
  roomId   = null;
  myPlayer = null;
  if (lobbyWaitingEl)  lobbyWaitingEl.classList.add("hidden");
  if (lobbyCreateEl)   lobbyCreateEl.classList.remove("hidden");
  overlayEl.classList.add("hidden");
}

async function createRoom() {
  const data = await apiFetch("/rooms", { method: "POST" });
  if (!data?.success) return;
  roomId   = data.roomId;
  myPlayer = 1;
  lobbyCreateEl.classList.add("hidden");
  lobbyWaitingEl.classList.remove("hidden");
  roomCodeDisplayEl.textContent = roomId;
  waitingMsgEl.textContent = "Waiting for Player 2…";
  startPolling();
}

async function joinRoom(code) {
  if (!code || code.length !== 6) {
    showHint("Enter a 6-character room code");
    setTimeout(hideHint, 1800);
    return;
  }
  const data = await apiFetch(`/rooms/${code}/join`, { method: "POST" });
  if (!data?.success) {
    showHint(data?.message ?? "Could not join room");
    setTimeout(hideHint, 2000);
    return;
  }
  roomId   = data.roomId;
  myPlayer = 2;
  lobbyCreateEl.classList.add("hidden");
  lobbyWaitingEl.classList.remove("hidden");
  roomCodeDisplayEl.textContent = roomId;
  waitingMsgEl.textContent = "Joined! Game starting…";
  startPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollRoomState, 1200);
  pollRoomState();   // immediate first tick
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollRoomState() {
  if (!roomId) return;
  const data = await apiFetch(`/rooms/${roomId}/state`);
  if (!data?.success) return;

  // P1 waiting for P2 to join
  if (!data.player2Joined) {
    waitingMsgEl.textContent = "Waiting for Player 2…";
    return;
  }

  // Both players present — hide lobby and show the board
  if (!onlineLobbyEl.classList.contains("hidden")) {
    onlineLobbyEl.classList.add("hidden");
  }

  render(data.gameState);

  // Stop polling when it's my turn or game is over
  if (data.gameState.gameOver || data.gameState.currentPlayer === myPlayer) {
    stopPolling();
  }
}

// ── AI move ───────────────────────────────────────────────
async function triggerAiMove() {
  if (gameMode !== "pva" || !gameState || gameState.gameOver) {
    aiThinking = aiMoveScheduled = false;
    return;
  }
  if (gameState.currentPlayer !== aiPlayer || aiThinking) return;

  aiThinking = true;
  aiThinkingEl.classList.remove("hidden");

  const apiKey = localStorage.getItem("geminiApiKey") || "";
  const data   = await apiFetch("/ai-move", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ aiPlayer, apiKey }),
  });

  aiThinking      = false;
  aiMoveScheduled = false;
  aiThinkingEl.classList.add("hidden");

  if (data && data.success) {
    lastPlaced = data.aiMove.cellIndex;
    render(data.gameState);
  } else if (data) {
    showHint(data.message ?? "AI failed to move");
    setTimeout(hideHint, 2000);
  }
}

// ── Win overlay ───────────────────────────────────────────
function showWinOverlay(winner, reason, scoreDetails) {
  overlayEl.classList.remove("hidden");
  winCardEl.classList.remove("p1-win-card");

  if (!winner || winner === "draw") {
    winEggEl.className = "win-egg-anim";
    winEggEl.style.background = "linear-gradient(135deg, #666, #aaa)";
    winTitleEl.textContent = "It's a Draw!";
    winTitleEl.style.cssText =
      "background: linear-gradient(135deg, #aaa, #fff);" +
      "-webkit-background-clip: text; background-clip: text;" +
      "-webkit-text-fill-color: transparent;";

    if (reason === "score" && scoreDetails) {
      const d1 = scoreDetails["1"], d2 = scoreDetails["2"];
      winSubEl.textContent =
        `Both tied — ${d1.count} eggs, size score ${d1.sizeScore} each`;
    } else {
      winSubEl.textContent = "No valid moves remain.";
    }
    return;
  }

  winEggEl.className = `win-egg-anim p${winner}`;
  winEggEl.style.background = "";

  if (winner === 1) {
    winCardEl.classList.add("p1-win-card");
    winTitleEl.textContent = "Player 1 Wins!";
    winTitleEl.style.cssText =
      "background: linear-gradient(135deg, #E63950, #B52535);" +
      "-webkit-background-clip: text; background-clip: text;" +
      "-webkit-text-fill-color: transparent;";
  } else {
    winTitleEl.textContent = "Player 2 Wins!";
    winTitleEl.style.cssText =
      "background: linear-gradient(135deg, #FFD700, #DAA520);" +
      "-webkit-background-clip: text; background-clip: text;" +
      "-webkit-text-fill-color: transparent;";
  }

  if (reason === "score" && scoreDetails) {
    const wD = scoreDetails[String(winner)];
    const lD = scoreDetails[String(winner === 1 ? 2 : 1)];
    if (wD.count !== lD.count) {
      winSubEl.textContent =
        `Board full — ${wD.count} eggs vs ${lD.count}`;
    } else {
      winSubEl.textContent =
        `Board full — size score ${wD.sizeScore} vs ${lD.sizeScore}`;
    }
  } else if (reason === "noMoves") {
    winSubEl.textContent = "Opponent ran out of moves!";
  } else {
    winSubEl.textContent = "Three in a row!";
  }
}

// ── Hint bubble ───────────────────────────────────────────
function showHint(msg) {
  hintEl.textContent = msg;
  hintEl.classList.add("show");
}
function hideHint() {
  hintEl.classList.remove("show");
}

// ── Error helper ──────────────────────────────────────────
function showError(msg) {
  statusEl.innerHTML = `<span style="color:#ff6b6b">${msg}</span>`;
}

// ── Init ──────────────────────────────────────────────────
(async function init() {
  const state = await apiFetch("/state");
  if (state) render(state);
})();
