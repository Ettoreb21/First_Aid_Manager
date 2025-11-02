-- Sample INSERTs for SQLite materials archive
-- Run after creating tables via scripts/materials.sqlite.sql

PRAGMA foreign_keys = ON;

-- 1) Pacco garze
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Pacco garze', 'Medicazione', 50, 'pezzi',
  '2025-10-01', '2025-12-31', 'Fornitore Srl', 'Confezioni singole'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');

-- 2) Cerotti
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Cerotti', 'Medicazione', 100, 'pezzi',
  '2025-10-21', '2026-06-30', 'HealthCare Spa', 'Assortiti'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');

-- 3) Disinfettante
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Disinfettante', 'Igiene', 20, 'bottiglie',
  '2025-10-26', DATE('now','+20 day'), 'Clean&Care', '500ml'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');

-- 4) Guanti monouso
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Guanti monouso', 'Protezione', 200, 'pezzi',
  '2025-09-15', '2027-03-31', 'SafeHands Ltd', 'Misura M'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');

-- 5) Ghiaccio istantaneo
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Ghiaccio istantaneo', 'Soccorsi', 30, 'buste',
  '2025-08-10', '2026-02-15', 'CoolAid', 'Monouso'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');

-- 6) Benda elastica
INSERT INTO materiali (
  nome_materiale, categoria, quantita, unita_misura,
  data_acquisizione, data_scadenza, fornitore, note
) VALUES (
  'Benda elastica', 'Medicazione', 40, 'pezzi',
  '2025-07-01', '2026-12-31', 'MedFlex', '5cm x 4m'
);
INSERT INTO material_logs (id_record, utente, operazione)
VALUES (last_insert_rowid(), 'admin', 'INSERT');