// ComposeCoffee 출퇴근 앱 - 직원용 클라이언트
(function() {
  'use strict';

  const API = '/api';
  let token = localStorage.getItem('cc_token');
  let currentUser = null;
  let currentPosition = null;
  let watchId = null;
  let qrBranchId = new URLSearchParams(window.location.search).get('branch');
  let workBranch = null; // QR 지점 정보 (파견 근무 시 사용)

  // ==================== 유틸 ====================
  function $(sel) { return document.querySelector(sel); }

  async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API + url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
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
      list.innerHTML = data.history.reverse().map(h => `
        <div class="history-item">
          <div>
            <div class="history-date">${formatDate(h.date)}</div>
            <div class="history-times">${formatTime(h.checkIn)} ~ ${formatTime(h.checkOut)}</div>
          </div>
          <div class="history-hours">${h.workHours}</div>
        </div>
      `).join('');
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
    localStorage.removeItem('cc_token');
    stopLocationWatch();
    showScreen('login-screen');
  }

  async function initCheckinScreen() {
    // 관리자(본사 소속)이고 QR 접속이 아니면 관리 페이지로 이동
    if (currentUser.role === 'admin' && currentUser.branch.name === '본사' && !qrBranchId) {
      // 관리자 페이지에서도 같은 토큰으로 자동 로그인되도록
      localStorage.setItem('cc_admin_token', token);
      window.location.href = '/admin.html';
      return;
    }

    // 관리자일 경우 관리 페이지 링크 표시
    if (currentUser.role === 'admin') {
      const existing = document.querySelector('.admin-link');
      if (!existing) {
        const adminLink = document.createElement('a');
        adminLink.href = '/admin.html';
        adminLink.className = 'btn btn-sm btn-outline admin-link';
        adminLink.style.cssText = 'color:#FFB300;border-color:#FFB300;margin-right:8px;';
        adminLink.textContent = '관리자 페이지';
        const headerRight = $('.header-right');
        headerRight.insertBefore(adminLink, headerRight.firstChild);
      }
    }

    $('#user-name').textContent = currentUser.name;

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
  async function handleCheck(checkType) {
    if (!currentPosition) {
      showToast('위치 정보를 확인 중입니다. 잠시 후 다시 시도해주세요.', 'error');
      return;
    }

    const btn = checkType === 'in' ? $('#btn-checkin') : $('#btn-checkout');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 처리중...';

    try {
      const body = {
        checkType,
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude
      };

      // QR 지점이 소속과 다르면 branchId 전송 (파견 근무)
      if (workBranch) {
        body.branchId = workBranch.id;
      }

      const data = await apiFetch('/attendance/check', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      showToast(data.message, 'success');
      await loadTodayStatus();
      loadMonthlyHistory();
    } catch (err) {
      showToast(err.message, 'error');
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ==================== 마이페이지 ====================
  function openMypage() {
    $('#my-name').textContent = currentUser.name;
    $('#my-branch').textContent = currentUser.branch.name;
    $('#my-role').textContent = currentUser.role === 'admin' ? '관리자' : '직원';
    $('#form-change-pw').reset();
    $('#pw-error').classList.add('hidden');
    $('#modal-mypage').classList.add('active');
  }

  function closeMypage() {
    $('#modal-mypage').classList.remove('active');
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
    $('#btn-close-mypage').addEventListener('click', closeMypage);
    $('#btn-mypage').addEventListener('click', openMypage);

    // 모달 바깥 클릭 시 닫기
    $('#modal-mypage').addEventListener('click', (e) => {
      if (e.target === $('#modal-mypage')) closeMypage();
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
        await setupWorkBranch();
        initCheckinScreen();
      } catch (err) {
        handleLogout();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
