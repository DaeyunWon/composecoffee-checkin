const jwt = require('jsonwebtoken');
const config = require('../config');

// JWT 토큰 검증 미들웨어
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const db = global.db;
    const user = db.prepare('SELECT id, login_id, name, role, branch_id, is_active FROM users WHERE id = ?').get(decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: '유효하지 않은 사용자입니다.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다.' });
  }
}

// 관리자 권한 확인 미들웨어
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
