CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  username             TEXT NOT NULL UNIQUE,
  password             TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  deactivated          INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  last_login           INTEGER
);

CREATE INDEX idx_users_username ON users(username);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
