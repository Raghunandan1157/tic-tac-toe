// ── API (Neon via /api/rpc) ───────────────────────────────
async function api(op, params = {}) {
  try {
    const r = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...params })
    });
    const j = await r.json();
    return r.ok ? { data: j.data } : { error: j.error || 'Request failed' };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Constants ─────────────────────────────────────────────
const WINNING_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
const COUNTDOWN_FROM = 3;

// ── State ─────────────────────────────────────────────────
let playerName = '';
let playerId = localStorage.getItem('pid') || crypto.randomUUID();
localStorage.setItem('pid', playerId);

let currentRoom = null;
let myRole = null;        // 'host' | 'guest'
let lobbyTimer = null;
let gameTimer = null;
let inflight = 0;
let lastScoredRound = null;
let countdownTimer = null;

// ── Score helpers (localStorage, per room) ────────────────
function getScores(roomId) {
  return JSON.parse(localStorage.getItem(`s_${roomId}`) || '{"X":0,"O":0}');
}
function bumpScore(roomId, mark) {
  const s = getScores(roomId);
  s[mark]++;
  localStorage.setItem(`s_${roomId}`, JSON.stringify(s));
  return s;
}
function renderScores(roomId) {
  const s = getScores(roomId);
  document.getElementById('score-x').textContent = s.X;
  document.getElementById('score-o').textContent = s.O;
}

// ── Screen helper ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── NAME SCREEN ───────────────────────────────────────────
document.getElementById('name-btn').addEventListener('click', enterLobby);
document.getElementById('name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') enterLobby();
});
const savedName = localStorage.getItem('playerName');
if (savedName) document.getElementById('name-input').value = savedName;

function enterLobby() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { document.getElementById('name-input').focus(); return; }
  playerName = val;
  localStorage.setItem('playerName', playerName);
  initLobby();
}

// ── LOBBY ─────────────────────────────────────────────────
document.getElementById('create-room-btn').addEventListener('click', createRoom);
document.getElementById('logout-btn').addEventListener('click', () => {
  unsubscribeLobby();
  showScreen('screen-name');
});
document.getElementById('delete-all-btn').addEventListener('click', deleteAllRooms);

async function initLobby() {
  document.getElementById('lobby-player-name').textContent = playerName;
  showScreen('screen-lobby');
  await loadRooms();
  subscribeLobby();
}

async function loadRooms(silent) {
  const list = document.getElementById('rooms-list');
  if (!silent) list.innerHTML = '<div class="loading pulse">Loading rooms…</div>';
  const { data, error } = await api('list');
  if (error) { list.innerHTML = '<div class="empty">Failed to load rooms.</div>'; return; }
  renderRooms(data || []);
}

