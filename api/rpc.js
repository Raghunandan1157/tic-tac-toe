import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const EMPTY = ['', '', '', '', '', '', '', '', ''];
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const ONLINE_MS = 6000;

const roleOf = (room, pid) => room.host_id === pid ? 'host' : room.guest_id === pid ? 'guest' : null;

function view(room, pid) {
  const role = roleOf(room, pid);
  const other = role === 'host' ? room.guest_seen : room.host_seen;
  const online = other ? Date.now() - new Date(other).getTime() < ONLINE_MS : false;
  return { ...room, opponent_online: online };
}

const ops = {
  async list() {
    return sql`SELECT * FROM rooms
      WHERE status IN ('waiting','playing') AND host_seen > now() - interval '15 minutes'
      ORDER BY created_at DESC`;
  },

  async create({ hostName, playerId }) {
    const name = String(hostName).slice(0, 20);
    const [room] = await sql`INSERT INTO rooms (name, host_name, host_id)
      VALUES (${name + "'s Room"}, ${name}, ${playerId}) RETURNING *`;
    return room;
  },

  async join({ roomId, name, playerId }) {
    const [room] = await sql`UPDATE rooms
      SET guest_name = ${String(name).slice(0, 20)}, guest_id = ${playerId}, status = 'playing', guest_seen = now()
      WHERE id = ${roomId} AND status = 'waiting' RETURNING *`;
    if (!room) throw new Error('Room no longer available.');
    return room;
  },

  async get({ roomId, playerId }) {
    const [room] = await sql`UPDATE rooms SET
        host_seen  = CASE WHEN host_id  = ${playerId} THEN now() ELSE host_seen  END,
        guest_seen = CASE WHEN guest_id = ${playerId} THEN now() ELSE guest_seen END
      WHERE id = ${roomId} RETURNING *`;
    if (!room) throw new Error('Room not found.');
    return view(room, playerId);
  },

  async move({ roomId, playerId, idx }) {
    const [room] = await sql`SELECT * FROM rooms WHERE id = ${roomId}`;
    if (!room) throw new Error('Room not found.');
    const role = roleOf(room, playerId);
    const mark = role === 'host' ? 'X' : 'O';
    if (!role || room.status !== 'playing' || room.current_turn !== mark || room.board[idx]) {
      return view(room, playerId);
    }
    const board = [...room.board];
    board[idx] = mark;
    const won = LINES.some(l => l.every(i => board[i] === mark));
    const full = board.every(c => c !== '');
    const status = won || full ? 'finished' : 'playing';
    const winner = won ? mark : full ? 'draw' : null;
    const [next] = await sql`UPDATE rooms SET board = ${JSON.stringify(board)}::jsonb,
        current_turn = ${mark === 'X' ? 'O' : 'X'}, status = ${status}, winner = ${winner}, draw_by = NULL
      WHERE id = ${roomId} AND round = ${room.round} AND status = 'playing' AND board = ${JSON.stringify(room.board)}::jsonb
      RETURNING *`;
    if (next) return view(next, playerId);
    const [cur] = await sql`SELECT * FROM rooms WHERE id = ${roomId}`;
    return view(cur, playerId);
  },

  // Anyone may call this once a round is finished; the status guard prevents a double reset.
  async reset({ roomId, playerId }) {
    const [room] = await sql`UPDATE rooms SET board = ${JSON.stringify(EMPTY)}::jsonb,
        current_turn = CASE WHEN (round + 1) % 2 = 0 THEN 'X' ELSE 'O' END,
        status = 'playing', winner = NULL, draw_by = NULL, round = round + 1
      WHERE id = ${roomId} AND status = 'finished' RETURNING *`;
    if (room) return view(room, playerId);
    return ops.get({ roomId, playerId });
  },

  async draw({ roomId, playerId }) {
    const [cur] = await sql`SELECT * FROM rooms WHERE id = ${roomId}`;
    if (!cur) throw new Error('Room not found.');
    const role = roleOf(cur, playerId);
    if (!role || cur.status !== 'playing') return view(cur, playerId);
    if (cur.draw_by && cur.draw_by !== role) {
      const [room] = await sql`UPDATE rooms SET board = ${JSON.stringify(EMPTY)}::jsonb,
          current_turn = CASE WHEN (round + 1) % 2 = 0 THEN 'X' ELSE 'O' END,
          status = 'playing', winner = NULL, draw_by = NULL, round = round + 1
        WHERE id = ${roomId} AND status = 'playing' AND draw_by IS NOT NULL RETURNING *`;
      return view(room || cur, playerId);
    }
    const [room] = await sql`UPDATE rooms SET draw_by = ${role}
      WHERE id = ${roomId} AND status = 'playing' AND draw_by IS NULL RETURNING *`;
    return view(room || cur, playerId);
  },

  async remove({ roomId, playerId }) {
    await sql`DELETE FROM rooms WHERE id = ${roomId} AND host_id = ${playerId}`;
    return { ok: true };
  },

  async removeAll({ password }) {
    if (password !== (process.env.ADMIN_PASSWORD || '1234')) throw new Error('Wrong password.');
    await sql`DELETE FROM rooms`;
    return { ok: true };
  },

  async health() {
    const [r] = await sql`SELECT now() AS now, (SELECT count(*) FROM rooms)::int AS rooms`;
    return r;
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};
  const op = body.op || req.query.op;
  if (!ops[op]) return res.status(400).json({ error: 'Unknown op' });
  try {
    res.status(200).json({ data: await ops[op](body) });
  } catch (e) {
    const client = e.message?.startsWith('Room') || e.message?.startsWith('Wrong');
    res.status(client ? 400 : 500).json({ error: e.message });
  }
}
