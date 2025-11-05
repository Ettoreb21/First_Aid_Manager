const crypto = require('crypto');

module.exports = function correlationId(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const id = incoming || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};