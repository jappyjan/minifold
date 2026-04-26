CREATE TABLE dir_cache (
  path        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
