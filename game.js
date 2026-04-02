// ── Supabase ──────────────────────────────────────────────
const SUPABASE_URL = 'https://knbijsnghjcaocwtjvvw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuYmlqc25naGpjYW9jd3RqdnZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjM3MzgsImV4cCI6MjA5MDY5OTczOH0.k7wem_YuGJ9wHavFBbg00W-d1S9Q0eXmCWdtPWMIFZs';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ─────────────────────────────────────────────────
let playerName = '';
let playerId = sessionStorage.getItem('pid') || crypto.randomUUID();
sessionStorage.setItem('pid', playerId);

let currentRoom = null;
let myRole = null; // 'host' | 'guest'
let lobbyChannel = null;
let gameChannel = null;

const WINNING_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// ── Screen helpers ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── NAME SCREEN ───────────────────────────────────────────
document.getElementById('name-btn').addEventListener('click', enterLobby);
document.getElementById('name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') enterLobby();
});

function enterLobby() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { document.getElementById('name-input').focus(); return; }
  playerName = val;
  localStorage.setItem('playerName', playerName);
  initLobby();
}

// Pre-fill name if returning
const savedName = localStorage.getItem('playerName');
if (savedName) document.getElementById('name-input').value = savedName;

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
  if (!rooms.length) {
    list.innerHTML = '<div class="empty">No rooms yet. Create one!</div>';
    return;
  }
  list.innerHTML = rooms.map(r => {
    const canJoin = r.status === 'waiting' && r.host_id !== playerId;
    const isMyRoom = r.host_id === playerId || r.guest_id === playerId;
    const statusLabel = r.status === 'waiting' ? 'Open' : r.status === 'playing' ? 'In Progress' : 'Finished';
    const guestLabel = r.guest_name ? `vs ${r.guest_name}` : '1/2 players';

    return `
      <div class="room-card">
        <div class="room-info">
          <span class="room-name">${escHtml(r.name)}</span>
          <span class="room-meta">Host: ${escHtml(r.host_name)} · ${guestLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="room-status-badge ${r.status}">${statusLabel}</span>
          ${canJoin ? `<button class="btn btn-join" onclick="joinRoom('${r.id}')">Join</button>` : ''}
          ${isMyRoom && r.status !== 'finished' ? `<button class="btn btn-join" onclick="rejoinRoom('${r.id}')">Rejoin</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function subscribeLobby() {
  unsubscribeLobby();
  lobbyChannel = db
    .channel('lobby')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => loadRooms())
    .subscribe();
}

function unsubscribeLobby() {
  if (lobbyChannel) { db.removeChannel(lobbyChannel); lobbyChannel = null; }
}

// ── CREATE / JOIN ROOM ────────────────────────────────────
async function createRoom() {
  const roomName = `${playerName}'s Room`;
  const { data, error } = await db
    .from('rooms')
    .insert({ name: roomName, host_name: playerName, host_id: playerId })
    .select()
    .single();

  if (error || !data) { alert('Could not create room. Try again.'); return; }
  currentRoom = data;
  myRole = 'host';
  unsubscribeLobby();
  initGameScreen();
}

async function joinRoom(roomId) {
  const { data, error } = await db
    .from('rooms')
    .update({ guest_name: playerName, guest_id: playerId, status: 'playing' })
    .eq('id', roomId)
    .eq('status', 'waiting')
    .select()
    .single();

  if (error || !data) { alert('Room no longer available.'); await loadRooms(); return; }
  currentRoom = data;
  myRole = 'guest';
  unsubscribeLobby();
  initGameScreen();
}

async function rejoinRoom(roomId) {
  const { data, error } = await db
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (error || !data) { alert('Room not found.'); return; }
  currentRoom = data;
  myRole = data.host_id === playerId ? 'host' : 'guest';
  unsubscribeLobby();
  initGameScreen();
}

// ── GAME SCREEN ───────────────────────────────────────────
document.getElementById('back-btn').addEventListener('click', leaveGame);
document.getElementById('back-lobby-btn').addEventListener('click', leaveGame);
document.getElementById('play-again-btn').addEventListener('click', playAgain);
document.querySelectorAll('.cell').forEach(c => c.addEventListener('click', handleCellClick));

function initGameScreen() {
  showScreen('screen-game');
  document.getElementById('room-title').textContent = currentRoom.name;
  document.getElementById('game-result').classList.add('hidden');
  renderGame(currentRoom);
  subscribeGame();
}

function renderGame(room) {
  // Players
  document.getElementById('player-x-name').textContent = room.host_name;
  document.getElementById('player-o-name').textContent = room.guest_name || 'Waiting…';

  const badge = document.getElementById('room-badge');
  if (room.status === 'waiting') {
    badge.textContent = 'Waiting…';
    badge.className = 'badge pulse';
  } else {
    badge.textContent = 'Live';
    badge.className = 'badge live';
  }

  // Board
  const cells = document.querySelectorAll('.cell');
  const myMark = myRole === 'host' ? 'X' : 'O';
  const isMyTurn = room.status === 'playing' && room.current_turn === myMark;

  cells.forEach((cell, i) => {
    const val = room.board[i];
    cell.className = 'cell';
    cell.innerHTML = '';
    if (val) {
      cell.classList.add(val.toLowerCase(), 'disabled');
      cell.innerHTML = `<span class="mark">${val}</span>`;
    } else if (isMyTurn && room.status === 'playing') {
      cell.classList.add('clickable');
    } else {
      cell.classList.add('disabled');
    }
  });

  // Highlight winner cells
  if (room.status === 'finished' && room.winner && room.winner !== 'draw') {
    const winLine = WINNING_LINES.find(line =>
      line.every(i => room.board[i] === room.winner)
    );
    if (winLine) winLine.forEach(i => cells[i].classList.add('winner'));
  }

  // Active turn highlight
  const xCard = document.getElementById('player-x-card');
  const oCard = document.getElementById('player-o-card');
  xCard.className = 'player-card' + (room.current_turn === 'X' && room.status === 'playing' ? ' active-turn' : '');
  oCard.className = 'player-card' + (room.current_turn === 'O' && room.status === 'playing' ? ' active-turn is-o' : '');

  // Status text
  const statusEl = document.getElementById('game-status');
  if (room.status === 'waiting') {
    statusEl.textContent = 'Share this room name with your friend!';
    statusEl.className = 'status pulse';
  } else if (room.status === 'playing') {
    if (isMyTurn) {
      statusEl.textContent = 'Your turn!';
      statusEl.className = 'status your-turn';
    } else {
      const opponentName = myRole === 'host' ? room.guest_name : room.host_name;
      statusEl.textContent = `${opponentName}'s turn…`;
      statusEl.className = 'status waiting-turn';
    }
  } else {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  // Result
  if (room.status === 'finished') {
    const resultEl = document.getElementById('game-result');
    const resultText = document.getElementById('result-text');
    resultEl.classList.remove('hidden');
    if (room.winner === 'draw') {
      resultText.textContent = "It's a Draw!";
    } else {
      const winnerName = room.winner === 'X' ? room.host_name : room.guest_name;
      const isMe = (room.winner === 'X' && myRole === 'host') || (room.winner === 'O' && myRole === 'guest');
      resultText.textContent = isMe ? '🎉 You Win!' : `${winnerName} Wins!`;
    }
    // Only host can play again (recreates room)
    document.getElementById('play-again-btn').style.display = myRole === 'host' ? '' : 'none';
  }
}

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

  const winLine = WINNING_LINES.find(line => line.every(i => newBoard[i] === myMark));
  const isDraw = !winLine && newBoard.every(c => c !== '');

  const update = {
    board: newBoard,
    current_turn: myMark === 'X' ? 'O' : 'X',
  };
  if (winLine) { update.status = 'finished'; update.winner = myMark; }
  else if (isDraw) { update.status = 'finished'; update.winner = 'draw'; }

  const { data } = await db.from('rooms').update(update).eq('id', currentRoom.id).select().single();
  if (data) currentRoom = data;
}

function subscribeGame() {
  unsubscribeGame();
  gameChannel = db
    .channel(`room-${currentRoom.id}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${currentRoom.id}`
    }, payload => {
      currentRoom = payload.new;
      renderGame(currentRoom);
    })
    .subscribe();
}

function unsubscribeGame() {
  if (gameChannel) { db.removeChannel(gameChannel); gameChannel = null; }
}

async function leaveGame() {
  // If host leaves a waiting room, delete it
  if (myRole === 'host' && currentRoom.status === 'waiting') {
    await db.from('rooms').delete().eq('id', currentRoom.id);
  }
  unsubscribeGame();
  currentRoom = null;
  myRole = null;
  initLobby();
}

async function playAgain() {
  // Host creates a fresh room with same name
  await db.from('rooms').update({ status: 'finished' }).eq('id', currentRoom.id);
  const { data, error } = await db
    .from('rooms')
    .insert({ name: currentRoom.name, host_name: playerName, host_id: playerId })
    .select()
    .single();

  if (error || !data) { alert('Could not start new game.'); return; }
  unsubscribeGame();
  currentRoom = data;
  myRole = 'host';
  initGameScreen();
}

// ── Utils ─────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
