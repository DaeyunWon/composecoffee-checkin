const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login - 로그인
router.post('/login', (req, res) => {
  try {
    const db = global.db;
    const { loginId, password } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'ID와 비밀번호를 입력해주세요.' });
    }

    const user = db.prepare(
      'SELECT id, login_id, password_hash, name, role, branch_id, is_active FROM users WHERE login_id = ?'
    ).get(loginId);

    if (!user) {
      return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, branchId: user.branch_id },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    const branch = db.prepare('SELECT id, name, latitude, longitude, radius_meters FROM branches WHERE id = ?').get(user.branch_id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        branch: branch
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/auth/me - 현재 사용자 정보
router.get('/me', authenticate, (req, res) => {
  const db = global.db;
  const branch = db.prepare('SELECT id, name, latitude, longitude, radius_meters FROM branches WHERE id = ?').get(req.user.branch_id);
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role,
      branch: branch
    }
  });
});

// POST /api/auth/change-password - 비밀번호 변경
router.post('/change-password', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const isValid = bcrypt.compareSync(currentPassword, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newHash, req.user.id);

    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
