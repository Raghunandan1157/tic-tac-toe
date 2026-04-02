// ── Supabase ──────────────────────────────────────────────
const SUPABASE_URL = 'https://knbijsnghjcaocwtjvvw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuYmlqc25naGpjYW9jd3RqdnZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjM3MzgsImV4cCI6MjA5MDY5OTczOH0.k7wem_YuGJ9wHavFBbg00W-d1S9Q0eXmCWdtPWMIFZs';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Constants ─────────────────────────────────────────────
const WINNING_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
const COUNTDOWN_FROM = 3;

// ── State ─────────────────────────────────────────────────
let playerName = '';
let playerId = sessionStorage.getItem('pid') || crypto.randomUUID();
sessionStorage.setItem('pid', playerId);

let currentRoom = null;
let myRole = null;        // 'host' | 'guest'
let lobbyChannel = null;
let gameChannel = null;
let countdownTimer = null;
let scoredThisRound = false;
let drawRequestedByMe = false;
let drawRequestedByOpponent = false;

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

async function initLobby() {
  document.getElementById('lobby-player-name').textContent = playerName;
  showScreen('screen-lobby');
  await loadRooms();
  subscribeLobby();
}

async function loadRooms() {
  const list = document.getElementById('rooms-list');
  list.innerHTML = '<div class="loading pulse">Loading rooms…</div>';
  const { data, error } = await db
    .from('rooms')
    .select('*')
    .in('status', ['waiting', 'playing'])
    .order('created_at', { ascending: false });
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
        </div>
      </div>`;
  }).join('');
}

function subscribeLobby() {
  unsubscribeLobby();
  lobbyChannel = db.channel('lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => loadRooms())
    .subscribe();
}
function unsubscribeLobby() {
  if (lobbyChannel) { db.removeChannel(lobbyChannel); lobbyChannel = null; }
}

// ── CREATE / JOIN ROOM ────────────────────────────────────
async function createRoom() {
  const { data, error } = await db.from('rooms')
    .insert({ name: `${playerName}'s Room`, host_name: playerName, host_id: playerId })
    .select().single();
  if (error || !data) { alert('Could not create room.'); return; }
  currentRoom = data; myRole = 'host';
  unsubscribeLobby(); initGameScreen();
}

async function joinRoom(roomId) {
  const { data, error } = await db.from('rooms')
    .update({ guest_name: playerName, guest_id: playerId, status: 'playing' })
    .eq('id', roomId).eq('status', 'waiting')
    .select().single();
  if (error || !data) { alert('Room no longer available.'); await loadRooms(); return; }
  currentRoom = data; myRole = 'guest';
  unsubscribeLobby(); initGameScreen();
}

async function rejoinRoom(roomId) {
  const { data, error } = await db.from('rooms').select('*').eq('id', roomId).single();
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
  scoredThisRound = false;
  drawRequestedByMe = false;
  drawRequestedByOpponent = false;
  showScreen('screen-game');
  document.getElementById('room-title').textContent = currentRoom.name;
  renderScores(currentRoom.id);
  renderGame(currentRoom);
  subscribeGame();
}

function resetDrawState() {
  drawRequestedByMe = false;
  drawRequestedByOpponent = false;
  const bar  = document.getElementById('draw-bar');
  const btn  = document.getElementById('draw-btn');
  const hint = document.getElementById('draw-hint');
  btn.textContent = 'Draw?';
  btn.className = 'btn btn-draw';
  hint.textContent = '';
  bar.classList.remove('hidden');
}

function handleDrawRequest() {
  if (!currentRoom || currentRoom.status !== 'playing') return;

  if (drawRequestedByOpponent) {
    // Opponent already asked — this is our agreement → reset
    gameChannel.send({ type: 'broadcast', event: 'draw_accept', payload: {} });
    doMutualDraw();
    return;
  }

  if (drawRequestedByMe) return; // already waiting

  drawRequestedByMe = true;
  const btn  = document.getElementById('draw-btn');
  const hint = document.getElementById('draw-hint');
  btn.textContent = 'Waiting…';
  btn.className = 'btn btn-draw requested';
  hint.textContent = 'Opponent must agree';
  gameChannel.send({ type: 'broadcast', event: 'draw_request', payload: { name: playerName } });
}

