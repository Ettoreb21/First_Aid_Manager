const express = require('express');
const router = express.Router();
const { getSequelize, models } = require('../db/sequelize');
const { requireRole } = require('../middleware/authSession');
const { ButtonService } = require('../services/buttonService');
let ExcelJS;

function getService() {
  const sequelize = getSequelize();
  const m = typeof models === 'function' ? models() : models;
  const ButtonState = m.ButtonState;
  const svc = new ButtonService(sequelize, ButtonState);
  svc.initCache();
  return svc;
}

router.use((req, res, next) => {
  req.buttonService = getService();
  next();
});

// GET /api/buttons -> lista stati
router.get('/', (req, res) => {
  res.json(req.buttonService.getAll());
});

// GET /api/buttons/:id -> stato singolo
router.get('/:id', (req, res) => {
  const item = req.buttonService.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// POST /api/buttons/:id -> salva stato
router.post('/:id', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const saved = await req.buttonService.set(req.params.id, req.body || {});
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ======= Bulk XLSX Template Export (single 'button' column) =======
router.get('/export-template-xlsx', async (req, res) => {
  try {
    if (!ExcelJS) {
      try { ExcelJS = require('exceljs'); } catch (e) {
        return res.status(500).json({ status: 'error', message: 'exceljs not installed' });
      }
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'First Aid Manager';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('ButtonBulk');

    // Intestazioni e larghezze
    sheet.columns = [
      { header: 'id', key: 'id', width: 24 },
      { header: 'button', key: 'button', width: 24 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Aggiungi una riga di esempio vuota per creare la tabella
    sheet.addRow({ id: '', button: '' });

    // Crea una Table per facilitare la gestione dei dati (compatibile con Excel 2016+)
    sheet.addTable({
      name: 'ButtonBulkTable',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium9', showRowStripes: true },
      columns: [
        { name: 'id' },
        { name: 'button' }
      ],
      rows: [
        ['', '']
      ]
    });

    // Validazioni: celle non vuote per righe 2..10001
    sheet.dataValidations.add('A2:A10001', { type: 'textLength', operator: 'greaterThan', formulae: [0], allowBlank: false });
    sheet.dataValidations.add('B2:B10001', { type: 'textLength', operator: 'greaterThan', formulae: [0], allowBlank: false });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="buttons_template.xlsx"');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to export template', error: e.message });
  }
});

// ======= Bulk XLSX Import =======
// Accetta il file XLSX come binary octet-stream per grandi volumi (>=10k righe)
router.post('/import-xlsx', requireRole('master', 'amministratore'), express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
  try {
    if (!ExcelJS) {
      try { ExcelJS = require('exceljs'); } catch (e) {
        return res.status(500).json({ status: 'error', message: 'exceljs not installed' });
      }
    }
    const buffer = req.body;
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Missing XLSX binary body' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ status: 'error', message: 'No worksheet found' });

    // Mappa colonne per intestazione
    const headerRow = sheet.getRow(1);
    const headers = headerRow.values.map(v => String(v || '').trim().toLowerCase());
    const colIndex = (nameCandidates) => {
      for (const name of nameCandidates) {
        const idx = headers.indexOf(name);
        if (idx !== -1) return idx; // ExcelJS rows are 1-based, values include null at index 0
      }
      return -1;
    };
    const idCol = colIndex(['id']);
    // Unica colonna 'button' (compatibilità: accetta anche 'button1')
    const buttonCol = colIndex(['button', 'button1', 'button_1']);

    if (idCol === -1 || buttonCol === -1) {
      return res.status(400).json({ status: 'error', message: 'Required columns missing: id, button' });
    }

    const report = { successes: [], failures: [] };
    const svc = req.buttonService;

    // Itera su righe con dati (2..n)
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const id = String(row.getCell(idCol).value || '').trim();
      const btn = String(row.getCell(buttonCol).value || '').trim();

      // Salta righe completamente vuote
      const allEmpty = [id, btn].every(v => v === '');
      if (allEmpty) continue;

      if (!id) {
        report.failures.push({ row: r, error: 'Missing id' });
        continue;
      }
      if (!btn) {
        report.failures.push({ row: r, id, error: 'Missing button' });
        continue;
      }
      try {
        const data = { button: btn };
        const saved = await svc.set(id, data);
        report.successes.push({ row: r, id, updatedAt: saved.updatedAt });
      } catch (e) {
        report.failures.push({ row: r, id, error: e.message });
      }
    }

    res.json({ status: 'ok', succeeded: report.successes.length, failed: report.failures.length, report });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to import xlsx', error: e.message });
  }
});