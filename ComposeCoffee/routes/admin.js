const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getKSTNow, getKSTDate, getKSTYear, getKSTMonth } = require('../utils/kst');

const router = express.Router();

router.use(authenticate, requireAdmin);

// ==================== 지점 관리 ====================

router.get('/branches', (req, res) => {
  try {
    const db = global.db;
    const branches = db.prepare(`
      SELECT b.*, COUNT(u.id) as staff_count
      FROM branches b
      LEFT JOIN users u ON u.branch_id = b.id AND u.is_active = 1
      GROUP BY b.id
      ORDER BY b.name
    `).all();
    res.json({ branches });
  } catch (err) {
    console.error('List branches error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/branches', (req, res) => {
  try {
    const db = global.db;
    const { name, address, latitude, longitude, radiusMeters } = req.body;

    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({ error: '지점명, 위도, 경도는 필수입니다.' });
    }

    const result = db.prepare(
      'INSERT INTO branches (name, address, latitude, longitude, radius_meters) VALUES (?, ?, ?, ?, ?)'
    ).run(name, address || '', latitude, longitude, radiusMeters || config.DEFAULT_RADIUS_METERS);

    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(result.lastInsertRowid);
    res.json({ message: '지점이 추가되었습니다.', branch });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '이미 동일한 이름의 지점이 존재합니다.' });
    }
    console.error('Create branch error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.put('/branches/:id', (req, res) => {
  try {
    const db = global.db;
    const { name, address, latitude, longitude, radiusMeters } = req.body;
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(parseInt(req.params.id));

    if (!branch) {
      return res.status(404).json({ error: '지점을 찾을 수 없습니다.' });
    }

    db.prepare(
      'UPDATE branches SET name = ?, address = ?, latitude = ?, longitude = ?, radius_meters = ? WHERE id = ?'
    ).run(
      name || branch.name,
      address ?? branch.address,
      latitude ?? branch.latitude,
      longitude ?? branch.longitude,
      radiusMeters ?? branch.radius_meters,
      parseInt(req.params.id)
    );

    const updated = db.prepare('SELECT * FROM branches WHERE id = ?').get(parseInt(req.params.id));
    res.json({ message: '지점 정보가 수정되었습니다.', branch: updated });
  } catch (err) {
    console.error('Update branch error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/branches/:id/qrcode', async (req, res) => {
  try {
    const db = global.db;
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(parseInt(req.params.id));
    if (!branch) {
      return res.status(404).json({ error: '지점을 찾을 수 없습니다.' });
    }

    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
    const qrUrl = `${baseUrl}/?branch=${branch.id}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.json({
      branch: { id: branch.id, name: branch.name },
      qrUrl,
      qrImage: qrDataUrl
    });
  } catch (err) {
    console.error('QR code error:', err);
    res.status(500).json({ error: 'QR코드 생성 중 오류가 발생했습니다.' });
  }
});

// ==================== 직원 관리 ====================

router.get('/users', (req, res) => {
  try {
    const db = global.db;
    const { branchId } = req.query;
    let query = `
      SELECT u.id, u.login_id, u.name, u.phone, u.role, u.branch_id, u.is_active, u.created_at,
             b.name as branch_name
      FROM users u
      JOIN branches b ON u.branch_id = b.id
    `;
    const params = [];

    if (branchId) {
      query += ' WHERE u.branch_id = ?';
      params.push(parseInt(branchId));
    }

    query += ' ORDER BY b.name, u.name';
    const users = db.prepare(query).all(...params);
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/users', (req, res) => {
  try {
    const db = global.db;
    const { loginId, password, name, phone, role, branchId } = req.body;

    if (!loginId || !password || !name || !branchId) {
      return res.status(400).json({ error: 'ID, 비밀번호, 이름, 소속지점은 필수입니다.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ?').get(parseInt(branchId));
    if (!branch) {
      return res.status(400).json({ error: '존재하지 않는 지점입니다.' });
    }

    // 중복 ID 확인
    const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(loginId);
    if (existing) {
      return res.status(400).json({ error: '이미 사용 중인 ID입니다.' });
    }

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 12);

    db.prepare(
      'INSERT INTO users (id, login_id, password_hash, name, phone, role, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, loginId, passwordHash, name, phone || '', role || 'staff', parseInt(branchId));

    res.json({
      message: '직원이 등록되었습니다.',
      user: { id: userId, loginId, name, role: role || 'staff', branchId }
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.put('/users/:id', (req, res) => {
  try {
    const db = global.db;
    const { name, phone, role, branchId, isActive, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });
    }

    const kstNow = getKSTNow();

    if (password) {
      const passwordHash = bcrypt.hashSync(password, 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, kstNow, req.params.id);
    }

    db.prepare(`
      UPDATE users SET
        name = ?, phone = ?, role = ?, branch_id = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name ?? user.name,
      phone ?? user.phone,
      role ?? user.role,
      branchId ?? user.branch_id,
      isActive ?? user.is_active,
      kstNow,
      req.params.id
    );

    res.json({ message: '직원 정보가 수정되었습니다.' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/users/:id - 직원 삭제
router.delete('/users/:id', (req, res) => {
  try {
    const db = global.db;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: '직원을 찾을 수 없습니다.' });
    }

    // 자기 자신은 삭제 불가
    if (user.id === req.user.id) {
      return res.status(400).json({ error: '자기 자신은 삭제할 수 없습니다.' });
    }

    // 출퇴근 기록이 있으면 기록도 함께 삭제
    db.prepare('DELETE FROM attendance WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    res.json({ message: `${user.name} 직원이 삭제되었습니다.` });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==================== 근무 현황 / 리포트 ====================

router.get('/attendance/daily', (req, res) => {
  try {
    const db = global.db;
    const { date, branchId } = req.query;
    const targetDate = date || getKSTDate();

    let query = `
      SELECT
        u.id as user_id, u.name, u.login_id,
        b.name as branch_name, b.id as branch_id,
        MIN(CASE WHEN a.check_type = 'in' THEN a.check_time END) as check_in_time,
        MAX(CASE WHEN a.check_type = 'out' THEN a.check_time END) as check_out_time,
        MIN(CASE WHEN a.check_type = 'in' THEN a.distance_meters END) as check_in_distance,
        MIN(CASE WHEN a.check_type = 'in' THEN a.branch_id END) as work_branch_id,
        MIN(CASE WHEN a.check_type = 'in' THEN wb.name END) as work_branch_name
      FROM users u
      JOIN branches b ON u.branch_id = b.id
      LEFT JOIN attendance a ON a.user_id = u.id AND date(a.check_time) = date(?)
      LEFT JOIN branches wb ON a.branch_id = wb.id
      WHERE u.is_active = 1
    `;
    const params = [targetDate];

    if (branchId) {
      query += ' AND u.branch_id = ?';
      params.push(parseInt(branchId));
    }

    query += ' GROUP BY u.id ORDER BY b.name, u.name';
    const records = db.prepare(query).all(...params);

    const result = records.map(r => {
      let workMinutes = 0;
      if (r.check_in_time && r.check_out_time) {
        workMinutes = Math.round((new Date(r.check_out_time) - new Date(r.check_in_time)) / 60000);
      }
      const isDispatch = r.work_branch_id && r.work_branch_id !== r.branch_id;
      return {
        ...r,
        workMinutes,
        workHours: workMinutes > 0 ? `${Math.floor(workMinutes / 60)}시간 ${workMinutes % 60}분` : '-',
        status: !r.check_in_time ? '미출근' : !r.check_out_time ? '근무중' : '퇴근',
        isDispatch,
        workBranchName: isDispatch ? r.work_branch_name : null
      };
    });

    res.json({ date: targetDate, records: result });
  } catch (err) {
    console.error('Daily attendance error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/attendance/monthly', (req, res) => {
  try {
    const db = global.db;
    const { year, month, branchId } = req.query;
    const y = parseInt(year) || getKSTYear();
    const m = parseInt(month) || getKSTMonth();

    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    let userFilter = '';
    const params = [startDate, endDate];

    if (branchId) {
      userFilter = 'AND u.branch_id = ?';
      params.push(parseInt(branchId));
    }

    const records = db.prepare(`
      SELECT
        u.id as user_id, u.name, u.login_id,
        b.name as branch_name,
        COUNT(DISTINCT date(a_in.check_time)) as work_days,
        SUM(
          CASE
            WHEN a_out.check_time IS NOT NULL
            THEN ROUND((julianday(a_out.check_time) - julianday(a_in.check_time)) * 24 * 60)
            ELSE 0
          END
        ) as total_minutes
      FROM users u
      JOIN branches b ON u.branch_id = b.id
      LEFT JOIN attendance a_in ON a_in.user_id = u.id
        AND a_in.check_type = 'in'
        AND a_in.check_time >= ? AND a_in.check_time < ?
      LEFT JOIN attendance a_out ON a_out.user_id = u.id
        AND a_out.check_type = 'out'
        AND date(a_out.check_time) = date(a_in.check_time)
      WHERE u.is_active = 1 ${userFilter}
      GROUP BY u.id
      ORDER BY b.name, u.name
    `).all(...params);

    const result = records.map(r => ({
      ...r,
      totalHours: r.total_minutes > 0
        ? `${Math.floor(r.total_minutes / 60)}시간 ${Math.round(r.total_minutes % 60)}분`
        : '0시간'
    }));

    res.json({ year: y, month: m, records: result });
  } catch (err) {
    console.error('Monthly attendance error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/attendance/export', (req, res) => {
  try {
    const db = global.db;
    const { year, month, branchId } = req.query;
    const y = parseInt(year) || getKSTYear();
    const m = parseInt(month) || getKSTMonth();

    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    let filter = '';
    const params = [startDate, endDate];
    if (branchId) {
      filter = 'AND u.branch_id = ?';
      params.push(parseInt(branchId));
    }

    const records = db.prepare(`
      SELECT
        date(a.check_time) as work_date,
        u.name, u.login_id,
        b.name as branch_name,
        MIN(CASE WHEN a.check_type = 'in' THEN time(a.check_time) END) as check_in,
        MAX(CASE WHEN a.check_type = 'out' THEN time(a.check_time) END) as check_out
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      JOIN branches b ON a.branch_id = b.id
      WHERE a.check_time >= ? AND a.check_time < ? ${filter}
      GROUP BY u.id, date(a.check_time)
      ORDER BY work_date, b.name, u.name
    `).all(...params);

    const BOM = '\uFEFF';
    let csv = BOM + '날짜,지점,이름,로그인ID,출근시간,퇴근시간\n';
    records.forEach(r => {
      csv += `${r.work_date},${r.branch_name},${r.name},${r.login_id},${r.check_in || '-'},${r.check_out || '-'}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${y}${String(m).padStart(2, '0')}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