function doMutualDraw() {
  clearCountdown();
  resetDrawState();
  drawRequestedByMe = false;
  drawRequestedByOpponent = false;
  resetBoard();
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

  // Show draw button only when game is active with 2 players
  document.getElementById('draw-bar').classList.toggle(
    'hidden', room.status !== 'playing'
  );

  // Game over: score + countdown
  if (room.status === 'finished') {
    resetDrawState();
    document.getElementById('draw-bar').classList.add('hidden');
    clearCountdown();

    // Score (only bump once per round)
    if (!scoredThisRound) {
      scoredThisRound = true;
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
  const myMark  = myRole === 'host' ? 'X' : 'O';
  const newBoard = [...currentRoom.board];
  newBoard[idx]  = myMark;

  const winLine = WINNING_LINES.find(l => l.every(i => newBoard[i] === myMark));
  const isDraw  = !winLine && newBoard.every(c => c !== '');

  const patch = {
    board: newBoard,
    current_turn: myMark === 'X' ? 'O' : 'X',
    ...(winLine ? { status: 'finished', winner: myMark } : {}),
    ...(isDraw  ? { status: 'finished', winner: 'draw' } : {}),
  };

  // Instant local + broadcast
  currentRoom = { ...currentRoom, ...patch };
  renderGame(currentRoom);
  gameChannel.send({ type: 'broadcast', event: 'move', payload: patch });

  // Persist to DB (fire and forget)
  db.from('rooms').update(patch).eq('id', currentRoom.id).then(() => {});
}

// ── RESET BOARD (anyone can trigger; DB guard prevents double-reset) ──
async function resetBoard() {
  const patch = { board: ['','','','','','','','',''], current_turn: 'X', status: 'playing', winner: null };
  const { data } = await db.from('rooms').update(patch)
    .eq('id', currentRoom.id)
    .eq('status', 'finished')
    .select().single();
  if (data) {
    scoredThisRound = false;
    resetDrawState();
    currentRoom = data;
    renderGame(data);
    gameChannel.send({ type: 'broadcast', event: 'move', payload: patch });
  }
}

// ── REALTIME SUBSCRIPTION ─────────────────────────────────
function subscribeGame() {
  unsubscribeGame();
  gameChannel = db
    .channel(`game:${currentRoom.id}`, { config: { presence: { key: playerId } } })
    // Broadcast: instant move/reset from opponent
    .on('broadcast', { event: 'move' }, ({ payload }) => {
      if (!currentRoom) return;
      clearCountdown();
      scoredThisRound = false;
      currentRoom = { ...currentRoom, ...payload };
      renderGame(currentRoom);
    })
    // Draw request from opponent
    .on('broadcast', { event: 'draw_request' }, ({ payload }) => {
      drawRequestedByOpponent = true;
      const btn  = document.getElementById('draw-btn');
      const hint = document.getElementById('draw-hint');
      btn.textContent = 'Agree?';
      btn.className = 'btn btn-draw agree';
      hint.textContent = `${payload.name} wants to draw — press Space or click`;
    })
    // Opponent accepted our draw request
    .on('broadcast', { event: 'draw_accept' }, () => {
      doMutualDraw();
    })
    // Presence: detect opponent online/offline
    .on('presence', { event: 'sync' }, () => {
      if (!currentRoom || currentRoom.status !== 'playing') return;
      const online = Object.keys(gameChannel.presenceState());
      const opponentId = myRole === 'host' ? currentRoom.guest_id : currentRoom.host_id;
      if (opponentId && !online.includes(opponentId)) {
        const st = document.getElementById('game-status');
        st.textContent = 'Opponent left the room';
        st.className = 'status warning';
      }
    })
    // Postgres: fallback sync (e.g. on rejoin)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${currentRoom.id}` },
      ({ new: room }) => {
        // Only apply if it's newer than what we have (avoid overwriting broadcast)
        if (room.status !== currentRoom.status ||
            JSON.stringify(room.board) !== JSON.stringify(currentRoom.board)) {
          clearCountdown();
          scoredThisRound = false;
          currentRoom = room;
          renderGame(room);
        }
      }
    )
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await gameChannel.track({ name: playerName, id: playerId });
      }
    });
}

function unsubscribeGame() {
  clearCountdown();
  if (gameChannel) { db.removeChannel(gameChannel); gameChannel = null; }
}

// ── LEAVE ─────────────────────────────────────────────────
async function leaveGame() {
  if (myRole === 'host' && currentRoom.status === 'waiting') {
    await db.from('rooms').delete().eq('id', currentRoom.id);
  }
  unsubscribeGame();
  currentRoom = null; myRole = null;
  initLobby();
}

// ── UTILS ─────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
