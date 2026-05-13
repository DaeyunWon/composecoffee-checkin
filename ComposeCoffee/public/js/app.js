// ComposeCoffee 출퇴근 앱 - 직원용 클라이언트
(function() {
  'use strict';

  const API = '/api';
  let token = localStorage.getItem('cc_token');
  let currentUser = null;
  let currentPosition = null;
  let watchId = null;
  const urlParams = new URLSearchParams(window.location.search);
  let qrBranchId = urlParams.get('branch');
  let stayOnStaff = urlParams.get('stay') === '1'; // 관리자가 의도적으로 출퇴근 화면을 보러 온 경우
  let workBranch = null; // QR 지점 정보 (파견 근무 시 사용)

  // ==================== 유틸 ====================
  function $(sel) { return document.querySelector(sel); }

  async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API + url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || '요청 실패');
      // 서버 응답의 추가 필드(예: requireNote, warning 등)를 에러 객체에 보존
      Object.assign(err, data);
      throw err;
    }
    return data;
  }

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 서버에서 KST 문자열("2026-04-24 09:30:00")이 오므로 그대로 파싱
  function parseKST(datetime) {
    if (!datetime) return null;
    // "YYYY-MM-DD HH:MM:SS" → Date 객체 (로컬 시간으로 해석)
    return new Date(datetime.replace(' ', 'T'));
  }

  function formatTime(datetime) {
    if (!datetime) return '--:--';
    // KST 문자열에서 시:분만 추출
    const timePart = datetime.includes(' ') ? datetime.split(' ')[1] : datetime.split('T')[1];
    if (timePart) return timePart.substring(0, 5);
    return '--:--';
  }

  function formatDate(dateStr) {
    // "YYYY-MM-DD" 형식
    const parts = dateStr.split('-');
    const y = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const d = parseInt(parts[2]);
    const dt = new Date(y, m - 1, d);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${m}/${d} (${days[dt.getDay()]})`;
  }

  // GPS 검증에 사용할 지점 반환 (QR 지점 > 소속 지점)
  function getTargetBranch() {
    return workBranch || (currentUser && currentUser.branch);
  }

  // ==================== 화면 전환 ====================
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(`#${screenId}`).classList.add('active');
  }

  // ==================== 시간 표시 ====================
  function updateClock() {
    const now = new Date();
    const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    $('#current-date').textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}`;
    $('#current-time').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  // ==================== 위치 관리 ====================
  function startLocationWatch() {
    const locStatus = $('#location-status');
    const locText = $('#location-text');

    if (!navigator.geolocation) {
      locStatus.className = 'location-status invalid';
      locText.textContent = '이 브라우저는 위치 서비스를 지원하지 않습니다.';
      return;
    }

    locStatus.className = 'location-status checking';
    locText.textContent = '위치 확인 중...';

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        currentPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };

        const branch = getTargetBranch();
        if (branch) {
          const dist = calculateDistance(
            currentPosition.latitude, currentPosition.longitude,
            branch.latitude, branch.longitude
          );

          const label = workBranch ? `${workBranch.name} (파견)` : branch.name;

          if (dist <= branch.radius_meters) {
            locStatus.className = 'location-status valid';
            locText.textContent = `${label}에서 ${Math.round(dist)}m 이내 (정확도: ±${Math.round(pos.coords.accuracy)}m)`;
            updateButtons(true);
          } else {
            locStatus.className = 'location-status invalid';
            locText.textContent = `${label}에서 ${Math.round(dist)}m 떨어져 있습니다 (허용: ${branch.radius_meters}m)`;
            updateButtons(false);
          }
        }
      },
      (err) => {
        locStatus.className = 'location-status invalid';
        switch (err.code) {
          case 1:
            locText.textContent = '위치 권한이 거부되었습니다. 설정에서 허용해주세요.';
            break;
          case 2:
            locText.textContent = '위치 정보를 사용할 수 없습니다.';
            break;
          case 3:
            locText.textContent = '위치 정보 요청 시간이 초과되었습니다.';
            break;
        }
        updateButtons(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000
      }
    );
  }

  function stopLocationWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ==================== 출퇴근 상태 ====================
  let todayStatus = null;

  async function loadTodayStatus() {
    try {
      const data = await apiFetch('/attendance/today');
      todayStatus = data;

      $('#checkin-time').textContent = data.checkIn ? formatTime(data.checkIn.time) : '--:--';
      $('#checkout-time').textContent = data.checkOut ? formatTime(data.checkOut.time) : '--:--';

      // 파견 근무 표시
      const dispatchEl = $('#dispatch-info');
      if (dispatchEl) {
        if (data.isDispatch && data.workBranch) {
          dispatchEl.textContent = `📌 파견 근무: ${data.workBranch}`;
          dispatchEl.style.display = 'block';
        } else {
          dispatchEl.style.display = 'none';
        }
      }

      // 본인이 작성한 퇴근 사유 표시 (read-only)
      const myNoteEl = $('#my-checkout-note');
      const myNoteText = $('#my-checkout-note-text');
      if (myNoteEl && myNoteText) {
        if (data.checkOut && data.checkOut.userNote) {
          myNoteText.textContent = data.checkOut.userNote;
          myNoteEl.style.display = 'block';
        } else {
          myNoteEl.style.display = 'none';
        }
      }

      // 오늘의 근무 일정 표시
      const schEl = $('#schedule-info');
      const schText = $('#schedule-info-text');
      if (schEl && schText) {
        if (data.schedule) {
          schEl.classList.remove('warn');
          schText.innerHTML = `오늘 근무 일정: <span class="si-time">${data.schedule.startTime} ~ ${data.schedule.endTime}</span>` +
            (data.schedule.note ? `<br><span style="font-size:12px;color:var(--text-light);">${data.schedule.note}</span>` : '');
          schEl.style.display = 'flex';
        } else {
          schEl.classList.add('warn');
          schText.innerHTML = `⚠️ 오늘 등록된 근무 일정이 없습니다. 출퇴근은 가능하나 '비계획 근무'로 기록됩니다.`;
          schEl.style.display = 'flex';
        }
      }

      if (data.checkIn && data.checkOut) {
        const inTime = parseKST(data.checkIn.time);
        const outTime = parseKST(data.checkOut.time);
        const mins = Math.round((outTime - inTime) / 60000);
        $('#work-duration').textContent = `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
      } else if (data.checkIn) {
        const inTime = parseKST(data.checkIn.time);
        const now = new Date();
        const mins = Math.round((now - inTime) / 60000);
        $('#work-duration').textContent = `${Math.floor(mins / 60)}시간 ${mins % 60}분 (근무중)`;
      } else {
        $('#work-duration').textContent = '-';
      }

      // 버튼 상태 업데이트
      if (currentPosition) {
        const branch = getTargetBranch();
        if (branch) {
          const dist = calculateDistance(
            currentPosition.latitude, currentPosition.longitude,
            branch.latitude, branch.longitude
          );
          updateButtons(dist <= branch.radius_meters);
        }
      }
    } catch (err) {
      console.error('Failed to load today status:', err);
    }
  }

  function updateButtons(locationValid) {
    const btnIn = $('#btn-checkin');
    const btnOut = $('#btn-checkout');

    if (!todayStatus) {
      btnIn.disabled = !locationValid;
      btnOut.disabled = true;
      return;
    }

    switch (todayStatus.status) {
      case 'not_checked_in':
        btnIn.disabled = !locationValid;
        btnOut.disabled = true;
        break;
      case 'working':
        btnIn.disabled = true;
        btnOut.disabled = !locationValid;
        break;
      case 'done':
        btnIn.disabled = true;
        btnOut.disabled = true;
        break;
    }
  }

  async function loadMonthlyHistory() {
    try {
      const now = new Date();
      const data = await apiFetch(`/attendance/my-history?year=${now.getFullYear()}&month=${now.getMonth() + 1}`);

      // 요약
      $('#history-summary').innerHTML = `
        <div class="summary-item">
          <span class="label">출근일수</span>
          <span class="value">${data.totalDays}일</span>
        </div>
        <div class="summary-item">
          <span class="label">총 근무시간</span>
          <span class="value">${data.totalHours}</span>
        </div>
      `;

      // 이력 목록 (최근 순)
      const list = $('#history-list');
      list.innerHTML = data.history.reverse().map(h => {
        const noteHtml = h.checkOutNote
          ? `<div class="history-note">📝 ${escapeHtml(h.checkOutNote)}</div>`
          : '';
        return `
        <div class="history-item">
          <div style="flex:1;">
            <div class="history-date">${formatDate(h.date)}</div>
            <div class="history-times">${formatTime(h.checkIn)} ~ ${formatTime(h.checkOut)}</div>
            ${noteHtml}
          </div>
          <div class="history-hours">${h.workHours}</div>
        </div>`;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // ==================== 로그인/로그아웃 ====================
  async function handleLogin(e) {
    e.preventDefault();
    const loginId = $('#login-id').value.trim();
    const password = $('#login-pw').value;
    const errorEl = $('#login-error');

    if (!loginId || !password) {
      errorEl.textContent = 'ID와 비밀번호를 입력해주세요.';
      errorEl.classList.remove('hidden');
      return;
    }

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ loginId, password })
      });

      token = data.token;
      localStorage.setItem('cc_token', token);
      // 관리자인 경우 admin 페이지도 같은 토큰으로 자동 로그인되도록 동시 저장
      if (data.user.role === 'admin') {
        localStorage.setItem('cc_admin_token', token);
      }
      currentUser = data.user;
      errorEl.classList.add('hidden');

      // QR 지점이 소속 지점과 다르면 파견 근무 모드
      await setupWorkBranch();

      initCheckinScreen();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }

  // QR 지점 정보를 로드하고, 소속과 다르면 파견 모드 설정
  async function setupWorkBranch() {
    workBranch = null;
    if (qrBranchId && currentUser && parseInt(qrBranchId) !== currentUser.branch.id) {
      try {
        const branch = await fetch(`${API}/branch/${qrBranchId}/info`).then(r => r.json());
        if (branch && branch.id) {
          workBranch = branch;
          showToast(`📌 ${branch.name} 파견 근무 모드`, 'info');
        }
      } catch (e) {
        console.error('Failed to load QR branch info:', e);
      }
    }
  }

  function handleLogout() {
    token = null;
    currentUser = null;
    currentPosition = null;
    todayStatus = null;
    workBranch = null;
    // 두 토큰 모두 제거 (이전 관리자 세션 잔존 방지)
    localStorage.removeItem('cc_token');
    localStorage.removeItem('cc_admin_token');
    // 관리자 링크 숨김
    const adminLink = $('#admin-link');
    if (adminLink) adminLink.style.display = 'none';
    stopLocationWatch();
    showScreen('login-screen');
  }

  async function initCheckinScreen() {
    // 관리자(본사 소속)이고 QR 접속/명시적 stay가 아니면 관리 페이지로 이동
    if (!stayOnStaff && currentUser.role === 'admin' && currentUser.branch.name === '본사' && !qrBranchId) {
      // 관리자 페이지에서도 같은 토큰으로 자동 로그인되도록
      localStorage.setItem('cc_admin_token', token);
      window.location.href = '/admin.html';
      return;
    }

    // 관리자 페이지 링크: 현재 사용자가 admin일 때만 노출 (HTML에 미리 존재, 표시만 토글)
    const adminLink = $('#admin-link');
    if (adminLink) {
      adminLink.style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
    }

    // 마이페이지 버튼: 관리자는 관리자 페이지에서 일괄 수정하므로 숨김
    const mypageBtn = $('#btn-mypage');
    if (mypageBtn) {
      mypageBtn.style.display = currentUser.role === 'admin' ? 'none' : 'inline-block';
    }

    $('#user-name').textContent = currentUser.name;

    // 환영 메시지: 헤더와 시계 사이에 사용자 이름 표시
    const greetingName = $('#greeting-name');
    const greetingRoleTag = $('#greeting-role-tag');
    if (greetingName) greetingName.textContent = currentUser.name;
    if (greetingRoleTag) {
      if (currentUser.role === 'admin') {
        greetingRoleTag.textContent = '관리자';
        greetingRoleTag.style.display = 'inline-block';
      } else {
        greetingRoleTag.style.display = 'none';
      }
    }

    // 파견 근무 시 지점 표시 변경
    if (workBranch) {
      $('#branch-name').textContent = `${workBranch.name} (파견)`;
      $('#branch-name').style.color = '#FF8F00';
    } else {
      $('#branch-name').textContent = currentUser.branch.name;
      $('#branch-name').style.color = '';
    }

    showScreen('checkin-screen');
    updateClock();
    setInterval(updateClock, 1000);

    await loadTodayStatus();
    loadMonthlyHistory();
    startLocationWatch();

    // 근무중이면 1분마다 근무시간 업데이트
    setInterval(() => {
      if (todayStatus && todayStatus.status === 'working') {
        loadTodayStatus();
      }
    }, 60000);
  }

  // ==================== 출퇴근 처리 ====================
  // 퇴근 시각이 일정의 ±30분 범위 밖인지 클라이언트에서 미리 판정
  function isOutOfCheckoutWindow(schedule) {
    if (!schedule || !schedule.endTime) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [eh, em] = schedule.endTime.split(':').map(Number);
    const endMin = eh * 60 + em;
    if (nowMin < endMin - 30) {
      return `근무 종료(${schedule.endTime})보다 약 ${endMin - nowMin}분 일찍 퇴근하시려고 합니다.`;
    }
    if (nowMin > endMin + 30) {
      return `근무 종료(${schedule.endTime})보다 약 ${nowMin - endMin}분 늦게 퇴근하시려고 합니다.`;
    }
    return null;
  }

  // 사유 입력 모달 - Promise 반환 (resolve(note) | resolve(null) when cancelled)
  function promptCheckoutNote(warning) {
    return new Promise(resolve => {
      const modal = $('#modal-checkout-note');
      $('#checkout-note-warning').textContent = '⚠️ ' + warning;
      $('#checkout-note-text').value = '';

      const cleanup = () => {
        modal.classList.remove('active');
        $('#btn-confirm-checkout-note').onclick = null;
        $('#btn-cancel-checkout-note').onclick = null;
      };

      $('#btn-confirm-checkout-note').onclick = () => {
        const note = $('#checkout-note-text').value.trim();
        if (!note) {
          showToast('사유를 입력해주세요.', 'error');
          $('#checkout-note-text').focus();
          return;
        }
        cleanup();
        resolve(note);
      };
      $('#btn-cancel-checkout-note').onclick = () => {
        cleanup();
        resolve(null);
      };

      modal.classList.add('active');
      setTimeout(() => $('#checkout-note-text').focus(), 100);
    });
  }

  async function submitCheck(body, btn, originalText) {
    try {
      const data = await apiFetch('/attendance/check', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      showToast(data.message, 'success');
      if (data.warning) {
        setTimeout(() => showToast('⚠️ ' + data.warning, 'info'), 700);
      } else if (data.scheduled === false) {
        setTimeout(() => showToast('⚠️ 등록된 근무 일정이 없어 비계획 근무로 기록되었습니다.', 'info'), 700);
      }
      await loadTodayStatus();
      loadMonthlyHistory();
      return { ok: true };
    } catch (err) {
      // 422 requireNote 처리 (서버에서 사유 입력 요구)
      if (err.requireNote || (err.message && err.message.includes('사유를 입력해주세요'))) {
        return { ok: false, requireNote: true, warning: err.warning || err.message };
      }
      showToast(err.message, 'error');
      btn.innerHTML = originalText;
      btn.disabled = false;
      return { ok: false };
    }
  }

  async function handleCheck(checkType) {
    if (!currentPosition) {
      showToast('위치 정보를 확인 중입니다. 잠시 후 다시 시도해주세요.', 'error');
      return;
    }

    const btn = checkType === 'in' ? $('#btn-checkin') : $('#btn-checkout');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 처리중...';

    const body = {
      checkType,
      latitude: currentPosition.latitude,
      longitude: currentPosition.longitude
    };
    if (workBranch) body.branchId = workBranch.id;

    // 퇴근일 때 사전 검증: 근무표 ±30분 범위 밖이면 모달로 사유 받기
    if (checkType === 'out' && todayStatus && todayStatus.schedule) {
      const warningMsg = isOutOfCheckoutWindow(todayStatus.schedule);
      if (warningMsg) {
        // 버튼은 다시 활성화 (모달 사용자 입력 대기)
        btn.innerHTML = originalText;
        btn.disabled = false;
        const note = await promptCheckoutNote(warningMsg);
        if (!note) return; // 취소
        body.userNote = note;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 처리중...';
      }
    }

    const result = await submitCheck(body, btn, originalText);

    // 서버가 사유 요구하면(클라가 놓친 경우) 한 번 더 모달로 받아 재시도
    if (!result.ok && result.requireNote) {
      btn.innerHTML = originalText;
      btn.disabled = false;
      const note = await promptCheckoutNote(result.warning || '시간 외 퇴근입니다. 사유를 입력해주세요.');
      if (!note) return;
      body.userNote = note;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 처리중...';
      await submitCheck(body, btn, originalText);
    }
  }

  // ==================== 마이페이지 ====================
  function openMypage() {
    $('#my-name').textContent = currentUser.name;
    $('#my-branch').textContent = currentUser.branch.name;
    $('#my-role').textContent = currentUser.role === 'admin' ? '관리자' : '직원';
    $('#my-phone').value = currentUser.phone || '';
    $('#form-change-pw').reset();
    $('#pw-error').classList.add('hidden');
    $('#profile-error').classList.add('hidden');
    showScreen('mypage-screen');
  }

  async function handleUpdateProfile(e) {
    e.preventDefault();
    const errEl = $('#profile-error');
    const phone = $('#my-phone').value.trim();
    try {
      const data = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ phone })
      });
      currentUser.phone = data.phone;
      errEl.classList.add('hidden');
      showToast('전화번호가 저장되었습니다.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  function closeMypage() {
    showScreen('checkin-screen');
  }

  // ==================== 내 근무표 (캘린더) ====================
  let myCalCursor = new Date();
  let myCalView = 'day'; // 기본값: 일별 ('month' | 'week' | 'day')
  let myCalSchedules = [];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function startOfWeek(d) {
    const r = new Date(d); r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

  function myCalRange() {
    if (myCalView === 'month') {
      const first = new Date(myCalCursor.getFullYear(), myCalCursor.getMonth(), 1);
      const s = startOfWeek(first);
      return { start: s, end: addDays(s, 42) };
    }
    if (myCalView === 'week') {
      const s = startOfWeek(myCalCursor);
      return { start: s, end: addDays(s, 7) };
    }
    const s = new Date(myCalCursor); s.setHours(0, 0, 0, 0);
    return { start: s, end: addDays(s, 1) };
  }

  function myCalTitle() {
    if (myCalView === 'month') {
      return `${myCalCursor.getFullYear()}년 ${myCalCursor.getMonth() + 1}월`;
    }
    if (myCalView === 'week') {
      const s = startOfWeek(myCalCursor);
      const e = addDays(s, 6);
      return `${s.getFullYear()}.${pad2(s.getMonth() + 1)}.${pad2(s.getDate())} ~ ${e.getFullYear()}.${pad2(e.getMonth() + 1)}.${pad2(e.getDate())}`;
    }
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${myCalCursor.getFullYear()}년 ${myCalCursor.getMonth() + 1}월 ${myCalCursor.getDate()}일 (${days[myCalCursor.getDay()]})`;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  async function openMySchedule() {
    showScreen('schedule-screen');
    myCalCursor = new Date();
    myCalView = 'day';
    document.querySelectorAll('[data-myview]').forEach(b => {
      b.classList.toggle('active', b.dataset.myview === 'day');
    });
    await reloadMySchedule();
    renderMyCalendar();
  }

  async function reloadMySchedule() {
    const { start, end } = myCalRange();
    try {
      const data = await apiFetch(`/attendance/my-schedule?start=${ymd(start)}&end=${ymd(end)}`);
      myCalSchedules = data.schedules || [];
    } catch (err) {
      showToast(err.message, 'error');
      myCalSchedules = [];
    }
  }

  function schedulesOn(dateStr) {
    return myCalSchedules.filter(s => s.work_date === dateStr);
  }

  function renderMyCalendar() {
    $('#myschd-title').textContent = myCalTitle();
    document.querySelectorAll('[data-myview]').forEach(b => {
      b.classList.toggle('active', b.dataset.myview === myCalView);
    });
    const root = $('#myschd-calendar');
    if (myCalView === 'month') root.innerHTML = renderMyMonth();
    else if (myCalView === 'week') root.innerHTML = renderMyWeek();
    else root.innerHTML = renderMyDay();
  }

  function renderMyMonth() {
    const { start } = myCalRange();
    const headDays = ['일', '월', '화', '수', '목', '금', '토'];
    let html = '<div class="cal-month">';
    headDays.forEach((d, i) => {
      const cls = i === 0 ? 'sun' : (i === 6 ? 'sat' : '');
      html += `<div class="cal-head ${cls}">${d}</div>`;
    });
    const todayStr = ymd(new Date());
    const curMonth = myCalCursor.getMonth();
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const dateStr = ymd(d);
      const dow = d.getDay();
      const otherMonth = d.getMonth() !== curMonth;
      const isToday = dateStr === todayStr;
      const events = schedulesOn(dateStr);
      const dayCls = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
      const visible = events.slice(0, 4);
      const more = events.length - visible.length;
      html += `
        <div class="cal-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${dayCls}">
          <div class="cal-date">${d.getDate()}</div>
          <div class="cal-events">
            ${visible.map(s => `<div class="cal-event ios-style" title="[${escapeHtml(s.branch_name || '')}] ${s.start_time}~${s.end_time}${s.note ? ' / ' + escapeHtml(s.note) : ''}">
              <span class="ev-dot" style="background:var(--primary);"></span><span class="ev-name">${s.start_time}</span>
            </div>`).join('')}
            ${more > 0 ? `<div class="cal-event-more">+${more}건</div>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  }

  // 구글 캘린더 스타일 주간 뷰 (read-only)
  function renderMyWeek() {
    const { start } = myCalRange();
    const headDays = ['일', '월', '화', '수', '목', '금', '토'];
    const todayStr = ymd(new Date());
    const startHour = 6;
    const endHour = 23;
    const hourPx = 44;
    const totalHeight = (endHour - startHour + 1) * hourPx;

    let html = '<div class="cal-week-grid">';
    // 헤더
    html += '<div class="cal-week-head"><div class="cal-week-time-head"></div>';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const dow = d.getDay();
      const isToday = ymd(d) === todayStr;
      const cls = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
      html += `<div class="cal-week-day-head ${cls} ${isToday ? 'today' : ''}">
        <div class="dow">${headDays[dow]}</div>
        <div class="day-num">${d.getDate()}</div>
      </div>`;
    }
    html += '</div>';

    // 본문
    html += '<div class="cal-week-body" style="height:' + totalHeight + 'px;">';
    html += '<div class="cal-week-times">';
    for (let h = startHour; h <= endHour; h++) {
      const label = h === 0 ? '오전 12시' : (h < 12 ? '오전 ' + String(h).padStart(2, '0') + '시' : (h === 12 ? '오후 12시' : '오후 ' + String(h - 12).padStart(2, '0') + '시'));
      html += `<div class="cal-week-time-slot" style="height:${hourPx}px;">${label}</div>`;
    }
    html += '</div>';

    html += '<div class="cal-week-days">';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const dateStr = ymd(d);
      const events = schedulesOn(dateStr).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
      const layout = computeColumnLayoutStaff(events);
      html += `<div class="cal-week-day">`;
      for (let h = 0; h <= endHour - startHour; h++) {
        html += `<div class="cal-week-hour-line" style="top:${h * hourPx}px;"></div>`;
      }
      events.forEach(s => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const baseMin = startHour * 60;
        const visMin = startHour * 60;
        const maxMin = (endHour + 1) * 60;
        if (endMin <= visMin || startMin >= maxMin) return;
        const topMin = Math.max(startMin, visMin) - baseMin;
        const bottomMin = Math.min(endMin, maxMin) - baseMin;
        const top = topMin * (hourPx / 60);
        const height = Math.max(18, (bottomMin - topMin) * (hourPx / 60));
        const lo = layout.get(s.id) || { col: 0, cols: 1 };
        const widthPct = 100 / lo.cols;
        const leftPct = lo.col * widthPct;
        html += `<div class="cal-week-event" style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px);background:var(--primary);" title="${s.start_time}~${s.end_time}${s.note ? ' / ' + escapeHtml(s.note) : ''}">
          <div class="ev-time">${s.start_time}~${s.end_time}</div>
          <div class="ev-user">${escapeHtml(s.branch_name || '')}</div>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div></div></div>';
    return html;
  }

  // 직원 측: 본인 일정 가로 분할 (혼치 않지만 일관성 위해 동일 함수 적용)
  function computeColumnLayoutStaff(events) {
    const result = new Map();
    if (!events || events.length === 0) return result;
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const groups = [];
    let cur = [];
    let curEnd = -Infinity;
    for (const ev of events) {
      const s = toMin(ev.start_time);
      const e = toMin(ev.end_time);
      if (cur.length === 0 || s < curEnd) { cur.push(ev); curEnd = Math.max(curEnd, e); }
      else { groups.push(cur); cur = [ev]; curEnd = e; }
    }
    if (cur.length > 0) groups.push(cur);
    for (const group of groups) {
      const colEnds = [];
      for (const ev of group) {
        const s = toMin(ev.start_time);
        const e = toMin(ev.end_time);
        let placed = -1;
        for (let c = 0; c < colEnds.length; c++) {
          if (colEnds[c] <= s) { colEnds[c] = e; placed = c; break; }
        }
        if (placed === -1) { colEnds.push(e); placed = colEnds.length - 1; }
        result.set(ev.id, { col: placed, cols: 0 });
      }
      const total = colEnds.length;
      for (const ev of group) {
        const r = result.get(ev.id);
        if (r) r.cols = total;
      }
    }
    return result;
  }

  // 일별 뷰 (직원): 주별과 같은 시간 축 + 1 컬럼 그리드 (read-only)
  function renderMyDay() {
    const dateStr = ymd(myCalCursor);
    const events = schedulesOn(dateStr).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
    const startHour = 6, endHour = 23, hourPx = 50;
    const totalHeight = (endHour - startHour + 1) * hourPx;
    const layout = computeColumnLayoutStaff(events);

    let html = '<div class="cal-week-grid cal-day-grid">';
    // 일별은 상단 nav 에 날짜가 이미 나오므로 헤더 생략
    html += '<div class="cal-week-body" style="height:' + totalHeight + 'px;">';
    html += '<div class="cal-week-times">';
    for (let h = startHour; h <= endHour; h++) {
      const label = h === 0 ? '오전 12시' : (h < 12 ? '오전 ' + String(h).padStart(2, '0') + '시' : (h === 12 ? '오후 12시' : '오후 ' + String(h - 12).padStart(2, '0') + '시'));
      html += `<div class="cal-week-time-slot" style="height:${hourPx}px;">${label}</div>`;
    }
    html += '</div>';

    html += '<div class="cal-week-days cal-day-single">';
    html += `<div class="cal-week-day">`;
    for (let h = 0; h <= endHour - startHour; h++) {
      html += `<div class="cal-week-hour-line" style="top:${h * hourPx}px;"></div>`;
    }
    events.forEach(s => {
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const baseMin = startHour * 60;
      const visMin = startHour * 60;
      const maxMin = (endHour + 1) * 60;
      if (endMin <= visMin || startMin >= maxMin) return;
      const topMin = Math.max(startMin, visMin) - baseMin;
      const bottomMin = Math.min(endMin, maxMin) - baseMin;
      const top = topMin * (hourPx / 60);
      const height = Math.max(28, (bottomMin - topMin) * (hourPx / 60));
      const lo = layout.get(s.id) || { col: 0, cols: 1 };
      const widthPct = 100 / lo.cols;
      const leftPct = lo.col * widthPct;
      html += `<div class="cal-week-event" style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px);background:var(--primary);" title="${s.start_time}~${s.end_time}${s.note ? ' / ' + escapeHtml(s.note) : ''}">
        <div class="ev-time">${s.start_time}~${s.end_time}</div>
        <div class="ev-user">${escapeHtml(s.branch_name || '')}</div>
        ${s.note ? `<div class="ev-note-line">${escapeHtml(s.note)}</div>` : ''}
      </div>`;
    });
    html += '</div></div></div></div>';
    return html;
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    const errorEl = $('#pw-error');
    const current = $('#pw-current').value;
    const newPw = $('#pw-new').value;
    const confirm = $('#pw-confirm').value;

    if (newPw.length < 6) {
      errorEl.textContent = '새 비밀번호는 6자 이상이어야 합니다.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newPw !== confirm) {
      errorEl.textContent = '새 비밀번호가 일치하지 않습니다.';
      errorEl.classList.remove('hidden');
      return;
    }

    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: newPw })
      });
      showToast('비밀번호가 변경되었습니다.', 'success');
      closeMypage();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }

  // ==================== 초기화 ====================
  async function init() {
    // 이벤트 바인딩
    $('#login-form').addEventListener('submit', handleLogin);
    $('#btn-logout').addEventListener('click', handleLogout);
    $('#btn-checkin').addEventListener('click', () => handleCheck('in'));
    $('#btn-checkout').addEventListener('click', () => handleCheck('out'));
    $('#form-change-pw').addEventListener('submit', handleChangePassword);
    $('#form-update-profile').addEventListener('submit', handleUpdateProfile);
    $('#btn-back-from-mypage').addEventListener('click', closeMypage);
    $('#btn-mypage').addEventListener('click', openMypage);

    // 내 근무표
    $('#btn-my-schedule').addEventListener('click', openMySchedule);
    $('#btn-back-from-schedule').addEventListener('click', () => showScreen('checkin-screen'));
    $('#btn-myschd-prev').addEventListener('click', async () => {
      if (myCalView === 'month') myCalCursor.setMonth(myCalCursor.getMonth() - 1);
      else if (myCalView === 'week') myCalCursor = addDays(myCalCursor, -7);
      else myCalCursor = addDays(myCalCursor, -1);
      await reloadMySchedule();
      renderMyCalendar();
    });
    $('#btn-myschd-next').addEventListener('click', async () => {
      if (myCalView === 'month') myCalCursor.setMonth(myCalCursor.getMonth() + 1);
      else if (myCalView === 'week') myCalCursor = addDays(myCalCursor, 7);
      else myCalCursor = addDays(myCalCursor, 1);
      await reloadMySchedule();
      renderMyCalendar();
    });
    $('#btn-myschd-today').addEventListener('click', async () => {
      myCalCursor = new Date();
      await reloadMySchedule();
      renderMyCalendar();
    });
    document.querySelectorAll('[data-myview]').forEach(b => {
      b.addEventListener('click', async () => {
        myCalView = b.dataset.myview;
        await reloadMySchedule();
        renderMyCalendar();
      });
    });

    // QR코드로 접속한 경우 지점명 표시
    if (qrBranchId) {
      try {
        const res = await fetch(`${API}/branch/${qrBranchId}/info`);
        if (res.ok) {
          const branch = await res.json();
          const el = $('#qr-branch-name');
          el.textContent = `📍 ${branch.name}`;
          el.style.display = 'block';
        }
      } catch (e) { /* 무시 */ }
    }

    // 토큰이 있으면 자동 로그인 시도
    if (token) {
      try {
        const data = await apiFetch('/auth/me');
        currentUser = data.user;
        // 자동 로그인 사용자가 관리자라면 admin 토큰도 동기화
        if (data.user.role === 'admin') {
          localStorage.setItem('cc_admin_token', token);
        }
        await setupWorkBranch();
        initCheckinScreen();
      } catch (err) {
        handleLogout();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
