module.exports = function apiAuth(req, res, next) {
  const expected = process.env.API_KEY;
  if (!expected) return next(); // no auth configured
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};