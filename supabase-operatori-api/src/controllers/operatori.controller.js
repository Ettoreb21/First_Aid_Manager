import * as service from '../services/operatori.service.js';

export async function listOperatori(req, res, next) {
  try {
    const rows = await service.getAllOperatori();
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getOperatore(req, res, next) {
  try {
    const { id } = req.params;
    const row = await service.getOperatoreById(id);
    if (!row) return res.status(404).json({ error: 'Operatore non trovato' });
    res.json(row);
  } catch (err) { next(err); }
}

export async function creaOperatore(req, res, next) {
  try {
    const created = await service.createOperatore(req.body);
    res.status(201).json(created);
  } catch (err) { next(err); }
}

export async function aggiornaOperatore(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await service.updateOperatore(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Operatore non trovato' });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function eliminaOperatore(req, res, next) {
  try {
    const { id } = req.params;
    const ok = await service.deleteOperatore(id);
    if (!ok) return res.status(404).json({ error: 'Operatore non trovato' });
    res.status(204).send();
  } catch (err) { next(err); }
}
