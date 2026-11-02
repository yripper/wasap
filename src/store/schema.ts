/// Append-only: each entry upgrades user_version N → N+1. Never edit a
/// shipped migration; add a new one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT,
    -- Never negative: WhatsApp's -1 ("marked unread") lives in marked_unread.
    unread_count INTEGER NOT NULL DEFAULT 0,
    marked_unread INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    wa_muted_until INTEGER,
    watch_level TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    snooze_until INTEGER,
    last_msg_ts INTEGER,
    last_msg_from_me INTEGER,
    created_at INTEGER NOT NULL
  );

  -- Surrogate seq because FTS5 external content needs an integer rowid.
  CREATE TABLE messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    wa_id TEXT NOT NULL,
    from_me INTEGER NOT NULL,
    sender_jid TEXT,
    ts INTEGER NOT NULL,
    text TEXT,
    media_kind TEXT,
    quoted_id TEXT,
    edited_at INTEGER,
    deleted_at INTEGER,
    sent_via_wasap INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chat_id, wa_id)
  );
  CREATE INDEX messages_chat_seq ON messages (chat_id, seq);
  CREATE INDEX messages_chat_from_me_ts ON messages (chat_id, from_me, ts);

  CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='seq');
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, text) VALUES (new.seq, new.text);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
  END;
  CREATE TRIGGER messages_au AFTER UPDATE OF text ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    INSERT INTO messages_fts (rowid, text) VALUES (new.seq, new.text);
  END;

  -- @lid ↔ phone-number JIDs: alias resolves to the canonical chat id.
  CREATE TABLE jid_aliases (
    alias TEXT PRIMARY KEY,
    canonical TEXT NOT NULL
  );

  CREATE TABLE contacts (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE cleanup_plans (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    mode TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL
  );

  -- Metadata only: never message text or secrets.
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    action TEXT NOT NULL,
    chat_id TEXT,
    outcome TEXT NOT NULL
  );
  `,
];
