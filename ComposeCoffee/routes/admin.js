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
        MIN(CASE WHEN a.check_type = 'in' THEN wb.name END) as work_branch_name,
        MIN(CASE WHEN a.check_type = 'in' THEN a.user_note END) as check_in_note,
        MAX(CASE WHEN a.check_type = 'out' THEN a.user_note END) as check_out_note,
        MAX(CASE WHEN a.check_type = 'out' THEN a.note END) as check_out_warning
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

// ==================== 근무표 관리 ====================

// GET /api/admin/schedules - 기간 내 근무 일정 조회
// query: start=YYYY-MM-DD, end=YYYY-MM-DD (end는 미포함), branchId, userId
router.get('/schedules', (req, res) => {
  try {
    const db = global.db;
    const { start, end, branchId, userId } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: 'start, end 파라미터가 필요합니다.' });
    }

    let query = `
      SELECT s.id, s.user_id, s.branch_id, s.work_date, s.start_time, s.end_time, s.note,
             s.created_at, s.updated_at,
             u.name as user_name, u.login_id,
             u.branch_id as user_home_branch_id,
             hb.name as user_home_branch_name,
             b.name as branch_name
      FROM schedules s
      JOIN users u ON s.user_id = u.id
      JOIN branches b ON s.branch_id = b.id
      JOIN branches hb ON u.branch_id = hb.id
      WHERE s.work_date >= ? AND s.work_date < ?
    `;
    const params = [start, end];

    if (branchId) {
      query += ' AND s.branch_id = ?';
      params.push(parseInt(branchId));
    }
    if (userId) {
      query += ' AND s.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY s.work_date, s.start_time, u.name';
    const schedules = db.prepare(query).all(...params);
    res.json({ schedules });
  } catch (err) {
    console.error('List schedules error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/admin/schedules - 근무 일정 등록
// 하루에 여러 일정 가능 (지점별/시간대별). branchId 미지정 시 직원 소속 지점으로 기본 설정.
router.post('/schedules', (req, res) => {
  try {
    const db = global.db;
    const { userId, workDate, startTime, endTime, note, branchId } = req.body;

    if (!userId || !workDate || !startTime || !endTime) {
      return res.status(400).json({ error: '직원, 날짜, 시작/종료 시간은 필수입니다.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return res.status(400).json({ error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return res.status(400).json({ error: '시간 형식이 올바르지 않습니다. (HH:MM)' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    }

    const user = db.prepare('SELECT id, branch_id, name FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (!user) {
      return res.status(400).json({ error: '존재하지 않거나 비활성 상태의 직원입니다.' });
    }

    // 근무지(branch_id) 결정 규칙
    //  - 요청 본문에 branchId가 명시적으로 전달되면 그 값을 사용 (NaN/0 등 잘못된 값은 에러)
    //  - branchId가 아예 없으면(undefined/null) → 직원 소속 지점으로 fallback
    let workBranchId;
    if (branchId !== undefined && branchId !== null && branchId !== '') {
      const parsed = parseInt(branchId);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: '근무 지점이 올바르지 않습니다.' });
      }
      workBranchId = parsed;
    } else {
      workBranchId = user.branch_id;
    }
    const targetBranch = db.prepare("SELECT id FROM branches WHERE id = ? AND name != '본사'").get(workBranchId);
    if (!targetBranch) {
      return res.status(400).json({ error: '유효하지 않은 근무 지점입니다. (본사는 근무 지점이 될 수 없음)' });
    }

    // 같은 직원·같은 날·같은 시작시각 중복 방지
    const dup = db.prepare(
      'SELECT id FROM schedules WHERE user_id = ? AND work_date = ? AND start_time = ?'
    ).get(userId, workDate, startTime);
    if (dup) {
      return res.status(400).json({ error: '같은 직원의 같은 날짜·같은 시작시각 일정이 이미 있습니다.' });
    }

    // 같은 날짜 다른 일정과 시간이 겹치는지 확인 (정보용 — 차단은 안 하고 경고만)
    const overlap = db.prepare(
      `SELECT id, start_time, end_time FROM schedules
       WHERE user_id = ? AND work_date = ?
         AND NOT (end_time <= ? OR start_time >= ?)`
    ).get(userId, workDate, startTime, endTime);

    const result = db.prepare(
      'INSERT INTO schedules (user_id, branch_id, work_date, start_time, end_time, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, workBranchId, workDate, startTime, endTime, note || '', req.user.id);

    const schedule = db.prepare(`
      SELECT s.*, u.name as user_name, b.name as branch_name
      FROM schedules s
      JOIN users u ON s.user_id = u.id
      JOIN branches b ON s.branch_id = b.id
      WHERE s.id = ?
    `).get(result.lastInsertRowid);

    const warning = overlap
      ? `같은 날짜의 다른 일정(${overlap.start_time}~${overlap.end_time})과 시간이 겹칩니다.`
      : null;

    res.json({ message: '근무 일정이 등록되었습니다.', schedule, warning });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '같은 직원의 같은 날짜·같은 시작시각 일정이 이미 있습니다.' });
    }
    console.error('Create schedule error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PUT /api/admin/schedules/:id - 근무 일정 수정
router.put('/schedules/:id', (req, res) => {
  try {
    const db = global.db;
    const id = parseInt(req.params.id);
    const { workDate, startTime, endTime, note, userId, branchId } = req.body;
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

    if (!schedule) {
      return res.status(404).json({ error: '근무 일정을 찾을 수 없습니다.' });
    }

    const newDate = workDate ?? schedule.work_date;
    const newStart = startTime ?? schedule.start_time;
    const newEnd = endTime ?? schedule.end_time;
    const newUserId = userId ?? schedule.user_id;

    // branchId 명시 시 검증, 아니면 기존 schedule.branch_id 유지
    let newBranchId = schedule.branch_id;
    if (branchId !== undefined && branchId !== null && branchId !== '') {
      const parsed = parseInt(branchId);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: '근무 지점이 올바르지 않습니다.' });
      }
      newBranchId = parsed;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      return res.status(400).json({ error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' });
    }
    if (!/^\d{2}:\d{2}$/.test(newStart) || !/^\d{2}:\d{2}$/.test(newEnd)) {
      return res.status(400).json({ error: '시간 형식이 올바르지 않습니다. (HH:MM)' });
    }
    if (newStart >= newEnd) {
      return res.status(400).json({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    }

    // 직원/날짜/시작시각 변경 시 중복 확인 (UNIQUE는 user_id+work_date+start_time)
    if (newUserId !== schedule.user_id || newDate !== schedule.work_date || newStart !== schedule.start_time) {
      const dup = db.prepare(
        'SELECT id FROM schedules WHERE user_id = ? AND work_date = ? AND start_time = ? AND id != ?'
      ).get(newUserId, newDate, newStart, id);
      if (dup) {
        return res.status(400).json({ error: '같은 직원의 같은 날짜·같은 시작시각 일정이 이미 있습니다.' });
      }
    }

    // 직원 변경 시 branch_id가 요청에 없으면 해당 직원의 소속 지점으로
    if (newUserId !== schedule.user_id && branchId == null) {
      const user = db.prepare('SELECT branch_id FROM users WHERE id = ?').get(newUserId);
      if (!user) return res.status(400).json({ error: '존재하지 않는 직원입니다.' });
      newBranchId = user.branch_id;
    }

    // branch 유효성 검사
    const targetBranch = db.prepare("SELECT id FROM branches WHERE id = ? AND name != '본사'").get(newBranchId);
    if (!targetBranch) {
      return res.status(400).json({ error: '유효하지 않은 근무 지점입니다.' });
    }
    const branchIdToUse = newBranchId;

    const kstNow = getKSTNow();
    db.prepare(`
      UPDATE schedules
      SET user_id = ?, branch_id = ?, work_date = ?, start_time = ?, end_time = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(newUserId, branchIdToUse, newDate, newStart, newEnd, note ?? schedule.note, kstNow, id);

    const updated = db.prepare(`
      SELECT s.*, u.name as user_name, b.name as branch_name
      FROM schedules s
      JOIN users u ON s.user_id = u.id
      JOIN branches b ON s.branch_id = b.id
      WHERE s.id = ?
    `).get(id);

    res.json({ message: '근무 일정이 수정되었습니다.', schedule: updated });
  } catch (err) {
    console.error('Update schedule error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/schedules/:id - 근무 일정 삭제
router.delete('/schedules/:id', (req, res) => {
  try {
    const db = global.db;
    const id = parseInt(req.params.id);
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (!schedule) {
      return res.status(404).json({ error: '근무 일정을 찾을 수 없습니다.' });
    }

    db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    res.json({ message: '근무 일정이 삭제되었습니다.' });
  } catch (err) {
    console.error('Delete schedule error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ==================== 근무 현황 / 리포트 (export) ====================

router.get('/attendance/export', async (req, res) => {
  // 월별 근무 리포트 XLSX 출력 — 지점별 시트, 요약 + 상세 일지 (회계/급여용)
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (e) {
    return res.status(500).json({ error: 'exceljs 모듈이 설치되어 있지 않습니다. 서버 폴더에서 `npm install` 후 다시 시도해주세요.' });
  }

  try {
    const db = global.db;
    const { year, month, branchId } = req.query;
    const y = parseInt(year) || getKSTYear();
    const m = parseInt(month) || getKSTMonth();

    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // 본사 제외 + 지점 필터
    let branchQuery = "SELECT id, name FROM branches WHERE name != '본사'";
    const bparams = [];
    if (branchId) {
      branchQuery += ' AND id = ?';
      bparams.push(parseInt(branchId));
    }
    branchQuery += ' ORDER BY name';
    const branchList = db.prepare(branchQuery).all(...bparams);

    if (branchList.length === 0) {
      return res.status(400).json({ error: '내보낼 지점이 없습니다.' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ComposeCoffee';
    workbook.created = new Date();

    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5D4037' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
    const thinBorder = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };

    for (const branch of branchList) {
      const users = db.prepare(
        'SELECT id, name, login_id, phone FROM users WHERE branch_id = ? ORDER BY name'
      ).all(branch.id);

      if (users.length === 0) continue;

      const records = db.prepare(`
        SELECT u.id as user_id, u.name as user_name, u.login_id,
               date(a.check_time) as work_date,
               MIN(CASE WHEN a.check_type = 'in' THEN time(a.check_time) END) as check_in_time,
               MAX(CASE WHEN a.check_type = 'out' THEN time(a.check_time) END) as check_out_time,
               MAX(CASE WHEN a.check_type = 'out' THEN a.note END) as out_note,
               MAX(CASE WHEN a.check_type = 'out' THEN a.user_note END) as user_note,
               MIN(CASE WHEN a.check_type = 'in' THEN wb.name END) as work_branch_name
        FROM users u
        JOIN attendance a ON a.user_id = u.id
        LEFT JOIN branches wb ON a.branch_id = wb.id
        WHERE u.branch_id = ?
          AND a.check_time >= ? AND a.check_time < ?
        GROUP BY u.id, date(a.check_time)
        ORDER BY u.name, work_date
      `).all(branch.id, startDate, endDate);

      const sheetName = branch.name.replace(/[\\/?*\[\]:]/g, '').substring(0, 31);
      const ws = workbook.addWorksheet(sheetName);

      // 타이틀
      ws.mergeCells('A1:G1');
      const title = ws.getCell('A1');
      title.value = `${y}년 ${m}월  ${branch.name} 근무 리포트`;
      title.font = { size: 14, bold: true };
      title.alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getRow(1).height = 24;

      // 직원별 요약
      ws.getCell('A3').value = '■ 직원별 근무 시간 요약';
      ws.getCell('A3').font = { bold: true, size: 12 };
      const summaryHeaders = ['이름', '로그인ID', '연락처', '출근일수', '총 근무시간', '총 분'];
      summaryHeaders.forEach((h, i) => {
        const cell = ws.getCell(4, i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = headerFill;
        cell.alignment = { horizontal: 'center' };
        cell.border = thinBorder;
      });

      const userTotals = {};
      users.forEach(u => {
        userTotals[u.id] = { name: u.name, login_id: u.login_id, phone: u.phone || '', days: 0, minutes: 0 };
      });
      records.forEach(r => {
        if (!userTotals[r.user_id]) return;
        if (r.check_in_time && r.check_out_time) {
          userTotals[r.user_id].days++;
          const [ih, im] = r.check_in_time.split(':').map(Number);
          const [oh, om] = r.check_out_time.split(':').map(Number);
          userTotals[r.user_id].minutes += (oh * 60 + om) - (ih * 60 + im);
        }
      });

      let row = 5;
      users.forEach(u => {
        const t = userTotals[u.id];
        const h = Math.floor(t.minutes / 60);
        const mm = t.minutes % 60;
        ws.getCell(row, 1).value = t.name;
        ws.getCell(row, 2).value = t.login_id;
        ws.getCell(row, 3).value = t.phone;
        ws.getCell(row, 4).value = t.days;
        ws.getCell(row, 5).value = t.minutes > 0 ? (h + '시간 ' + mm + '분') : '-';
        ws.getCell(row, 6).value = t.minutes;
        for (let c = 1; c <= 6; c++) ws.getCell(row, c).border = thinBorder;
        ws.getCell(row, 4).alignment = { horizontal: 'right' };
        ws.getCell(row, 5).alignment = { horizontal: 'right' };
        ws.getCell(row, 6).alignment = { horizontal: 'right' };
        row++;
      });

      // 상세 일지
      row += 2;
      ws.getCell(row, 1).value = '■ 상세 출퇴근 일지';
      ws.getCell(row, 1).font = { bold: true, size: 12 };
      row++;

      const detailHeaders = ['이름', '날짜', '요일', '출근', '퇴근', '근무시간', '비고'];
      detailHeaders.forEach((h, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = headerFill;
        cell.alignment = { horizontal: 'center' };
        cell.border = thinBorder;
      });
      row++;

      records.forEach(r => {
        const [yy, mo, dd] = r.work_date.split('-').map(Number);
        const dow = new Date(yy, mo - 1, dd).getDay();
        const isDispatch = r.work_branch_name && r.work_branch_name !== branch.name;
        let workTime = '-';
        if (r.check_in_time && r.check_out_time) {
          const [ih, im] = r.check_in_time.split(':').map(Number);
          const [oh, om] = r.check_out_time.split(':').map(Number);
          const mins = (oh * 60 + om) - (ih * 60 + im);
          workTime = Math.floor(mins / 60) + '시간 ' + (mins % 60) + '분';
        }
        const notes = [];
        if (isDispatch) notes.push('파견(' + r.work_branch_name + ')');
        if (r.out_note) notes.push(r.out_note);
        if (r.user_note) notes.push('[사유] ' + r.user_note);

        ws.getCell(row, 1).value = r.user_name;
        ws.getCell(row, 2).value = r.work_date;
        ws.getCell(row, 3).value = days[dow];
        ws.getCell(row, 4).value = r.check_in_time ? r.check_in_time.substring(0, 5) : '-';
        ws.getCell(row, 5).value = r.check_out_time ? r.check_out_time.substring(0, 5) : '-';
        ws.getCell(row, 6).value = workTime;
        ws.getCell(row, 7).value = notes.join(' / ');

        for (let c = 1; c <= 7; c++) ws.getCell(row, c).border = thinBorder;
        if (dow === 0) ws.getCell(row, 3).font = { color: { argb: 'FFC62828' }, bold: true };
        if (dow === 6) ws.getCell(row, 3).font = { color: { argb: 'FF1565C0' }, bold: true };
        row++;
      });

      ws.getColumn(1).width = 14;
      ws.getColumn(2).width = 14;
      ws.getColumn(3).width = 14;
      ws.getColumn(4).width = 12;
      ws.getColumn(5).width = 16;
      ws.getColumn(6).width = 14;
      ws.getColumn(7).width = 40;
    }

    if (workbook.worksheets.length === 0) {
      return res.status(400).json({ error: '해당 기간 내보낼 데이터가 없습니다.' });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_' + y + String(m).padStart(2, '0') + '.xlsx"');
    res.end(Buffer.from(buffer));
    return; /* legacy CSV 코드는 더 이상 사용되지 않음 (아래는 무시) */ /*

    const BOM = '\uFEFF';
    let csv = BOM + '날짜,지점,이름,로그인ID,출근시간,퇴근시간\n';
    records.forEach(r => {
      csv += `${r.work_date},${r.branch_name},${r.name},${r.login_id},${r.check_in || '-'},${r.check_out || '-'}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${y}${String(m).padStart(2, '0')}.csv`);
    res.send(csv);
    */
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