function renderRooms(rooms) {
  const list = document.getElementById('rooms-list');
  if (!rooms.length) { list.innerHTML = '<div class="empty">No rooms yet. Create one!</div>'; return; }
  list.innerHTML = rooms.map(r => {
    const canJoin  = r.status === 'waiting' && r.host_id !== playerId;
    const isMyRoom = r.host_id === playerId || r.guest_id === playerId;
    const label    = r.status === 'waiting' ? 'Open' : 'In Progress';
    const players  = r.guest_name ? `${escHtml(r.host_name)} vs ${escHtml(r.guest_name)}` : `${escHtml(r.host_name)} · 1/2`;
    return `
      <div class="room-card">
        <div class="room-info">
          <span class="room-name">${escHtml(r.name)}</span>
          <span class="room-meta">${players}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="room-status-badge ${r.status}">${label}</span>
          ${canJoin  ? `<button class="btn btn-join" onclick="joinRoom('${r.id}')">Join</button>` : ''}
          ${isMyRoom ? `<button class="btn btn-join" onclick="rejoinRoom('${r.id}')">Rejoin</button>` : ''}
          ${r.host_id === playerId ? `<button class="btn btn-delete" onclick="deleteRoom('${r.id}')">✕</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function subscribeLobby() {
  unsubscribeLobby();
  lobbyTimer = setInterval(() => loadRooms(true), 2500);
}
function unsubscribeLobby() {
  if (lobbyTimer) { clearInterval(lobbyTimer); lobbyTimer = null; }
}

// ── CREATE / JOIN ROOM ────────────────────────────────────
async function deleteRoom(roomId) {
  await api('remove', { roomId, playerId });
  await loadRooms(true);
}

async function deleteAllRooms() {
  const pwd = prompt('Enter password to delete all rooms:');
  if (pwd === null) return;
  const { error } = await api('removeAll', { password: pwd });
  if (error) { alert(error); return; }
  await loadRooms();
}

async function createRoom() {
  const { data, error } = await api('create', { hostName: playerName, playerId });
  if (error || !data) { alert('Could not create room.'); return; }
  currentRoom = data; myRole = 'host';
  unsubscribeLobby(); initGameScreen();
}

async function joinRoom(roomId) {
  const { data, error } = await api('join', { roomId, name: playerName, playerId });
  if (error || !data) { alert('Room no longer available.'); await loadRooms(); return; }
  currentRoom = data; myRole = 'guest';
  unsubscribeLobby(); initGameScreen();
}

async function rejoinRoom(roomId) {
  const { data, error } = await api('get', { roomId, playerId });
  if (error || !data) { alert('Room not found.'); return; }
  currentRoom = data;
  myRole = data.host_id === playerId ? 'host' : 'guest';
  unsubscribeLobby(); initGameScreen();
}

// ── GAME SCREEN ───────────────────────────────────────────
document.getElementById('back-btn').addEventListener('click', leaveGame);
document.getElementById('draw-btn').addEventListener('click', handleDrawRequest);
document.querySelectorAll('.cell').forEach(c => c.addEventListener('click', handleCellClick));

// Keyboard: 1-9 → cells, Space → draw request
document.addEventListener('keydown', e => {
  if (document.getElementById('screen-game').classList.contains('active')) {
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (!currentRoom || currentRoom.board[idx]) return;
      const myMark = myRole === 'host' ? 'X' : 'O';
      if (currentRoom.status !== 'playing' || currentRoom.current_turn !== myMark) return;
      makeMove(idx);
    }
    if (e.key === ' ') {
      e.preventDefault();
      handleDrawRequest();
    }
  }
});

function initGameScreen() {
  clearCountdown();
  // Remember room for reload persistence
  localStorage.setItem('activeRoom', currentRoom.id);
  localStorage.setItem('activeRole', myRole);
  showScreen('screen-game');
  document.getElementById('room-title').textContent = currentRoom.name;
  renderScores(currentRoom.id);
  renderGame(currentRoom);
  subscribeGame();
}

function updateDrawUI(room) {
  const btn  = document.getElementById('draw-btn');
  const hint = document.getElementById('draw-hint');
  if (room.draw_by && room.draw_by !== myRole) {
    const asker = room.draw_by === 'host' ? room.host_name : room.guest_name;
    btn.textContent = 'Agree?';
    btn.className = 'btn btn-draw agree';
    hint.textContent = `${asker} wants to draw — press Space or click`;
  } else if (room.draw_by === myRole) {
    btn.textContent = 'Waiting…';
    btn.className = 'btn btn-draw requested';
    hint.textContent = 'Opponent must agree';
  } else {
    btn.textContent = 'Draw?';
    btn.className = 'btn btn-draw';
    hint.textContent = '';
  }
}

async function handleDrawRequest() {
  if (!currentRoom || currentRoom.status !== 'playing') return;
  if (currentRoom.draw_by === myRole) return; // already waiting
  await mutate('draw', {});
}

function renderGame(room) {
  document.getElementById('player-x-name').textContent = room.host_name;
  document.getElementById('player-o-name').textContent = room.guest_name || 'Waiting…';

  const badge = document.getElementById('room-badge');
  badge.textContent = room.status === 'waiting' ? 'Waiting…' : 'Live';
  badge.className   = room.status === 'waiting' ? 'badge pulse' : 'badge live';

  const myMark   = myRole === 'host' ? 'X' : 'O';
  const isMyTurn = room.status === 'playing' && room.current_turn === myMark;
  const cells    = document.querySelectorAll('.cell');

  // Board
  cells.forEach((cell, i) => {
    const val = room.board[i];
    cell.className = 'cell';
    cell.innerHTML = '';
    if (val) {
      cell.classList.add(val.toLowerCase(), 'disabled');
      cell.innerHTML = `<span class="mark">${val}</span>`;
    } else if (isMyTurn) {
      cell.classList.add('clickable');
    } else {
      cell.classList.add('disabled');
    }
  });

  // Winning cells
  if (room.status === 'finished' && room.winner && room.winner !== 'draw') {
    const line = WINNING_LINES.find(l => l.every(i => room.board[i] === room.winner));
    if (line) line.forEach(i => cells[i].classList.add('winner'));
  }

  // Active turn cards
  document.getElementById('player-x-card').className =
    'player-card' + (room.current_turn === 'X' && room.status === 'playing' ? ' active-turn' : '');
  document.getElementById('player-o-card').className =
    'player-card' + (room.current_turn === 'O' && room.status === 'playing' ? ' active-turn is-o' : '');

  // Status
  const st = document.getElementById('game-status');
  if (room.status === 'waiting') {
    st.textContent = 'Share this room with your friend!';
    st.className = 'status pulse';
  } else if (room.status === 'playing') {
    st.textContent = isMyTurn ? 'Your turn!' : `${room.current_turn === 'X' ? room.host_name : room.guest_name}'s turn…`;
    st.className = isMyTurn ? 'status your-turn' : 'status waiting-turn';
  }

  updateDrawUI(room);

  // Show draw button only when game is active with 2 players
  document.getElementById('draw-bar').classList.toggle(
    'hidden', room.status !== 'playing'
  );

  if (room.status === 'playing' && room.opponent_online === false) {
    const st2 = document.getElementById('game-status');
    st2.textContent = 'Opponent left the room';
    st2.className = 'status warning';
  }

  // Game over: score + countdown
  if (room.status === 'finished') {
    document.getElementById('draw-bar').classList.add('hidden');
    clearCountdown();

    // Score (only bump once per round)
    if (lastScoredRound !== `${room.id}:${room.round}`) {
      lastScoredRound = `${room.id}:${room.round}`;
      if (room.winner && room.winner !== 'draw') bumpScore(room.id, room.winner);
      renderScores(room.id);
    }

    const isMe = (room.winner === 'X' && myRole === 'host') || (room.winner === 'O' && myRole === 'guest');
    const resultMsg = room.winner === 'draw' ? "Draw!" : isMe ? "You Win!" : `${room.winner === 'X' ? room.host_name : room.guest_name} Wins!`;
    startCountdown(resultMsg);
  }
}

// ── COUNTDOWN ─────────────────────────────────────────────
function startCountdown(msg) {
  let n = COUNTDOWN_FROM;
  const st = document.getElementById('game-status');
  st.textContent = `${msg}  ${n}…`;
  st.className = 'status result';

  countdownTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearCountdown();
      resetBoard(); // both players try; DB guard ensures only one wins
    } else {
      st.textContent = `${msg}  ${n}…`;
    }
  }, 1000);
}

function clearCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

// ── MOVE ──────────────────────────────────────────────────
function handleCellClick(e) {
  if (!currentRoom || currentRoom.status !== 'playing') return;
  const myMark = myRole === 'host' ? 'X' : 'O';
  if (currentRoom.current_turn !== myMark) return;
  const idx = +e.currentTarget.dataset.index;
  if (currentRoom.board[idx]) return;
  makeMove(idx);
}

async function makeMove(idx) {
  const myMark = myRole === 'host' ? 'X' : 'O';
  const newBoard = [...currentRoom.board];
  newBoard[idx] = myMark;
  const winLine = WINNING_LINES.find(l => l.every(i => newBoard[i] === myMark));
  const isDraw  = !winLine && newBoard.every(c => c !== '');

  // Instant local render; the server response is authoritative
  applyRoom({
    ...currentRoom, board: newBoard, current_turn: myMark === 'X' ? 'O' : 'X', draw_by: null,
    ...(winLine ? { status: 'finished', winner: myMark } : {}),
    ...(isDraw  ? { status: 'finished', winner: 'draw' } : {}),
  });
  await mutate('move', { idx });
}

// ── RESET BOARD (anyone can trigger; server guard prevents double-reset) ──
async function resetBoard() {
  await mutate('reset', {});
}

// ── SYNC (polling) ────────────────────────────────────────
function applyRoom(room) {
  const prev = currentRoom;
  const changed = !prev ||
    room.status !== prev.status || room.round !== prev.round ||
    room.current_turn !== prev.current_turn || room.draw_by !== prev.draw_by ||
    room.guest_id !== prev.guest_id || room.winner !== prev.winner ||
    room.opponent_online !== prev.opponent_online ||
    JSON.stringify(room.board) !== JSON.stringify(prev.board);
  currentRoom = room;
  if (!changed) return;
  clearCountdown();
  renderGame(room);
}

async function mutate(op, params) {
  if (!currentRoom) return;
  inflight++;
  const { data, error } = await api(op, { roomId: currentRoom.id, playerId, ...params });
  inflight--;
  if (data && currentRoom && data.id === currentRoom.id) applyRoom(data);
  else if (error) await pollGame();
}

async function pollGame() {
  if (!currentRoom || inflight) return;
  const roomId = currentRoom.id;
  const { data, error } = await api('get', { roomId, playerId });
  if (inflight || !currentRoom || currentRoom.id !== roomId) return;
  if (error) {
    if (/not found/i.test(error)) { alert('Room was closed.'); exitToLobby(); }
    return;
  }
  applyRoom(data);
}

function subscribeGame() {
  unsubscribeGame();
  gameTimer = setInterval(pollGame, 1000);
}

function unsubscribeGame() {
  clearCountdown();
  if (gameTimer) { clearInterval(gameTimer); gameTimer = null; }
}

// ── LEAVE ─────────────────────────────────────────────────
async function leaveGame() {
  if (myRole === 'host' && currentRoom.status === 'waiting') {
    await api('remove', { roomId: currentRoom.id, playerId });
  }
  exitToLobby();
}

function exitToLobby() {
  unsubscribeGame();
  localStorage.removeItem('activeRoom');
  localStorage.removeItem('activeRole');
  currentRoom = null; myRole = null;
  initLobby();
}

// ── UTILS ─────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── AUTO-REJOIN ON RELOAD ─────────────────────────────────
(async function autoRejoin() {
  const roomId = localStorage.getItem('activeRoom');
  const role   = localStorage.getItem('activeRole');
  const name   = localStorage.getItem('playerName');
  if (!roomId || !name) return;

  playerName = name;
  const { data } = await api('get', { roomId, playerId });
  if (!data || data.status === 'finished') {
    localStorage.removeItem('activeRoom');
    localStorage.removeItem('activeRole');
    return;
  }
  currentRoom = data;
  myRole = role || (data.host_id === playerId ? 'host' : 'guest');
  initGameScreen();
})();
