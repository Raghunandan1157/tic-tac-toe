const WINNING_LINES = [
  [0,1,2],[3,4,5],[6,7,8], // rows
  [0,3,6],[1,4,7],[2,5,8], // cols
  [0,4,8],[2,4,6]          // diagonals
];

let board = Array(9).fill(null);
let currentPlayer = 'X';
let gameOver = false;
let vsAI = false;
const scores = { X: 0, O: 0, draws: 0 };

const cells     = document.querySelectorAll('.cell');
const statusEl  = document.getElementById('status');
const resetBtn  = document.getElementById('reset-btn');
const resetScoreBtn = document.getElementById('reset-score-btn');
const aiToggle  = document.getElementById('ai-toggle');

cells.forEach(cell => cell.addEventListener('click', handleClick));
resetBtn.addEventListener('click', resetGame);
resetScoreBtn.addEventListener('click', resetScores);
aiToggle.addEventListener('change', () => { vsAI = aiToggle.checked; resetGame(); });

function handleClick(e) {
  const idx = +e.currentTarget.dataset.index;
  if (gameOver || board[idx]) return;
  makeMove(idx, currentPlayer);
  if (!gameOver && vsAI && currentPlayer === 'O') {
    setTimeout(aiMove, 350);
  }
}

function makeMove(idx, player) {
  board[idx] = player;
  const cell = cells[idx];
  cell.classList.add(player.toLowerCase(), 'taken');
  cell.innerHTML = `<span class="mark">${player}</span>`;

  const win = checkWin();
  if (win) {
    win.forEach(i => cells[i].classList.add('winner'));
    scores[player]++;
    updateScores();
    statusEl.textContent = `Player ${player} wins! 🎉`;
    statusEl.className = 'status win';
    gameOver = true;
    return;
  }
  if (board.every(Boolean)) {
    scores.draws++;
    updateScores();
    statusEl.textContent = "It's a draw!";
    statusEl.className = 'status draw';
    gameOver = true;
    return;
  }
  currentPlayer = player === 'X' ? 'O' : 'X';
  statusEl.textContent = vsAI && currentPlayer === 'O'
    ? 'AI is thinking...'
    : `Player ${currentPlayer}'s turn`;
  statusEl.className = 'status';
}

// Minimax AI
function aiMove() {
  const idx = bestMove();
  makeMove(idx, 'O');
}

function bestMove() {
  let best = -Infinity, move = -1;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = 'O';
      const score = minimax(board, 0, false);
      board[i] = null;
      if (score > best) { best = score; move = i; }
    }
  }
  return move;
}

function minimax(b, depth, isMax) {
  const win = checkWin(b);
  if (win) return isMax ? -10 + depth : 10 - depth;
  if (b.every(Boolean)) return 0;

  if (isMax) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!b[i]) { b[i] = 'O'; best = Math.max(best, minimax(b, depth+1, false)); b[i] = null; }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!b[i]) { b[i] = 'X'; best = Math.min(best, minimax(b, depth+1, true)); b[i] = null; }
    }
    return best;
  }
}

function checkWin(b = board) {
  for (const line of WINNING_LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return line;
  }
  return null;
}

function resetGame() {
  board = Array(9).fill(null);
  currentPlayer = 'X';
  gameOver = false;
  cells.forEach(cell => {
    cell.className = 'cell';
    cell.innerHTML = '';
  });
  statusEl.textContent = "Player X's turn";
  statusEl.className = 'status';
}

function updateScores() {
  document.getElementById('score-x').textContent = scores.X;
  document.getElementById('score-o').textContent = scores.O;
  document.getElementById('score-draws').textContent = scores.draws;
}

function resetScores() {
  scores.X = 0; scores.O = 0; scores.draws = 0;
  updateScores();
  resetGame();
}
