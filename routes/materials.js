const express = require('express');
const Joi = require('joi');
const ExcelJS = require('exceljs');
const { models } = require('../db/sequelize');
const { requireRole } = require('../middleware/authSession');

const router = express.Router();

function getModels() {
  const m = models();
  if (!m || !m.Material) {
    throw new Error('Sequelize models not initialized');
  }
  return m;
}

const materialSchema = Joi.object({
  nome_materiale: Joi.string().min(1).required(),
  categoria: Joi.string().allow('').optional(),
  quantita: Joi.number().integer().min(0).optional(),
  unita_misura: Joi.string().allow('').optional(),
  data_acquisizione: Joi.date().optional(),
  data_scadenza: Joi.date().optional(),
  fornitore: Joi.string().allow('').optional(),
  note: Joi.string().allow('').optional(),
});

// Live search and list
router.get('/materiali', async (req, res) => {
  try {
    const { Material } = getModels();
    const { query = '', categoria, fornitore } = req.query;

    const where = {};
    const { Op } = require('sequelize');

    if (query && query.trim() !== '') {
      where[Op.or] = [
        { nome_materiale: { [Op.iLike]: `%${query}%` } },
        { categoria: { [Op.iLike]: `%${query}%` } },
        { fornitore: { [Op.iLike]: `%${query}%` } },
      ];
    }
    if (categoria) where.categoria = categoria;
    if (fornitore) where.fornitore = fornitore;

    const items = await Material.findAll({ where, order: [['id', 'DESC']] });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Expiry filters
router.get('/materiali/scadenze', async (req, res) => {
  try {
    const { Material } = getModels();
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const days = parseInt(req.query.days || process.env.EXPIRY_THRESHOLD_DAYS || '30', 10);
    const includeExpired = String(req.query.expired || 'true') === 'true';

    const all = await Material.findAll({ order: [['data_scadenza', 'ASC']] });
    const filtered = all.filter((m) => {
      const ds = m.dataValues.data_scadenza;
      if (!ds) return false;
      const exp = new Date(ds);
      const diffDays = Math.floor((exp.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / dayMs);
      if (includeExpired && diffDays < 0) return true;
      return diffDays >= 0 && diffDays <= days;
    });
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create
router.post('/materiali', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { Material, MaterialLog } = getModels();
    const { error, value } = materialSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const created = await Material.create(value);
    await MaterialLog.create({
      id_record: created.id,
      utente: req.headers['x-user'] || 'system',
      operazione: 'INSERT',
      timestamp: new Date(),
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update
router.put('/materiali/:id', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { Material, MaterialLog } = getModels();
    const { error, value } = materialSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const id = parseInt(req.params.id, 10);
    const item = await Material.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.update(value);
    await MaterialLog.create({
      id_record: id,
      utente: req.headers['x-user'] || 'system',
      operazione: 'UPDATE',
      timestamp: new Date(),
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete('/materiali/:id', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { Material, MaterialLog } = getModels();
    const id = parseInt(req.params.id, 10);
    const item = await Material.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    await item.destroy();
    await MaterialLog.create({
      id_record: id,
      utente: req.headers['x-user'] || 'system',
      operazione: 'DELETE',
      timestamp: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excel export (.xlsx)
router.get('/export/excel', async (req, res) => {
  try {
    const { Material } = getModels();
    const { query = '' } = req.query;
    const { Op } = require('sequelize');

    const where = {};
    if (query && query.trim() !== '') {
      where[Op.or] = [
        { nome_materiale: { [Op.iLike]: `%${query}%` } },
        { categoria: { [Op.iLike]: `%${query}%` } },
        { fornitore: { [Op.iLike]: `%${query}%` } },
      ];
    }
    const items = await Material.findAll({ where, order: [['id', 'DESC']] });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Materiali');
    ws.addRow(['Export materiali', new Date().toISOString()]).font = { bold: true };
    ws.addRow([]);
    ws.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Nome', key: 'nome_materiale', width: 30 },
      { header: 'Categoria', key: 'categoria', width: 20 },
      { header: 'Quantità', key: 'quantita', width: 12 },
      { header: 'Unità', key: 'unita_misura', width: 12 },
      { header: 'Acquisizione', key: 'data_acquisizione', width: 15 },
      { header: 'Scadenza', key: 'data_scadenza', width: 15 },
      { header: 'Fornitore', key: 'fornitore', width: 25 },
      { header: 'Note', key: 'note', width: 40 },
      { header: 'Stato', key: 'stato_scadenza', width: 15 },
    ];
    items.forEach((m) => {
      ws.addRow({
        id: m.id,
        nome_materiale: m.nome_materiale,
        categoria: m.categoria,
        quantita: m.quantita,
        unita_misura: m.unita_misura,
        data_acquisizione: m.data_acquisizione || '',
        data_scadenza: m.data_scadenza || '',
        fornitore: m.fornitore || '',
        note: m.note || '',
        stato_scadenza: m.stato_scadenza,
      });
    });

    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .slice(0, 15);
    const path = `report/materiali_export_${ts}.xlsx`;
    await wb.xlsx.writeFile(path);
    res.json({ ok: true, path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// Notifications endpoint (manual trigger)
router.post('/notifiche/scadenze', requireRole('master', 'amministratore'), async (req, res) => {
  try {
    const { sendExpiringMaterialsReport } = require('../services/expiryNotificationService');
    const { to, days, thresholdCount } = req.body || {};
    const result = await sendExpiringMaterialsReport({ to, days, thresholdCount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});