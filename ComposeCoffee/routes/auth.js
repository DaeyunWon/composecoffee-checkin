const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { getKSTNow } = require('../utils/kst');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const db = global.db;
    const { loginId, password } = req.body;
    if (!loginId || !password) return res.status(400).json({ error: 'ID와 비밀번호를 입력해주세요.' });
    const user = db.prepare('SELECT id, login_id, password_hash, name, role, branch_id, is_active FROM users WHERE login_id = ?').get(loginId);
    if (!user) return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    if (!user.is_active) return res.status(401).json({ error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    const token = jwt.sign({ userId: user.id, role: user.role, branchId: user.branch_id }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
    const branch = db.prepare('SELECT id, name, latitude, longitude, radius_meters FROM branches WHERE id = ?').get(user.branch_id);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, branch } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const db = global.db;
  const branch = db.prepare('SELECT id, name, latitude, longitude, radius_meters FROM branches WHERE id = ?').get(req.user.branch_id);
  const fullUser = db.prepare('SELECT phone FROM users WHERE id = ?').get(req.user.id);
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role,
      phone: fullUser ? (fullUser.phone || '') : '',
      branch
    }
  });
});

// PUT /api/auth/profile - 본인 프로필(전화번호 등) 수정
router.put('/profile', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { phone } = req.body;
    if (phone == null) return res.status(400).json({ error: '변경할 정보가 없습니다.' });
    const trimmed = String(phone).trim();
    if (trimmed.length > 20) return res.status(400).json({ error: '전화번호가 너무 깁니다.' });
    if (trimmed && !/^[\d\-\s+()]+$/.test(trimmed)) {
      return res.status(400).json({ error: '전화번호 형식이 올바르지 않습니다.' });
    }
    db.prepare('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?').run(trimmed, getKSTNow(), req.user.id);
    res.json({ message: '프로필이 수정되었습니다.', phone: trimmed });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    if (newPassword.length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isValid) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    const newHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, getKSTNow(), req.user.id);
    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
