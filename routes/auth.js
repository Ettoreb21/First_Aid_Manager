const express = require('express');
const Joi = require('joi');
const { getSequelize, models } = require('../db/sequelize');
const { AuthService } = require('../services/authService');
const { requireAuth, requireRole } = require('../middleware/authSession');

const router = express.Router();

function getService() {
  const sequelize = getSequelize();
  const { User } = models();
  const svc = new AuthService(sequelize, User);
  return { svc, User };
}

const roleEnum = ["master", "amministratore", "ospite"];

const registerSchema = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  username: Joi.string().alphanum().min(3).max(100).required(),
  email: Joi.string().email().required(),
  role: Joi.string().valid(...roleEnum).required(),
  password: Joi.string().min(8).pattern(/[A-Z]/).pattern(/[0-9]/).required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
});

router.post('/auth/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body || {});
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    const { svc, User } = getService();
    // Unique checks
    const existingUser = await User.findOne({ where: { username: value.username } });
    if (existingUser) return res.status(409).json({ status: 'conflict', message: 'Username già in uso' });
    const existingEmail = await User.findOne({ where: { email: value.email } });
    if (existingEmail) return res.status(409).json({ status: 'conflict', message: 'Email già registrata' });
    const user = await svc.register({
      firstName: value.firstName,
      lastName: value.lastName,
      username: value.username,
      email: value.email,
      role: value.role,
      password: value.password,
    });
    res.json({ status: 'ok', user: { id: user.id, username: user.username, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName } });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB non disponibile', error: e.message });
  }
});

const loginSchema = Joi.object({
  identifier: Joi.string().min(3).required(),
  password: Joi.string().min(8).required(),
});

router.post('/auth/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body || {});
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    const { svc } = getService();
    const user = await svc.verifyCredentials(value.identifier, value.password);
    if (!user) return res.status(401).json({ status: 'unauthorized', message: 'Credenziali non valide' });
    req.session.user = { id: user.id, role: user.role, username: user.username, firstName: user.firstName, lastName: user.lastName };
    res.json({ status: 'ok', user: req.session.user });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB non disponibile', error: e.message });
  }
});

router.post('/auth/logout', (req, res) => {
  try {
    req.session.destroy(() => {
      res.json({ status: 'ok' });
    });
  } catch (e) {
    res.json({ status: 'ok' });
  }
});

router.get('/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ status: 'ok', user: req.session.user });
  }
  return res.status(401).json({ status: 'unauthorized' });
});

// Users management endpoints (protected)
const userListSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('id','firstName','lastName','email','role','createdAt').default('createdAt'),
  sortDir: Joi.string().valid('asc','desc').default('desc'),
});

router.get('/auth/users', requireRole('master','amministratore'), async (req, res) => {
  try {
    const { error, value } = userListSchema.validate(req.query || {});
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    const { User } = getService();
    const { page, pageSize, sortBy, sortDir } = value;
    const offset = (page - 1) * pageSize;
    const result = await User.findAndCountAll({
      limit: pageSize,
      offset,
      order: [[sortBy, sortDir.toUpperCase()]],
      attributes: ['id','firstName','lastName','email','role','createdAt','username'],
    });
    const items = result.rows.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      username: u.username,
    }));
    res.json({ status: 'ok', data: { items, page, pageSize, total: result.count, sort: { by: sortBy, dir: sortDir } } });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB non disponibile', error: e.message });
  }
});

const userUpdateSchema = Joi.object({
  firstName: Joi.string().min(1).max(100),
  lastName: Joi.string().min(1).max(100),
  email: Joi.string().email(),
  role: Joi.string().valid(...roleEnum),
}).min(1);

router.put('/auth/users/:id', requireRole('master','amministratore'), async (req, res) => {
  try {
    const { error, value } = userUpdateSchema.validate(req.body || {});
    if (error) return res.status(400).json({ status: 'error', message: error.message });
    const { User } = getService();
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ status: 'not_found', message: 'Utente non trovato' });
    // Email uniqueness check if changing
    if (value.email && value.email !== user.email) {
      const existingEmail = await User.findOne({ where: { email: value.email } });
      if (existingEmail) return res.status(409).json({ status: 'conflict', message: 'Email già registrata' });
    }
    // Update fields
    ['firstName','lastName','email','role'].forEach(k => {
      if (value[k] !== undefined) user[k] = value[k];
    });
    await user.save();
    res.json({ status: 'ok', user: { id: user.id, username: user.username, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName } });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB non disponibile', error: e.message });
  }
});

router.delete('/auth/users/:id', requireRole('master','amministratore'), async (req, res) => {
  try {
    const { User } = getService();
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ status: 'not_found', message: 'Utente non trovato' });
    // Avoid deleting self (optional safeguard)
    if (req.session?.user?.id === user.id) {
      return res.status(400).json({ status: 'error', message: 'Non puoi eliminare te stesso' });
    }
    await user.destroy();
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'DB non disponibile', error: e.message });
  }
});

module.exports = router;