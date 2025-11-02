-- SQLite schema for materials and logs (testing/local)

CREATE TABLE IF NOT EXISTS materiali (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_materiale TEXT NOT NULL,
  categoria TEXT,
  quantita INTEGER,
  unita_misura TEXT,
  data_acquisizione DATE,
  data_scadenza DATE,
  fornitore TEXT,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_logs (
  id_log INTEGER PRIMARY KEY AUTOINCREMENT,
  id_record INTEGER NOT NULL,
  utente TEXT,
  operazione TEXT NOT NULL CHECK (operazione IN ('INSERT','UPDATE','DELETE')),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_record) REFERENCES materiali(id) ON DELETE CASCADE
);

-- Optional trigger to keep updated_at in sync
CREATE TRIGGER IF NOT EXISTS materiali_updated_at
AFTER UPDATE ON materiali
FOR EACH ROW
BEGIN
  UPDATE materiali SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;