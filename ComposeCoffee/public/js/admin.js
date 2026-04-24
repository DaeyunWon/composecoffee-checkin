// ComposeCoffee 관리자 페이지
(function() {
  'use strict';

  const API = '/api';
  let token = localStorage.getItem('cc_admin_token');
  let adminUser = null;
  let branches = [];

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API + url, { ...options, headers });
    if (url.includes('/export') && res.ok) {
      return res;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 실패');
    return data;
  }

  function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  function formatTime(dt) {
    if (!dt) return '-';
    const d = new Date(dt + (dt.includes('Z') || dt.includes('+') ? '' : 'Z'));
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function statusBadge(status) {
    const map = {
      '근무중': 'badge-success',
      '퇴근': 'badge-info',
      '미출근': 'badge-danger'
    };
    return `<span class="badge ${map[status] || 'badge-warning'}">${status}</span>`;
  }

  // ==================== 로그인 ====================
  $('#admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginId = $('#admin-id').value.trim();
    const password = $('#admin-pw').value;
    const errEl = $('#admin-login-error');

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ loginId, password })
      });

      if (data.user.role !== 'admin') {
        errEl.textContent = '관리자 계정만 접근할 수 있습니다.';
        errEl.classList.remove('hidden');
        return;
      }

      token = data.token;
      localStorage.setItem('cc_admin_token', token);
      adminUser = data.user;
      errEl.classList.add('hidden');
      showAdminApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#admin-logout').addEventListener('click', () => {
    token = null;
    adminUser = null;
    localStorage.removeItem('cc_admin_token');
    location.reload();
  });

  // ==================== 네비게이션 ====================
  $$('.nav-menu a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const section = a.dataset.section;
      $$('.nav-menu a').forEach(n => n.classList.remove('active'));
      a.classList.add('active');
      $$('.admin-section').forEach(s => s.style.display = 'none');
      $(`#sec-${section}`).style.display = 'block';

      // 섹션 로드
      switch (section) {
        case 'dashboard': loadDashboard(); break;
        case 'branches': loadBranches(); break;
        case 'users': loadUsers(); break;
        case 'daily': loadDaily(); break;
        case 'monthly': break;
        case 'qrcode': break;
      }
    });
  });

  // ==================== 대시보드 ====================
  async function loadDashboard() {
    try {
      const today = new Date().toISOString().split('T')[0];
      $('#dashboard-date').textContent = today;

      const [dailyData, branchData] = await Promise.all([
        apiFetch(`/admin/attendance/daily?date=${today}`),
        apiFetch('/admin/branches')
      ]);

      branches = branchData.branches;

      // 요약 카드
      const total = dailyData.records.length;
      const checkedIn = dailyData.records.filter(r => r.check_in_time).length;
      const working = dailyData.records.filter(r => r.check_in_time && !r.check_out_time).length;
      const done = dailyData.records.filter(r => r.check_out_time).length;

      $('#dashboard-summary').innerHTML = `
        <div class="status-card" style="text-align:center;">
          <div style="font-size:32px;font-weight:700;color:var(--primary);">${total}</div>
          <div style="font-size:13px;color:var(--text-light);">전체 직원</div>
        </div>
        <div class="status-card" style="text-align:center;">
          <div style="font-size:32px;font-weight:700;color:var(--success);">${checkedIn}</div>
          <div style="font-size:13px;color:var(--text-light);">출근 완료</div>
        </div>
        <div class="status-card" style="text-align:center;">
          <div style="font-size:32px;font-weight:700;color:var(--accent);">${working}</div>
          <div style="font-size:13px;color:var(--text-light);">근무중</div>
        </div>
        <div class="status-card" style="text-align:center;">
          <div style="font-size:32px;font-weight:700;color:var(--primary-light);">${done}</div>
          <div style="font-size:13px;color:var(--text-light);">퇴근</div>
        </div>
      `;

      // 오늘 테이블
      const tbody = $('#dashboard-table tbody');
      tbody.innerHTML = dailyData.records.map(r => `
        <tr>
          <td>${r.branch_name}</td>
          <td>${r.name}</td>
          <td>${formatTime(r.check_in_time)}</td>
          <td>${formatTime(r.check_out_time)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==================== 지점 관리 ====================
  async function loadBranches() {
    try {
      const data = await apiFetch('/admin/branches');
      branches = data.branches;

      const tbody = $('#branches-table tbody');
      tbody.innerHTML = branches.map(b => `
        <tr>
          <td><strong>${b.name}</strong></td>
          <td>${b.address || '-'}</td>
          <td style="font-size:12px;">${b.latitude}, ${b.longitude}</td>
          <td>${b.radius_meters}m</td>
          <td>${b.staff_count}명</td>
          <td><button class="btn btn-outline btn-sm" onclick="editBranch(${b.id})">수정</button></td>
        </tr>
      `).join('');

      updateBranchSelectors();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function updateBranchSelectors() {
    const selectors = ['#filter-user-branch', '#filter-daily-branch', '#filter-monthly-branch', '#filter-qr-branch', '#user-branch'];
    selectors.forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const isRequired = sel === '#user-branch';
      const firstOption = isRequired ? '<option value="">선택</option>' : '<option value="">전체 지점</option>';
      if (sel === '#filter-qr-branch') {
        el.innerHTML = '<option value="">지점을 선택하세요</option>';
      } else {
        el.innerHTML = firstOption;
      }
      branches.forEach(b => {
        el.innerHTML += `<option value="${b.id}">${b.name}</option>`;
      });
    });
  }

  $('#btn-add-branch').addEventListener('click', () => {
    $('#modal-branch-title').textContent = '지점 추가';
    $('#branch-edit-id').value = '';
    $('#form-branch').reset();
    $('#branch-radius').value = 50;
    $('#modal-branch').classList.add('active');
  });

  window.editBranch = async function(id) {
    const branch = branches.find(b => b.id === id);
    if (!branch) return;

    $('#modal-branch-title').textContent = '지점 수정';
    $('#branch-edit-id').value = id;
    $('#branch-name').value = branch.name;
    $('#branch-address').value = branch.address || '';
    $('#branch-lat').value = branch.latitude;
    $('#branch-lng').value = branch.longitude;
    $('#branch-radius').value = branch.radius_meters;
    $('#modal-branch').classList.add('active');
  };

  $('#btn-get-current-location').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('#branch-lat').value = pos.coords.latitude.toFixed(7);
        $('#branch-lng').value = pos.coords.longitude.toFixed(7);
        showToast('현재 위치가 입력되었습니다.', 'success');
      },
      () => showToast('위치 정보를 가져올 수 없습니다.', 'error'),
      { enableHighAccuracy: true }
    );
  });

  $('#form-branch').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('#branch-edit-id').value;
    const payload = {
      name: $('#branch-name').value.trim(),
      address: $('#branch-address').value.trim(),
      latitude: parseFloat($('#branch-lat').value),
      longitude: parseFloat($('#branch-lng').value),
      radiusMeters: parseInt($('#branch-radius').value)
    };

    try {
      if (editId) {
        await apiFetch(`/admin/branches/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('지점이 수정되었습니다.', 'success');
      } else {
        await apiFetch('/admin/branches', { method: 'POST', body: JSON.stringify(payload) });
        showToast('지점이 추가되었습니다.', 'success');
      }
      $('#modal-branch').classList.remove('active');
      loadBranches();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ==================== 직원 관리 ====================
  async function loadUsers(branchId) {
    try {
      const query = branchId ? `?branchId=${branchId}` : '';
      const data = await apiFetch(`/admin/users${query}`);

      const tbody = $('#users-table tbody');
      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td><strong>${u.name}</strong></td>
          <td>${u.login_id}</td>
          <td>${u.branch_name}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-info'}">${u.role === 'admin' ? '관리자' : '직원'}</span></td>
          <td><span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}">${u.is_active ? '활성' : '비활성'}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="editUser('${u.id}')">수정</button>
            <button class="btn btn-outline btn-sm" onclick="toggleUser('${u.id}', ${u.is_active})">${u.is_active ? '비활성화' : '활성화'}</button>
            <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" onclick="deleteUser('${u.id}', '${u.name}')">삭제</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  $('#filter-user-branch').addEventListener('change', (e) => {
    loadUsers(e.target.value);
  });

  $('#btn-add-user').addEventListener('click', () => {
    $('#modal-user-title').textContent = '직원 등록';
    $('#user-edit-id').value = '';
    $('#form-user').reset();
    $('#user-login-id').disabled = false;
    $('#pw-group').style.display = 'block';
    $('#user-password').required = true;
    $('#modal-user').classList.add('active');
  });

  window.editUser = async function(id) {
    try {
      const data = await apiFetch('/admin/users');
      const user = data.users.find(u => u.id === id);
      if (!user) return;

      $('#modal-user-title').textContent = '직원 정보 수정';
      $('#user-edit-id').value = id;
      $('#user-login-id').value = user.login_id;
      $('#user-login-id').disabled = true;
      $('#user-password').value = '';
      $('#user-password').required = false;
      $('#pw-group querySelector label') && ($('#pw-group label').textContent = '비밀번호 (변경 시에만 입력)');
      $('#user-name-input').value = user.name;
      $('#user-phone').value = user.phone || '';
      $('#user-branch').value = user.branch_id;
      $('#user-role').value = user.role;
      $('#modal-user').classList.add('active');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.toggleUser = async function(id, currentActive) {
    if (!confirm(currentActive ? '이 직원을 비활성화하시겠습니까?' : '이 직원을 활성화하시겠습니까?')) return;
    try {
      await apiFetch(`/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: currentActive ? 0 : 1 })
      });
      showToast(currentActive ? '비활성화되었습니다.' : '활성화되었습니다.', 'success');
      loadUsers($('#filter-user-branch').value);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.deleteUser = async function(id, name) {
    if (!confirm(`"${name}" 직원을 정말 삭제하시겠습니까?\n\n⚠️ 해당 직원의 모든 출퇴근 기록도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
      showToast(`${name} 직원이 삭제되었습니다.`, 'success');
      loadUsers($('#filter-user-branch').value);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  $('#form-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('#user-edit-id').value;
    const payload = {
      name: $('#user-name-input').value.trim(),
      phone: $('#user-phone').value.trim(),
      branchId: parseInt($('#user-branch').value),
      role: $('#user-role').value
    };

    if (!editId) {
      payload.loginId = $('#user-login-id').value.trim();
      payload.password = $('#user-password').value;
      if (!payload.password || payload.password.length < 6) {
        showToast('비밀번호는 6자 이상이어야 합니다.', 'error');
        return;
      }
    } else if ($('#user-password').value) {
      payload.password = $('#user-password').value;
    }

    try {
      if (editId) {
        await apiFetch(`/admin/users/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('직원 정보가 수정되었습니다.', 'success');
      } else {
        await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
        showToast('직원이 등록되었습니다.', 'success');
      }
      $('#modal-user').classList.remove('active');
      loadUsers($('#filter-user-branch').value);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ==================== 일별 현황 ====================
  async function loadDaily() {
    const date = $('#filter-daily-date').value || new Date().toISOString().split('T')[0];
    const branchId = $('#filter-daily-branch').value;

    try {
      const query = `?date=${date}${branchId ? `&branchId=${branchId}` : ''}`;
      const data = await apiFetch(`/admin/attendance/daily${query}`);

      const tbody = $('#daily-table tbody');
      tbody.innerHTML = data.records.map(r => `
        <tr>
          <td>${r.branch_name}</td>
          <td>${r.name}</td>
          <td>${formatTime(r.check_in_time)}</td>
          <td>${formatTime(r.check_out_time)}</td>
          <td>${r.workHours}</td>
          <td>${r.check_in_distance != null ? r.check_in_distance : '-'}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // 날짜 기본값 설정
  $('#filter-daily-date').value = new Date().toISOString().split('T')[0];
  $('#filter-daily-date').addEventListener('change', loadDaily);
  $('#filter-daily-branch').addEventListener('change', loadDaily);

  // ==================== 월별 리포트 ====================
  // 연도/월 셀렉터 초기화
  const now = new Date();
  const yearSel = $('#filter-monthly-year');
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    yearSel.innerHTML += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}년</option>`;
  }
  const monthSel = $('#filter-monthly-month');
  for (let m = 1; m <= 12; m++) {
    monthSel.innerHTML += `<option value="${m}" ${m === now.getMonth() + 1 ? 'selected' : ''}>${m}월</option>`;
  }

  $('#btn-load-monthly').addEventListener('click', loadMonthly);

  async function loadMonthly() {
    const year = $('#filter-monthly-year').value;
    const month = $('#filter-monthly-month').value;
    const branchId = $('#filter-monthly-branch').value;

    try {
      const query = `?year=${year}&month=${month}${branchId ? `&branchId=${branchId}` : ''}`;
      const data = await apiFetch(`/admin/attendance/monthly${query}`);

      const tbody = $('#monthly-table tbody');
      tbody.innerHTML = data.records.map(r => `
        <tr>
          <td>${r.branch_name}</td>
          <td>${r.name}</td>
          <td>${r.work_days}일</td>
          <td><strong>${r.totalHours}</strong></td>
        </tr>
      `).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  $('#btn-export-csv').addEventListener('click', async () => {
    const year = $('#filter-monthly-year').value;
    const month = $('#filter-monthly-month').value;
    const branchId = $('#filter-monthly-branch').value;

    try {
      const query = `?year=${year}&month=${month}${branchId ? `&branchId=${branchId}` : ''}`;
      const res = await apiFetch(`/admin/attendance/export${query}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${year}${String(month).padStart(2, '0')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV 파일이 다운로드되었습니다.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ==================== QR코드 ====================
  $('#btn-gen-qr').addEventListener('click', async () => {
    const branchId = $('#filter-qr-branch').value;
    const baseUrl = $('#qr-base-url').value.trim();

    if (!branchId) {
      showToast('지점을 선택해주세요.', 'error');
      return;
    }

    try {
      const query = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
      const data = await apiFetch(`/admin/branches/${branchId}/qrcode${query}`);

      $('#qr-display').innerHTML = `
        <h3>${data.branch.name}</h3>
        <img src="${data.qrImage}" alt="QR Code">
        <p>이 QR코드를 스캔하면 출퇴근 페이지로 이동합니다.</p>
        <p style="font-size:12px;color:#999;">URL: ${data.qrUrl}</p>
        <button class="btn btn-primary btn-sm" onclick="printQR()" style="margin-top:12px;">🖨️ 인쇄</button>
      `;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window.printQR = function() {
    const printWin = window.open('', '_blank');
    const content = $('#qr-display').innerHTML;
    printWin.document.write(`
      <html><head><title>QR코드 인쇄</title>
      <style>body{text-align:center;font-family:sans-serif;padding:40px;}img{max-width:400px;}</style>
      </head><body>${content}</body></html>
    `);
    printWin.document.close();
    printWin.print();
  };

  // ==================== 초기화 ====================
  async function showAdminApp() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('#admin-app').classList.add('active');

    // 지점 데이터 먼저 로드
    try {
      const data = await apiFetch('/admin/branches');
      branches = data.branches;
      updateBranchSelectors();
    } catch (err) {
      console.error('Failed to load branches:', err);
    }

    loadDashboard();
  }

  // 자동 로그인 시도
  async function init() {
    if (token) {
      try {
        const data = await apiFetch('/auth/me');
        if (data.user.role !== 'admin') {
          localStorage.removeItem('cc_admin_token');
          token = null;
          return;
        }
        adminUser = data.user;
        showAdminApp();
      } catch (err) {
        localStorage.removeItem('cc_admin_token');
        token = null;
      }
    }
  }

  init();
})();
