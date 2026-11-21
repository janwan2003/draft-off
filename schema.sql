-- Draftoff (snake drafts for group chats). One SQLite database per draft (Durable Object storage).
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,                          -- topic pack slug, or NULL for a custom topic
  pool TEXT NOT NULL DEFAULT '[]',     -- JSON array: suggestions + autopick order
  rounds INTEGER NOT NULL,
  timer INTEGER NOT NULL DEFAULT 0,    -- seconds per pick, 0 = no limit
  status TEXT NOT NULL DEFAULT 'lobby', -- lobby | drafting | voting | done
  draft_order TEXT NOT NULL DEFAULT '[]', -- JSON array of member ids, set at start
  pick_started_at INTEGER,
  vote_ends_at INTEGER,
  host_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                  -- drafter | voter
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_draft ON members(draft_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_token ON members(token_hash);
CREATE TABLE IF NOT EXISTS picks (
  draft_id TEXT NOT NULL,
  n INTEGER NOT NULL,                  -- overall pick number, 0-based
  member_id TEXT NOT NULL,
  item TEXT,                           -- NULL = skipped
  norm TEXT,
  auto INTEGER NOT NULL DEFAULT 0,     -- 0 picked, 1 autopicked, 2 skipped
  created_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, n)
);
CREATE UNIQUE INDEX IF NOT EXISTS picks_unique ON picks(draft_id, norm);
CREATE TABLE IF NOT EXISTS votes (
  draft_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  team TEXT NOT NULL,
  mvp INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, member_id)
);
