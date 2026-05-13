const express = require('express');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { getKSTNow, getKSTDate, getKSTYear, getKSTMonth } = require('../utils/kst');

const router = express.Router();

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) { return deg * (Math.PI / 180); }

const SCHEDULE_TOLERANCE_MIN = 30;

function timeToMinutes(hhmm) {
  const parts = hhmm.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// 하루 다중 일정 중 출퇴근에 가장 적합한 1건을 골라 검증
// 우선순위: 같은 지점 일정 우선 → 그 중 현재 시각과 가장 가까운 (start_time for 'in', end_time for 'out')
function checkSchedule(db, userId, workDate, currentTime, checkType, workBranchId) {
  const all = db.prepare('SELECT * FROM schedules WHERE user_id = ? AND work_date = ? ORDER BY start_time').all(userId, workDate);
  if (all.length === 0) {
    return { scheduled: false, warning: '오늘 등록된 근무 일정이 없습니다. 비계획 근무로 기록됩니다.', schedule: null };
  }

  const nowMin = timeToMinutes(currentTime);
  const targetKey = checkType === 'in' ? 'start_time' : 'end_time';

  // 1순위: 같은 지점이면서 시간 ±30분 안에 들어오는 일정
  // 2순위: 같은 지점 중 시간 차가 가장 작은 일정
  // 3순위: 다른 지점 중 시간 차가 가장 작은 일정
  const inSameBranch = workBranchId ? all.filter(s => s.branch_id === workBranchId) : [];
  const pickClosest = arr => arr
    .map(s => ({ s, diff: Math.abs(timeToMinutes(s[targetKey]) - nowMin) }))
    .sort((a, b) => a.diff - b.diff)[0];

  const sameBranchInWindow = inSameBranch.find(s => Math.abs(timeToMinutes(s[targetKey]) - nowMin) <= SCHEDULE_TOLERANCE_MIN);
  const schedule = sameBranchInWindow
    || (inSameBranch.length > 0 ? pickClosest(inSameBranch).s : null)
    || pickClosest(all).s;

  const startMin = timeToMinutes(schedule.start_time);
  const endMin = timeToMinutes(schedule.end_time);

  if (checkType === 'in') {
    const lower = startMin - SCHEDULE_TOLERANCE_MIN;
    const upper = startMin + SCHEDULE_TOLERANCE_MIN;
    if (nowMin < lower) return { scheduled: true, warning: '근무 시작(' + schedule.start_time + ')보다 ' + (lower - nowMin) + '분 이른 출근입니다.', schedule };
    if (nowMin > upper) return { scheduled: true, warning: '근무 시작(' + schedule.start_time + ')보다 ' + (nowMin - upper + SCHEDULE_TOLERANCE_MIN) + '분 이상 늦은 지각 출근입니다.', schedule };
    return { scheduled: true, warning: null, schedule };
  }
  const lower = endMin - SCHEDULE_TOLERANCE_MIN;
  const upper = endMin + SCHEDULE_TOLERANCE_MIN;
  if (nowMin < lower) return { scheduled: true, warning: '근무 종료(' + schedule.end_time + ')보다 ' + (lower - nowMin + SCHEDULE_TOLERANCE_MIN) + '분 이상 일찍 퇴근입니다.', schedule };
  if (nowMin > upper) return { scheduled: true, warning: '근무 종료(' + schedule.end_time + ')보다 ' + (nowMin - upper) + '분 늦은 연장 퇴근입니다.', schedule };
  return { scheduled: true, warning: null, schedule };
}

router.post('/check', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { checkType, latitude, longitude, branchId, userNote } = req.body;
    if (!checkType || !['in', 'out'].includes(checkType)) return res.status(400).json({ error: '출근(in) 또는 퇴근(out)을 지정해주세요.' });
    if (latitude == null || longitude == null) return res.status(400).json({ error: '위치 정보가 필요합니다. 위치 권한을 허용해주세요.' });
    const workBranchId = branchId ? parseInt(branchId) : req.user.branch_id;
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(workBranchId);
    if (!branch) return res.status(400).json({ error: '지점 정보를 찾을 수 없습니다.' });
    const distance = calculateDistance(latitude, longitude, branch.latitude, branch.longitude);
    const isValidLocation = distance <= branch.radius_meters;
    if (!isValidLocation) {
      return res.status(400).json({
        error: '현재 위치가 ' + branch.name + '으로부터 ' + Math.round(distance) + 'm 떨어져 있습니다. 허용 반경(' + branch.radius_meters + 'm) 내에서 시도해주세요.',
        distance: Math.round(distance),
        allowedRadius: branch.radius_meters
      });
    }
    const today = getKSTDate();
    const existing = db.prepare("SELECT * FROM attendance WHERE user_id = ? AND check_type = ? AND date(check_time) = ? ORDER BY check_time DESC LIMIT 1").get(req.user.id, checkType, today);
    if (checkType === 'in' && existing) return res.status(400).json({ error: '오늘 이미 출근 기록이 있습니다.', checkedAt: existing.check_time });
    if (checkType === 'out') {
      const checkIn = db.prepare("SELECT * FROM attendance WHERE user_id = ? AND check_type = 'in' AND date(check_time) = ? ORDER BY check_time DESC LIMIT 1").get(req.user.id, today);
      if (!checkIn) return res.status(400).json({ error: '오늘 출근 기록이 없습니다. 먼저 출근을 해주세요.' });
    }
    const kstNow = getKSTNow();
    const kstTimePart = kstNow.split(' ')[1];
    const scheduleCheck = checkSchedule(db, req.user.id, today, kstTimePart, checkType, workBranchId);

    // 퇴근일 때 근무표가 있고 ±30분 범위 밖이면 사유(userNote) 입력 필수
    const trimmedNote = userNote ? String(userNote).trim() : '';
    if (checkType === 'out' && scheduleCheck.schedule && scheduleCheck.warning && !trimmedNote) {
      return res.status(422).json({
        error: scheduleCheck.warning + ' 사유를 입력해주세요.',
        requireNote: true,
        warning: scheduleCheck.warning,
        schedule: { startTime: scheduleCheck.schedule.start_time, endTime: scheduleCheck.schedule.end_time }
      });
    }
    if (trimmedNote.length > 500) {
      return res.status(400).json({ error: '사유는 500자 이내로 입력해주세요.' });
    }

    let noteParts = [];
    if (!scheduleCheck.scheduled) noteParts.push('비계획 근무');
    if (scheduleCheck.warning) noteParts.push(scheduleCheck.warning);
    const note = noteParts.join(' / ');
    const result = db.prepare('INSERT INTO attendance (user_id, branch_id, check_type, check_time, latitude, longitude, distance_meters, is_valid_location, note, user_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, workBranchId, checkType, kstNow, latitude, longitude, Math.round(distance), isValidLocation ? 1 : 0, note || null, trimmedNote || null);
    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    const isDispatch = workBranchId !== req.user.branch_id;
    res.json({
      message: checkType === 'in' ? (isDispatch ? (branch.name + ' 파견 출근이 기록되었습니다.') : '출근이 기록되었습니다.') : '퇴근이 기록되었습니다.',
      record: { id: record.id, checkType: record.check_type, checkTime: record.check_time, distance: Math.round(distance), branchName: branch.name, isDispatch, userNote: record.user_note },
      schedule: scheduleCheck.schedule ? { startTime: scheduleCheck.schedule.start_time, endTime: scheduleCheck.schedule.end_time, note: scheduleCheck.schedule.note } : null,
      scheduled: scheduleCheck.scheduled,
      warning: scheduleCheck.warning
    });
  } catch (err) {
    console.error('Attendance check error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/today', authenticate, (req, res) => {
  try {
    const db = global.db;
    const today = getKSTDate();
    const records = db.prepare("SELECT a.*, b.name as branch_name FROM attendance a JOIN branches b ON a.branch_id = b.id WHERE a.user_id = ? AND date(a.check_time) = ? ORDER BY a.check_time ASC").all(req.user.id, today);
    const checkIn = records.find(r => r.check_type === 'in');
    const checkOut = records.filter(r => r.check_type === 'out').pop();
    const workBranchId = checkIn ? checkIn.branch_id : null;
    const isDispatch = workBranchId && workBranchId !== req.user.branch_id;
    const workBranchName = checkIn ? checkIn.branch_name : null;
    const todaySchedule = db.prepare('SELECT s.start_time, s.end_time, s.note, b.name as branch_name FROM schedules s JOIN branches b ON s.branch_id = b.id WHERE s.user_id = ? AND s.work_date = ?').get(req.user.id, today);
    res.json({
      date: today,
      checkIn: checkIn ? { time: checkIn.check_time, distance: checkIn.distance_meters, userNote: checkIn.user_note || null } : null,
      checkOut: checkOut ? { time: checkOut.check_time, distance: checkOut.distance_meters, userNote: checkOut.user_note || null } : null,
      status: !checkIn ? 'not_checked_in' : !checkOut ? 'working' : 'done',
      workBranch: workBranchName,
      isDispatch: !!isDispatch,
      schedule: todaySchedule ? { startTime: todaySchedule.start_time, endTime: todaySchedule.end_time, branchName: todaySchedule.branch_name, note: todaySchedule.note } : null
    });
  } catch (err) {
    console.error('Today status error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/my-history', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { year, month } = req.query;
    const y = parseInt(year) || getKSTYear();
    const m = parseInt(month) || getKSTMonth();
    const startDate = y + '-' + String(m).padStart(2, '0') + '-01';
    const endDate = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    const records = db.prepare(
      "SELECT date(a.check_time) as work_date, MIN(CASE WHEN a.check_type = 'in' THEN a.check_time END) as check_in_time, MAX(CASE WHEN a.check_type = 'out' THEN a.check_time END) as check_out_time, MAX(CASE WHEN a.check_type = 'out' THEN a.user_note END) as checkout_note, MIN(CASE WHEN a.check_type = 'in' THEN a.user_note END) as checkin_note FROM attendance a WHERE a.user_id = ? AND a.check_time >= ? AND a.check_time < ? GROUP BY date(a.check_time) ORDER BY work_date ASC"
    ).all(req.user.id, startDate, endDate);
    let totalMinutes = 0;
    const history = records.map(r => {
      let workMinutes = 0;
      if (r.check_in_time && r.check_out_time) {
        workMinutes = Math.round((new Date(r.check_out_time) - new Date(r.check_in_time)) / 60000);
        totalMinutes += workMinutes;
      }
      return {
        date: r.work_date,
        checkIn: r.check_in_time,
        checkOut: r.check_out_time,
        workMinutes,
        workHours: workMinutes > 0 ? (Math.floor(workMinutes / 60) + '시간 ' + (workMinutes % 60) + '분') : '-',
        checkInNote: r.checkin_note || null,
        checkOutNote: r.checkout_note || null
      };
    });
    res.json({ year: y, month: m, totalDays: history.length, totalMinutes, totalHours: Math.floor(totalMinutes / 60) + '시간 ' + (totalMinutes % 60) + '분', history });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.get('/my-schedule', authenticate, (req, res) => {
  try {
    const db = global.db;
    const { start, end, year, month } = req.query;
    let startDate, endDate;
    if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      startDate = start;
      endDate = end;
    } else {
      const y = parseInt(year) || getKSTYear();
      const m = parseInt(month) || getKSTMonth();
      startDate = y + '-' + String(m).padStart(2, '0') + '-01';
      endDate = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    }
    const schedules = db.prepare(
      'SELECT s.id, s.work_date, s.start_time, s.end_time, s.note, b.name as branch_name FROM schedules s JOIN branches b ON s.branch_id = b.id WHERE s.user_id = ? AND s.work_date >= ? AND s.work_date < ? ORDER BY s.work_date, s.start_time'
    ).all(req.user.id, startDate, endDate);
    res.json({ start: startDate, end: endDate, schedules });
  } catch (err) {
    console.error('My schedule error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
