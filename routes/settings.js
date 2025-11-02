const express = require('express');
const { SettingsService } = require('../services/settingsService');
const { getSequelize, models } = require('../db/sequelize');
const { requireRole } = require('../middleware/authSession');
const fs = require('fs');
const path = require('path');
let ExcelJS;

const router = express.Router();

function getService() {
  const sequelize = getSequelize();
  const { Setting } = models();
  const svc = new SettingsService(sequelize, Setting);
  return svc;
}

// Initialize cache once per process and reuse singleton service
let initialized = false;
let settingsServiceSingleton = null;
router.use(async (req, res, next) => {
  try {
    if (!initialized) {
      settingsServiceSingleton = getService();
      await settingsServiceSingleton.initCache();
      req.settingsService = settingsServiceSingleton;
      initialized = true;
    } else {
      // Riutilizza l'istanza già inizializzata per mantenere la cache coerente
      req.settingsService = settingsServiceSingleton || getService();
    }
    next();
  } catch (e) {
    // DB errors: still attach service with defaults-only cache
    try {
      if (!settingsServiceSingleton) {
        settingsServiceSingleton = getService();
        await settingsServiceSingleton.initCache();
      }
      req.settingsService = settingsServiceSingleton;
    } catch {}
    next();
  }
});

router.get('/settings', (req, res) => {
  const items = req.settingsService.getAll();
  res.json({ status: 'ok', items });
});

// Nota: le route specifiche devono precedere quella parametrica '/settings/:key'
// per evitare collisioni tipo '/settings/export-xlsx' che verrebbero catturate come ':key'

router.post('/settings', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { key, value, type } = req.body;
    if (!key) return res.status(400).json({ status: 'error', message: 'Missing key' });
    const saved = await req.settingsService.set(key, value, type);
    res.json({ status: 'ok', item: saved });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB unavailable', error: e.message });
  }
});

router.patch('/settings/bulk', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ status: 'error', message: 'items must be an array' });
    const saved = await req.settingsService.setBulk(items);
    res.json({ status: 'ok', items: saved });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB unavailable', error: e.message });
  }
});

router.get('/settings/export', (req, res) => {
  const obj = req.settingsService.export();
  const json = JSON.stringify(obj, null, 2);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="settings.json"');
  res.send(json);
});

router.post('/settings/import', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ status: 'error', message: 'Invalid JSON' });
    }
    const saved = await req.settingsService.import(payload);
    res.json({ status: 'ok', items: saved });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB unavailable', error: e.message });
  }
});

// Export settings to Excel (.xlsx) with one sheet per top-level section
router.get('/settings/export-xlsx', async (req, res) => {
  try {
    // Lazy-load exceljs to avoid startup cost if not installed
    if (!ExcelJS) {
      try { ExcelJS = require('exceljs'); } catch (e) {
        return res.status(500).json({ status: 'error', message: 'exceljs not installed' });
      }
    }
    const obj = req.settingsService.export();
    const cacheMap = req.settingsService.cache || new Map();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'First Aid Manager';
    workbook.created = new Date();

    const asFlat = (section, prefix = '') => {
      const out = [];
      const walk = (node, curPath) => {
        if (Array.isArray(node)) {
          node.forEach((item, idx) => walk(item, `${curPath}[${idx}]`));
          return;
        }
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) {
            walk(v, curPath ? `${curPath}.${k}` : k);
          }
          return;
        }
        const keyPath = curPath;
        const entry = cacheMap.get(keyPath);
        const type = entry ? entry.type : typeof section;
        const updatedAt = entry ? entry.updatedAt : null;
        out.push({ path: keyPath, type: type || typeof node, value: node, updatedAt });
      };
      walk(section, prefix);
      return out;
    };

    const addSheetFromObject = (name, data) => {
      const sheet = workbook.addWorksheet(String(name).slice(0, 31) || 'sheet');
      sheet.columns = [
        { header: 'path', key: 'path', width: 40 },
        { header: 'type', key: 'type', width: 12 },
        { header: 'value', key: 'value', width: 40 },
        { header: 'updatedAt', key: 'updatedAt', width: 22 }
      ];
      const rows = asFlat(data);
      rows.forEach(r => sheet.addRow({ path: r.path, type: r.type, value: r.value, updatedAt: r.updatedAt ? new Date(r.updatedAt) : '' }));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    };

    for (const [topKey, value] of Object.entries(obj || {})) {
      if (Array.isArray(value)) {
        // Create a sheet with tabular columns inferred from items
        const sheet = workbook.addWorksheet(String(topKey).slice(0, 31));
        const keys = new Set();
        value.forEach(item => { if (item && typeof item === 'object') Object.keys(item).forEach(k => keys.add(k)); });
        const columns = [{ header: 'index', key: '__index', width: 8 }];
        keys.forEach(k => columns.push({ header: k, key: k, width: 24 }));
        columns.push({ header: 'path', key: '__path', width: 32 });
        sheet.columns = columns;
        value.forEach((item, idx) => {
          const row = { __index: idx, __path: `${topKey}[${idx}]` };
          keys.forEach(k => { row[k] = (item && item[k] != null) ? item[k] : ''; });
          sheet.addRow(row);
        });
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
      } else if (value && typeof value === 'object') {
        addSheetFromObject(topKey, value);
      } else {
        // primitive at root: still export as a single row
        const sheet = workbook.addWorksheet(String(topKey).slice(0, 31));
        sheet.columns = [
          { header: 'path', key: 'path', width: 40 },
          { header: 'type', key: 'type', width: 12 },
          { header: 'value', key: 'value', width: 40 },
          { header: 'updatedAt', key: 'updatedAt', width: 22 }
        ];
        const entry = cacheMap.get(topKey);
        sheet.addRow({ path: topKey, type: entry ? entry.type : typeof value, value, updatedAt: entry ? entry.updatedAt : '' });
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
      }
    }

    // Se non sono stati aggiunti fogli, aggiungi un foglio di fallback per evitare file non apribili
    if (!workbook.worksheets || workbook.worksheets.length === 0) {
      const sheet = workbook.addWorksheet('impostazioni');
      sheet.columns = [
        { header: 'path', key: 'path', width: 40 },
        { header: 'type', key: 'type', width: 12 },
        { header: 'value', key: 'value', width: 40 },
        { header: 'updatedAt', key: 'updatedAt', width: 22 }
      ];
      sheet.addRow({ path: '(vuoto)', type: 'string', value: 'Nessuna impostazione disponibile', updatedAt: '' });
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="settings.xlsx"');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to export xlsx', error: e.message });
  }
});

// Route parametrica per ottenere una singola voce impostazioni
router.get('/settings/:key', (req, res) => {
  const key = req.params.key;
  const item = req.settingsService.get(key);
  if (!item) return res.status(404).json({ status: 'not_found', key });
  res.json({ status: 'ok', item });
});

// Irreversible clear of all settings (adds a purge lock to avoid reseeding defaults)
router.post('/settings/clear', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const svc = req.settingsService;
    await svc.Setting.destroy({ where: {} });
    svc.cache = new Map();
    const lockPath = path.resolve(__dirname, '../config/settings.purge.lock');
    try { fs.writeFileSync(lockPath, 'purged:' + new Date().toISOString(), 'utf8'); } catch {}
    res.json({ status: 'ok', message: 'All settings cleared irreversibly' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB unavailable', error: e.message });
  }
});

module.exports = router;