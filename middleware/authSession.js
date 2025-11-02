function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ status: 'unauthorized', message: 'Login richiesto' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ status: 'unauthorized', message: 'Login richiesto' });
    }
    const userRole = req.session.user.role;
    if (roles.includes(userRole)) return next();
    return res.status(403).json({ status: 'forbidden', message: 'Permessi insufficienti' });
  };
}

module.exports = { requireAuth, requireRole };