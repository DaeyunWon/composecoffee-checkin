const express = require('express');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { getKSTNow, getKSTDate, getKSTYear, getKSTMonth } = require('../utils/kst');

const router = express.Router();

// Haversine 공식으로 두 좌표 간 거리 계산 (미터 단위)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// POST /api/attendance/check - 출근 또는 퇴근 기록
// branchId를 보내면 해당 지점(QR 지점) 기준으로 GPS 검증 (파견 근무 지원)
router.post('/check', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { checkType, latitude, longitude, branchId } = req.body;

    if (!checkType || !['in', 'out'].includes(checkType)) {
      return res.status(400).json({ error: '출근(in) 또는 퇴근(out)을 지정해주세요.' });
    }

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: '위치 정보가 필요합니다. 위치 권한을 허용해주세요.' });
    }

    // QR 지점이 지정되면 해당 지점 기준, 아니면 소속 지점 기준
    const workBranchId = branchId ? parseInt(branchId) : req.user.branch_id;
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(workBranchId);
    if (!branch) {
      return res.status(400).json({ error: '지점 정보를 찾을 수 없습니다.' });
    }

    const distance = calculateDistance(latitude, longitude, branch.latitude, branch.longitude);
    const isValidLocation = distance <= branch.radius_meters;

    if (!isValidLocation) {
      return res.status(400).json({
        error: `현재 위치가 ${branch.name}으로부터 ${Math.round(distance)}m 떨어져 있습니다. 허용 반경(${branch.radius_meters}m) 내에서 시도해주세요.`,
        distance: Math.round(distance),
        allowedRadius: branch.radius_meters
      });
    }

    const today = getKSTDate();
    const existing = db.prepare(
      "SELECT * FROM attendance WHERE user_id = ? AND check_type = ? AND date(check_time) = ? ORDER BY check_time DESC LIMIT 1"
    ).get(req.user.id, checkType, today);

    if (checkType === 'in' && existing) {
      return res.status(400).json({
        error: '오늘 이미 출근 기록이 있습니다.',
        checkedAt: existing.check_time
      });
    }

    if (checkType === 'out') {
      const checkIn = db.prepare(
        "SELECT * FROM attendance WHERE user_id = ? AND check_type = 'in' AND date(check_time) = ? ORDER BY check_time DESC LIMIT 1"
      ).get(req.user.id, today);

      if (!checkIn) {
        return res.status(400).json({ error: '오늘 출근 기록이 없습니다. 먼저 출근을 해주세요.' });
      }
    }

    // KST 시간으로 명시적 저장
    const kstNow = getKSTNow();
    const result = db.prepare(
      'INSERT INTO attendance (user_id, branch_id, check_type, check_time, latitude, longitude, distance_meters, is_valid_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.user.id,
      workBranchId,
      checkType,
      kstNow,
      latitude,
      longitude,
      Math.round(distance),
      isValidLocation ? 1 : 0
    );

    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    const isDispatch = workBranchId !== req.user.branch_id;

    res.json({
      message: checkType === 'in'
        ? (isDispatch ? `${branch.name} 파견 출근이 기록되었습니다.` : '출근이 기록되었습니다.')
        : '퇴근이 기록되었습니다.',
      record: {
        id: record.id,
        checkType: record.check_type,
        checkTime: record.check_time,
        distance: Math.round(distance),
        branchName: branch.name,
        isDispatch
      }
    });
  } catch (err) {
    console.error('Attendance check error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/attendance/today - 오늘의 출퇴근 상태
router.get('/today', authenticate, (req, res) => {
  try {
    const db = global.db;
    const today = getKSTDate();

    const records = db.prepare(
      "SELECT a.*, b.name as branch_name FROM attendance a JOIN branches b ON a.branch_id = b.id WHERE a.user_id = ? AND date(a.check_time) = ? ORDER BY a.check_time ASC"
    ).all(req.user.id, today);

    const checkIn = records.find(r => r.check_type === 'in');
    const checkOut = records.filter(r => r.check_type === 'out').pop();

    // 근무 지점 정보 (파견 여부 확인용)
    const workBranchId = checkIn ? checkIn.branch_id : null;
    const isDispatch = workBranchId && workBranchId !== req.user.branch_id;
    const workBranchName = checkIn ? checkIn.branch_name : null;

    res.json({
      date: today,
      checkIn: checkIn ? { time: checkIn.check_time, distance: checkIn.distance_meters } : null,
      checkOut: checkOut ? { time: checkOut.check_time, distance: checkOut.distance_meters } : null,
      status: !checkIn ? 'not_checked_in' : !checkOut ? 'working' : 'done',
      workBranch: workBranchName,
      isDispatch: !!isDispatch
    });
  } catch (err) {
    console.error('Today status error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/attendance/my-history - 내 출퇴근 이력 (월별)
router.get('/my-history', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { year, month } = req.query;
    const y = parseInt(year) || getKSTYear();
    const m = parseInt(month) || getKSTMonth();

    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const records = db.prepare(`
      SELECT
        date(a.check_time) as work_date,
        MIN(CASE WHEN a.check_type = 'in' THEN a.check_time END) as check_in_time,
        MAX(CASE WHEN a.check_type = 'out' THEN a.check_time END) as check_out_time
      FROM attendance a
      WHERE a.user_id = ? AND a.check_time >= ? AND a.check_time < ?
      GROUP BY date(a.check_time)
      ORDER BY work_date ASC
    `).all(req.user.id, startDate, endDate);

    let totalMinutes = 0;
    const history = records.map(r => {
      let workMinutes = 0;
      if (r.check_in_time && r.check_out_time) {
        const inTime = new Date(r.check_in_time);
        const outTime = new Date(r.check_out_time);
        workMinutes = Math.round((outTime - inTime) / 60000);
        totalMinutes += workMinutes;
      }
      return {
        date: r.work_date,
        checkIn: r.check_in_time,
        checkOut: r.check_out_time,
        workMinutes,
        workHours: workMinutes > 0 ? `${Math.floor(workMinutes / 60)}시간 ${workMinutes % 60}분` : '-'
      };
    });

    res.json({
      year: y,
      month: m,
      totalDays: history.length,
      totalMinutes,
      totalHours: `${Math.floor(totalMinutes / 60)}시간 ${totalMinutes % 60}분`,
      history
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
