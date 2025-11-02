-- PostgreSQL schema for materials and logs

CREATE TABLE IF NOT EXISTS materiali (
  id SERIAL PRIMARY KEY,
  nome_materiale VARCHAR(255) NOT NULL,
  categoria VARCHAR(255),
  quantita INTEGER,
  unita_misura VARCHAR(50),
  data_acquisizione DATE,
  data_scadenza DATE,
  fornitore VARCHAR(255),
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_logs (
  id_log SERIAL PRIMARY KEY,
  id_record INTEGER NOT NULL REFERENCES materiali(id) ON DELETE CASCADE,
  utente VARCHAR(255),
  operazione VARCHAR(10) NOT NULL CHECK (operazione IN ('INSERT','UPDATE','DELETE')),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);