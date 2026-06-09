CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  callback_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states (created_at)
