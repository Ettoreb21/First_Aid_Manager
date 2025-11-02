-- Schema SQL per persistenza stati dei button
-- Compatibile con SQLite e PostgreSQL

-- SQLite
-- Per usare SQLite, assicurarsi che DB_DIALECT=sqlite e DB_SQLITE_PATH nel .env
CREATE TABLE IF NOT EXISTS button_states (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

-- Trigger per aggiornare updated_at su SQLite
CREATE TRIGGER IF NOT EXISTS trg_button_states_updated
AFTER UPDATE ON button_states
FOR EACH ROW
BEGIN
  UPDATE button_states SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- PostgreSQL
-- Per PostgreSQL, impostare DB_DIALECT=postgres e le relative credenziali
-- Nota: usare statement separati in uno strumento/migrazione dedicata se necessario
-- CREATE TABLE IF NOT EXISTS button_states (
--   id TEXT PRIMARY KEY,
--   data TEXT NOT NULL,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );
-- CREATE OR REPLACE FUNCTION set_updated_at()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = CURRENT_TIMESTAMP;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER trg_button_states_updated
-- BEFORE UPDATE ON button_states
-- FOR EACH ROW EXECUTE FUNCTION set_updated_at();