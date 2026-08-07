const jwt = require('jsonwebtoken');
const config = require('../config');

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, organizationId: user.organization_id },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 40101, message: '未登录', data: null });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ code: 40102, message: 'Token无效或已过期', data: null });
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 40101, message: '未登录', data: null });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 40301, message: '权限不足', data: null });
    }
    next();
  };
}

module.exports = { generateToken, authMiddleware, roleMiddleware };
