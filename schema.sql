CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  host_name text NOT NULL,
  host_id text NOT NULL,
  guest_name text,
  guest_id text,
  status text NOT NULL DEFAULT 'waiting',
  board jsonb NOT NULL DEFAULT '["","","","","","","","",""]',
  current_turn text NOT NULL DEFAULT 'X',
  winner text,
  round int NOT NULL DEFAULT 0,
  draw_by text,
  host_seen timestamptz NOT NULL DEFAULT now(),
  guest_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
