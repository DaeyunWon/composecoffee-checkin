// ComposeCoffee 관리자 페이지
(function() {
  'use strict';

  const API = '/api';
  let token = localStorage.getItem('cc_admin_token');
  let adminUser = null;
  let branches = [];

  function $(sel) { return document.querySelector(sel); }

  // 모바일 사이드바 토글
  function openSidebar() {
    $('#admin-sidebar').classList.add('open');
    $('#sidebar-overlay').classList.add('active');
  }
  function closeSidebar() {
    $('#admin-sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('active');
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-mobile-menu').addEventListener('click', openSidebar);
    $('#sidebar-overlay').addEventListener('click', closeSidebar);
  });
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
    // KST 문자열에서 시:분만 추출
    const timePart = dt.includes(' ') ? dt.split(' ')[1] : dt.split('T')[1];
    if (timePart) return timePart.substring(0, 5);
    return '-';
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
      // 직원 페이지에서도 같은 토큰으로 사용 가능하도록 함께 저장
      localStorage.setItem('cc_token', token);
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
    // 두 토큰 모두 제거 (직원 페이지 자동 로그인 방지)
    localStorage.removeItem('cc_admin_token');
    localStorage.removeItem('cc_token');
    // 로그아웃 후에는 루트(직원 로그인 화면)로 이동
    window.location.href = '/';
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
      closeSidebar();

      // 섹션 로드
      switch (section) {
        case 'dashboard': loadDashboard(); break;
        case 'branches': loadBranches(); break;
        case 'users': loadUsers(); break;
        case 'schedule': loadSchedule(); break;
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
      tbody.innerHTML = dailyData.records.map(r => {
        const dispatchTag = r.isDispatch && r.workBranchName
          ? ` <span style="color:#E65100;font-size:11px;">(→${r.workBranchName})</span>`
          : '';
        return `
        <tr>
          <td>${r.branch_name}${dispatchTag}</td>
          <td>${r.name}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${formatTime(r.check_in_time)}</td>
          <td>${formatTime(r.check_out_time)}</td>
          <td>${r.workHours}</td>
        </tr>`;
      }).join('');
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
      const displayBranches = branches.filter(b => b.name !== '본사');
      tbody.innerHTML = displayBranches.map(b => `
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
        // "본사"는 직원 등록(user-branch)에만 표시, 일반 필터와 QR에서는 숨김
        if (b.name === '본사' && sel !== '#user-branch') return;
        el.innerHTML += `<option value="${b.id}">${b.name}</option>`;
      });
    });
  }

  // ==================== 지도 (Leaflet + OSM) ====================
  let branchMap = null;
  let branchMarker = null;
  let branchCircle = null;

  function initBranchMap() {
    if (branchMap) {
      branchMap.invalidateSize();
      return;
    }

    // 서울 중심으로 기본 표시
    branchMap = L.map('branch-map').setView([37.5665, 126.9780], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(branchMap);

    // 지도 클릭 시 좌표 입력
    branchMap.on('click', function(e) {
      setMapLocation(e.latlng.lat, e.latlng.lng);
    });
  }

  function setMapLocation(lat, lng) {
    $('#branch-lat').value = lat.toFixed(7);
    $('#branch-lng').value = lng.toFixed(7);

    if (branchMarker) {
      branchMarker.setLatLng([lat, lng]);
    } else {
      branchMarker = L.marker([lat, lng], { draggable: true }).addTo(branchMap);
      branchMarker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        setMapLocation(pos.lat, pos.lng);
      });
    }

    // 반경 원 표시
    const radius = parseInt($('#branch-radius').value) || 50;
    if (branchCircle) {
      branchCircle.setLatLng([lat, lng]).setRadius(radius);
    } else {
      branchCircle = L.circle([lat, lng], {
        radius: radius,
        color: '#FF8F00',
        fillColor: '#FFB300',
        fillOpacity: 0.2
      }).addTo(branchMap);
    }

    branchMap.setView([lat, lng], Math.max(branchMap.getZoom(), 16));
  }

  // 반경 변경 시 원 업데이트
  $('#branch-radius').addEventListener('input', () => {
    if (branchCircle) {
      branchCircle.setRadius(parseInt($('#branch-radius').value) || 50);
    }
  });

  // 주소 검색 (Nominatim - OSM 무료 지오코딩)
  $('#btn-search-address').addEventListener('click', searchAddress);
  $('#branch-address').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchAddress(); }
  });

  async function searchAddress() {
    const query = $('#branch-address').value.trim();
    if (!query) { showToast('주소 또는 장소명을 입력해주세요.', 'error'); return; }

    const resultsEl = $('#search-results');
    resultsEl.innerHTML = '<div style="padding:10px;color:var(--text-light);">검색 중...</div>';
    resultsEl.style.display = 'block';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=kr&limit=5&accept-language=ko`);
      const data = await res.json();

      if (data.length === 0) {
        resultsEl.innerHTML = '<div style="padding:10px;color:var(--danger);">검색 결과가 없습니다. 다른 키워드로 시도해보세요.</div>';
        return;
      }

      resultsEl.innerHTML = data.map((item, i) => `
        <div class="search-result-item" data-lat="${item.lat}" data-lng="${item.lon}" data-name="${item.display_name}"
          style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;${i === 0 ? 'background:#FFF8E1;' : ''}"
          onmouseover="this.style.background='#FFF8E1'" onmouseout="this.style.background='${i === 0 ? '#FFF8E1' : '#fff'}'">
          ${item.display_name}
        </div>
      `).join('');

      // 검색 결과 클릭 이벤트
      resultsEl.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat);
          const lng = parseFloat(el.dataset.lng);
          $('#branch-address').value = el.dataset.name;
          setMapLocation(lat, lng);
          resultsEl.style.display = 'none';
        });
      });
    } catch (err) {
      resultsEl.innerHTML = '<div style="padding:10px;color:var(--danger);">검색 중 오류가 발생했습니다.</div>';
    }
  }

  // 모달 열 때 지도 초기화
  $('#btn-add-branch').addEventListener('click', () => {
    $('#modal-branch-title').textContent = '지점 추가';
    $('#branch-edit-id').value = '';
    $('#form-branch').reset();
    $('#branch-radius').value = 50;
    $('#search-results').style.display = 'none';
    $('#modal-branch').classList.add('active');

    // 기존 마커/원 제거
    if (branchMarker) { branchMap && branchMap.removeLayer(branchMarker); branchMarker = null; }
    if (branchCircle) { branchMap && branchMap.removeLayer(branchCircle); branchCircle = null; }

    setTimeout(() => {
      initBranchMap();
      branchMap.setView([37.5665, 126.9780], 13);
    }, 200);
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
    $('#search-results').style.display = 'none';
    $('#modal-branch').classList.add('active');

    // 기존 마커/원 제거
    if (branchMarker) { branchMap && branchMap.removeLayer(branchMarker); branchMarker = null; }
    if (branchCircle) { branchMap && branchMap.removeLayer(branchCircle); branchCircle = null; }

    setTimeout(() => {
      initBranchMap();
      setMapLocation(branch.latitude, branch.longitude);
    }, 200);
  };

  $('#btn-get-current-location').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMapLocation(pos.coords.latitude, pos.coords.longitude);
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
          <td>${u.branch_name}</td>
          <td><strong>${u.name}</strong></td>
          <td>${u.login_id}</td>
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
    $('#user-branch').disabled = false;
    $('#modal-user').classList.add('active');
  });

  // 역할 변경 시 관리자면 자동으로 본사 선택
  $('#user-role').addEventListener('change', () => {
    const role = $('#user-role').value;
    if (role === 'admin') {
      const hqOption = Array.from($('#user-branch').options).find(o => o.textContent === '본사');
      if (hqOption) {
        $('#user-branch').value = hqOption.value;
        $('#user-branch').disabled = true;
      }
    } else {
      $('#user-branch').disabled = false;
      $('#user-branch').value = '';
    }
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
      tbody.innerHTML = data.records.map(r => {
        const dispatchTag = r.isDispatch && r.workBranchName
          ? ` <span style="color:#E65100;font-size:11px;">(→${r.workBranchName})</span>`
          : '';
        let noteCell = '-';
        if (r.check_out_note || r.check_out_warning) {
          const combined = [r.check_out_warning, r.check_out_note].filter(Boolean).join(' / ');
          const safe = String(combined).replace(/"/g, '&quot;');
          const preview = r.check_out_note
            ? `📝 ${r.check_out_note.length > 14 ? r.check_out_note.slice(0, 14) + '…' : r.check_out_note}`
            : '⚠️';
          noteCell = `<span style="cursor:help;color:var(--primary-dark);font-weight:600;" title="${safe}">${preview}</span>`;
        }
        return `
        <tr>
          <td>${r.branch_name}${dispatchTag}</td>
          <td>${r.name}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${formatTime(r.check_in_time)}</td>
          <td>${formatTime(r.check_out_time)}</td>
          <td>${r.workHours}</td>
          <td>${r.check_in_distance != null ? r.check_in_distance : '-'}</td>
          <td>${noteCell}</td>
        </tr>`;
      }).join('');
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
      a.download = `attendance_${year}${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('엑셀 파일이 다운로드되었습니다.', 'success');
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

  // ==================== 근무표 (캘린더) ====================
  // 상태: 현재 보고있는 기준 날짜 / 뷰 모드 / 캐시된 일정 / 필터된 지점
  let calCursor = new Date();        // 현재 보고있는 날짜 (월/주/일의 기준)
  let calView = 'day';               // 기본값: 일별 ('month' | 'week' | 'day')
  let calSchedules = [];             // 현재 화면 범위 일정
  let allUsers = [];                 // 직원 목록 캐시
  let calBranchFilter = '';          // 선택된 지점 ID (빈 문자열 = 전체)

  // 지점별 고유 색상 (id 기반, 본사 제외 지점들에 순서대로 부여)
  const BRANCH_PALETTE = [
    { bg: '#5D4037', border: '#3E2723' }, // 갈색
    { bg: '#1565C0', border: '#0D47A1' }, // 파랑
    { bg: '#2E7D32', border: '#1B5E20' }, // 녹색
    { bg: '#FF8F00', border: '#E65100' }, // 주황
    { bg: '#6A1B9A', border: '#4A148C' }, // 보라
    { bg: '#C2185B', border: '#880E4F' }, // 핑크
    { bg: '#00838F', border: '#006064' }  // 청록
  ];
  function branchColor(branchId) {
    // 본사 제외한 지점들을 정렬해서 인덱스를 부여 → id 순서가 바뀌어도 색이 안정적
    const sorted = branches.filter(b => b.name !== '본사').slice().sort((a, b) => a.id - b.id);
    const idx = sorted.findIndex(b => b.id === branchId);
    return BRANCH_PALETTE[(idx >= 0 ? idx : 0) % BRANCH_PALETTE.length];
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

  function startOfWeek(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay()); // 일요일 시작
    return r;
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function getCalRange() {
    // 현재 뷰의 [start, end) 범위 (end는 미포함)
    if (calView === 'month') {
      // 달력 전체 6주 표시
      const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
      const start = startOfWeek(first);
      const end = addDays(start, 42);
      return { start, end };
    }
    if (calView === 'week') {
      const start = startOfWeek(calCursor);
      const end = addDays(start, 7);
      return { start, end };
    }
    // day
    const start = new Date(calCursor);
    start.setHours(0, 0, 0, 0);
    const end = addDays(start, 1);
    return { start, end };
  }

  function calTitle() {
    if (calView === 'month') {
      return `${calCursor.getFullYear()}년 ${calCursor.getMonth() + 1}월`;
    }
    if (calView === 'week') {
      const s = startOfWeek(calCursor);
      const e = addDays(s, 6);
      return `${s.getFullYear()}.${pad2(s.getMonth() + 1)}.${pad2(s.getDate())} ~ ${e.getFullYear()}.${pad2(e.getMonth() + 1)}.${pad2(e.getDate())}`;
    }
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${calCursor.getFullYear()}년 ${calCursor.getMonth() + 1}월 ${calCursor.getDate()}일 (${days[calCursor.getDay()]})`;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  async function loadSchedule() {
    try {
      // 직원 데이터 (한 번만)
      if (allUsers.length === 0) {
        const r = await apiFetch('/admin/users');
        allUsers = r.users.filter(u => u.is_active);
      }
      // 지점 데이터
      if (branches.length === 0) {
        const br = await apiFetch('/admin/branches');
        branches = br.branches;
        updateBranchSelectors();
      }
      // 항상 특정 지점이 선택되어 있어야 함. 빈값이거나 존재하지 않는 지점이면 첫 번째 실제 지점으로
      const real = branches.filter(b => b.name !== '본사').slice().sort((a, b) => a.id - b.id);
      const filterIsValid = calBranchFilter && real.some(b => String(b.id) === String(calBranchFilter));
      if (!filterIsValid && real.length > 0) {
        calBranchFilter = String(real[0].id);
      }
      renderBranchTabs();
      await reloadCalSchedules();
      renderCalendar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderBranchTabs() {
    const real = branches.filter(b => b.name !== '본사').slice().sort((a, b) => a.id - b.id);
    const tabs = $('#schedule-branch-tabs');
    if (!tabs) return;
    // '전체' 옵션 없이 등록된 실제 지점만 — 항상 하나는 선택되어 있어야 함
    let html = '';
    real.forEach(b => {
      const c = branchColor(b.id);
      const active = String(b.id) === String(calBranchFilter);
      html += `<button class="branch-tab ${active ? 'active' : ''}" data-id="${b.id}" style="${active ? `background:${c.bg};color:#fff;border-color:${c.border};` : `color:${c.bg};border-color:${c.bg};`}">
        <span class="branch-tab-dot" style="background:${c.bg};"></span>${escapeHtml(b.name)}
      </button>`;
    });
    tabs.innerHTML = html;
    tabs.querySelectorAll('.branch-tab').forEach(t => {
      t.addEventListener('click', async () => {
        calBranchFilter = t.dataset.id;
        renderBranchTabs();
        await reloadCalSchedules();
        renderCalendar();
      });
    });
  }

  async function reloadCalSchedules() {
    const { start, end } = getCalRange();
    const query = `?start=${ymd(start)}&end=${ymd(end)}${calBranchFilter ? `&branchId=${calBranchFilter}` : ''}`;
    const data = await apiFetch(`/admin/schedules${query}`);
    calSchedules = data.schedules;
  }

  function schedulesByDate(dateStr) {
    return calSchedules.filter(s => s.work_date === dateStr);
  }

  function renderCalendar() {
    $('#schedule-title').textContent = calTitle();
    // 뷰 버튼 active
    $$('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === calView);
    });
    const root = $('#schedule-calendar');
    if (calView === 'month') root.innerHTML = renderMonth();
    else if (calView === 'week') root.innerHTML = renderWeek();
    else root.innerHTML = renderDay();
    bindCalendarEvents();
  }

  function renderMonth() {
    const { start } = getCalRange();
    const headDays = ['일', '월', '화', '수', '목', '금', '토'];
    let html = '<div class="cal-month">';
    headDays.forEach((d, i) => {
      const cls = i === 0 ? 'sun' : (i === 6 ? 'sat' : '');
      html += `<div class="cal-head ${cls}">${d}</div>`;
    });

    const todayStr = ymd(new Date());
    const curMonth = calCursor.getMonth();

    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const dateStr = ymd(d);
      const dayOfWeek = d.getDay();
      const otherMonth = d.getMonth() !== curMonth;
      const isToday = dateStr === todayStr;
      const events = schedulesByDate(dateStr);
      const visible = events.slice(0, 3);
      const more = events.length - visible.length;
      const dayCls = dayOfWeek === 0 ? 'sun' : (dayOfWeek === 6 ? 'sat' : '');
      html += `
        <div class="cal-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${dayCls}" data-date="${dateStr}">
          <div class="cal-date">${d.getDate()}</div>
          <div class="cal-events">
            ${visible.map(s => {
              const c = branchColor(s.branch_id);
              return `<div class="cal-event ios-style" data-id="${s.id}" title="[${escapeHtml(s.branch_name)}] ${escapeHtml(s.user_name)} ${s.start_time}~${s.end_time}">
                <span class="ev-dot" style="background:${c.bg};"></span><span class="ev-name">${escapeHtml(s.user_name)}</span>
              </div>`;
            }).join('')}
            ${more > 0 ? `<div class="cal-event-more">+${more}건</div>` : ''}
          </div>
        </div>`;
    }
    html += '</div>';
    return html;
  }

  // 구글 캘린더 스타일 주간 뷰: 왼쪽 시간 축 + 시간대별 절대 위치 이벤트
  function renderWeek() {
    const { start } = getCalRange();
    const headDays = ['일', '월', '화', '수', '목', '금', '토'];
    const todayStr = ymd(new Date());
    const startHour = 6;   // 06:00 부터
    const endHour = 23;    // 23:00 까지
    const hourPx = 44;
    const totalHeight = (endHour - startHour + 1) * hourPx;

    let html = '<div class="cal-week-grid">';

    // 헤더: 시간 축 자리 + 7일 헤더
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

    // 본문: 시간 축 + 7일 칸
    html += '<div class="cal-week-body" style="height:' + totalHeight + 'px;">';
    // 시간 축
    html += '<div class="cal-week-times">';
    for (let h = startHour; h <= endHour; h++) {
      const label = h === 0 ? '오전 12시' : (h < 12 ? '오전 ' + String(h).padStart(2, '0') + '시' : (h === 12 ? '오후 12시' : '오후 ' + String(h - 12).padStart(2, '0') + '시'));
      html += `<div class="cal-week-time-slot" style="height:${hourPx}px;">${label}</div>`;
    }
    html += '</div>';

    // 7일 칸
    html += '<div class="cal-week-days">';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const dateStr = ymd(d);
      const events = schedulesByDate(dateStr).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
      // 시간이 겹치는 이벤트는 가로로 분할
      const layout = computeColumnLayout(events);
      html += `<div class="cal-week-day" data-date="${dateStr}">`;
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
        // 배경은 홈 지점 색으로 — 같은 시간대 다른 지점 직원이 자연스럽게 색으로 구분됨
        const c = branchColor(s.user_home_branch_id || s.branch_id);
        const homeName = s.user_home_branch_name || s.branch_name;
        const isDispatch = s.user_home_branch_id != null && s.user_home_branch_id !== s.branch_id;
        const lo = layout.get(s.id) || { col: 0, cols: 1 };
        const widthPct = 100 / lo.cols;
        const leftPct = lo.col * widthPct;
        const titleStr = isDispatch
          ? `[${s.user_home_branch_name}] ${s.user_name} (${s.branch_name} 파견) ${s.start_time}~${s.end_time}`
          : `[${s.branch_name}] ${s.user_name} ${s.start_time}~${s.end_time}`;
        html += `<div class="cal-week-event" data-id="${s.id}" style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px);background:${c.bg};border-color:${c.border};" title="${escapeHtml(titleStr)}">
          <div class="ev-user-only">${escapeHtml(s.user_name)}</div>
          ${isDispatch ? '<div class="dispatch-mini-block">파견</div>' : ''}
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>'; // .cal-week-days
    html += '</div>'; // .cal-week-body
    html += '</div>'; // .cal-week-grid
    return html;
  }

  // 시간이 겹치는 이벤트들을 가로 컬럼으로 분배
  // 반환: Map<id, {col, cols}> — col은 0-based 컬럼 인덱스, cols는 같은 겹침 그룹의 총 컬럼 수
  function computeColumnLayout(events) {
    const result = new Map();
    if (!events || events.length === 0) return result;
    const toMin = t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    // 정렬은 호출자가 이미 했다고 가정 (start_time 오름차순)
    // 1단계: 연결된 겹침 그룹으로 묶기
    const groups = [];
    let cur = [];
    let curEnd = -Infinity;
    for (const ev of events) {
      const s = toMin(ev.start_time);
      const e = toMin(ev.end_time);
      if (cur.length === 0 || s < curEnd) {
        cur.push(ev);
        curEnd = Math.max(curEnd, e);
      } else {
        groups.push(cur);
        cur = [ev];
        curEnd = e;
      }
    }
    if (cur.length > 0) groups.push(cur);

    // 2단계: 그룹 내에서 그리디 컬럼 배정
    for (const group of groups) {
      const colEnds = []; // colEnds[c] = 그 컬럼에 마지막으로 배정된 이벤트의 종료 분
      for (const ev of group) {
        const s = toMin(ev.start_time);
        const e = toMin(ev.end_time);
        let placed = -1;
        for (let c = 0; c < colEnds.length; c++) {
          if (colEnds[c] <= s) {
            colEnds[c] = e;
            placed = c;
            break;
          }
        }
        if (placed === -1) {
          colEnds.push(e);
          placed = colEnds.length - 1;
        }
        result.set(ev.id, { col: placed, cols: 0 });
      }
      // 그룹 전체에 대한 총 컬럼 수를 기록
      const total = colEnds.length;
      for (const ev of group) {
        const r = result.get(ev.id);
        if (r) r.cols = total;
      }
    }
    return result;
  }


  // 일별 뷰: 주별 뷰와 같은 시간 축 그리드 (1일 컬럼)
  function renderDay() {
    const dateStr = ymd(calCursor);
    const events = schedulesByDate(dateStr).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
    const startHour = 6, endHour = 23, hourPx = 50;
    const totalHeight = (endHour - startHour + 1) * hourPx;
    const layout = computeColumnLayout(events);

    let html = '<div class="cal-week-grid cal-day-grid">';
    // 일별은 상단 nav에 '2026년 5월 13일 (수)' 가 이미 나오므로 헤더 행 생략

    // 본문
    html += '<div class="cal-week-body" style="height:' + totalHeight + 'px;">';
    // 시간 축
    html += '<div class="cal-week-times">';
    for (let h = startHour; h <= endHour; h++) {
      const label = h === 0 ? '오전 12시' : (h < 12 ? '오전 ' + String(h).padStart(2, '0') + '시' : (h === 12 ? '오후 12시' : '오후 ' + String(h - 12).padStart(2, '0') + '시'));
      html += `<div class="cal-week-time-slot" style="height:${hourPx}px;">${label}</div>`;
    }
    html += '</div>';

    // 단일 일자 칸
    html += '<div class="cal-week-days cal-day-single">';
    html += `<div class="cal-week-day" data-date="${dateStr}">`;
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
      // 배경은 주별 뷰와 동일하게 홈(소속) 지점 색 — 파견 직원이 자연스럽게 색으로 구분됨
      const c = branchColor(s.user_home_branch_id || s.branch_id);
      const homeName = s.user_home_branch_name || s.branch_name;
      const isDispatch = s.user_home_branch_id != null && s.user_home_branch_id !== s.branch_id;
      const lo = layout.get(s.id) || { col: 0, cols: 1 };
      const widthPct = 100 / lo.cols;
      const leftPct = lo.col * widthPct;
      const titleStr = isDispatch
        ? `[${s.user_home_branch_name}] ${s.user_name} (${s.branch_name} 파견) ${s.start_time}~${s.end_time}`
        : `[${s.branch_name}] ${s.user_name} ${s.start_time}~${s.end_time}`;
      html += `<div class="cal-week-event" data-id="${s.id}" style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px);background:${c.bg};border-color:${c.border};" title="${escapeHtml(titleStr)}">
        <div class="ev-time">${s.start_time}~${s.end_time}${isDispatch ? ' <span class="dispatch-mini">파견</span>' : ''}</div>
        <div class="ev-user">[${escapeHtml(homeName)}] ${escapeHtml(s.user_name)}</div>
        ${s.note ? `<div class="ev-note-line">${escapeHtml(s.note)}</div>` : ''}
      </div>`;
    });
    html += '</div>'; // .cal-week-day
    html += '</div>'; // .cal-week-days
    html += '</div>'; // .cal-week-body
    html += '</div>'; // .cal-week-grid
    return html;
  }

  function bindCalendarEvents() {
    // 월간 셀 클릭 → 해당 날짜 일정 보기 모달
    $$('#schedule-calendar .cal-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.cal-event')) return;
        openDayModal(cell.dataset.date);
      });
    });
    // 월간 이벤트 클릭 → 수정
    $$('#schedule-calendar .cal-event').forEach(ev => {
      ev.addEventListener('click', (e) => {
        e.stopPropagation();
        openScheduleEdit(parseInt(ev.dataset.id));
      });
    });
    // 주간 이벤트 클릭 → 수정
    $$('#schedule-calendar .cal-week-event').forEach(ev => {
      ev.addEventListener('click', (e) => {
        e.stopPropagation();
        openScheduleEdit(parseInt(ev.dataset.id));
      });
    });
    // 주간 빈 칸 클릭 → 해당 날짜에 일정 추가
    $$('#schedule-calendar .cal-week-day').forEach(col => {
      col.addEventListener('click', (e) => {
        if (e.target.closest('.cal-week-event')) return;
        openScheduleAdd(col.dataset.date);
      });
    });
    // 일 뷰 이벤트
    $$('#schedule-calendar .cal-day-event').forEach(ev => {
      ev.addEventListener('click', () => openScheduleEdit(parseInt(ev.dataset.id)));
    });
    const dayAddBtn = $('#btn-cal-day-add');
    if (dayAddBtn) {
      dayAddBtn.addEventListener('click', () => openScheduleAdd(ymd(calCursor)));
    }
  }

  function openDayModal(dateStr) {
    const events = schedulesByDate(dateStr).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
    const [y, m, d] = dateStr.split('-').map(Number);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dow = new Date(y, m - 1, d).getDay();
    $('#modal-day-title').textContent = `${y}년 ${m}월 ${d}일 (${days[dow]}) - 근무 일정`;
    const list = $('#modal-day-list');
    if (events.length === 0) {
      list.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">이 날짜에는 등록된 일정이 없습니다.</p>';
    } else {
      list.innerHTML = events.map(s => {
        const c = branchColor(s.branch_id);
        const homeName = s.user_home_branch_name || s.branch_name;
        const isDispatch = s.user_home_branch_id != null && s.user_home_branch_id !== s.branch_id;
        const homeColor = branchColor(s.user_home_branch_id || s.branch_id);
        return `
        <div class="day-schedule-item" data-id="${s.id}" style="border-left:4px solid ${c.bg};">
          <div class="ds-info">
            <span class="ds-name">
              <span class="ev-branch-tag" style="color:${homeColor.bg};">[${escapeHtml(homeName)}]</span>
              ${escapeHtml(s.user_name)}
              ${isDispatch ? `<span class="dispatch-badge" title="${escapeHtml(s.branch_name)}으로 파견">파견 → ${escapeHtml(s.branch_name)}</span>` : ''}
            </span>
            <span class="ds-time">${s.start_time} ~ ${s.end_time}</span>
            ${s.note ? `<span class="ds-branch">${escapeHtml(s.note)}</span>` : ''}
          </div>
          <button class="btn btn-outline btn-sm">수정</button>
        </div>`;
      }).join('');
      list.querySelectorAll('.day-schedule-item').forEach(it => {
        it.addEventListener('click', () => {
          $('#modal-day-schedules').classList.remove('active');
          openScheduleEdit(parseInt(it.dataset.id));
        });
      });
    }
    $('#btn-day-add').onclick = () => {
      $('#modal-day-schedules').classList.remove('active');
      openScheduleAdd(dateStr);
    };
    $('#modal-day-schedules').classList.add('active');
  }

  // 직원 드롭다운: '현재 지점 직원' optgroup + '다른 지점 직원' optgroup
  // currentBranchId: 일정 모달의 '근무 지점' 셀렉트에서 선택된 지점 id (없으면 calBranchFilter fallback)
  function fillUserSelect(currentBranchId) {
    const sel = $('#schedule-user');
    const targetBid = currentBranchId != null
      ? parseInt(currentBranchId)
      : (calBranchFilter ? parseInt(calBranchFilter) : null);

    let html = '<option value="">선택</option>';

    if (targetBid != null) {
      const inBranch = allUsers.filter(u => u.branch_id === targetBid);
      const others = allUsers.filter(u => u.branch_id !== targetBid);
      const branchName = (branches.find(b => b.id === targetBid) || {}).name || '현재 지점';

      if (inBranch.length > 0) {
        html += `<optgroup label="${escapeHtml(branchName)} 직원">`;
        inBranch.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(u => {
          html += `<option value="${u.id}">${escapeHtml(u.name)}</option>`;
        });
        html += `</optgroup>`;
      }
      if (others.length > 0) {
        html += `<optgroup label="다른 지점 직원 (관리자/파견 포함)">`;
        others.sort((a, b) => {
          const bc = (a.branch_name || '').localeCompare(b.branch_name || '');
          return bc !== 0 ? bc : (a.name || '').localeCompare(b.name || '');
        }).forEach(u => {
          html += `<option value="${u.id}">[${escapeHtml(u.branch_name)}] ${escapeHtml(u.name)}</option>`;
        });
        html += `</optgroup>`;
      }
    } else {
      const sorted = allUsers.slice().sort((a, b) => {
        const bc = (a.branch_name || '').localeCompare(b.branch_name || '');
        return bc !== 0 ? bc : (a.name || '').localeCompare(b.name || '');
      });
      sorted.forEach(u => {
        html += `<option value="${u.id}">[${escapeHtml(u.branch_name)}] ${escapeHtml(u.name)}</option>`;
      });
    }
    sel.innerHTML = html;
  }

  // 일정 모달의 '근무 지점' 셀렉트 옵션 채우기 (본사 제외)
  function fillScheduleBranchSelect(selectedId) {
    const sel = $('#schedule-branch');
    const real = branches.filter(b => b.name !== '본사').slice().sort((a, b) => a.id - b.id);
    sel.innerHTML = real.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    // innerHTML 의 selected attribute 가 즉시 .value 에 반영되지 않는 경우를 대비해 명시적으로 설정
    if (selectedId != null && real.find(b => String(b.id) === String(selectedId))) {
      sel.value = String(selectedId);
    } else if (real.length > 0) {
      sel.value = String(real[0].id);
    }
  }

  function openScheduleAdd(dateStr) {
    // 기본 지점: 현재 탭 필터의 지점(없으면 첫 번째 실제 지점)
    const real = branches.filter(b => b.name !== '본사').slice().sort((a, b) => a.id - b.id);
    const defaultBid = calBranchFilter ? parseInt(calBranchFilter) : (real[0] ? real[0].id : null);
    fillScheduleBranchSelect(defaultBid);
    fillUserSelect(defaultBid);

    $('#modal-schedule-title').textContent = '근무 일정 추가';
    $('#schedule-edit-id').value = '';
    $('#schedule-user').value = '';
    $('#schedule-user').disabled = false;
    $('#schedule-date').value = dateStr || ymd(new Date());
    $('#schedule-start').value = '09:00';
    $('#schedule-end').value = '18:00';
    $('#schedule-note').value = '';
    $('#btn-delete-schedule').style.display = 'none';
    $('#modal-schedule').classList.add('active');
  }

  function openScheduleEdit(id) {
    const s = calSchedules.find(x => x.id === id);
    if (!s) return;
    fillScheduleBranchSelect(s.branch_id);
    fillUserSelect(s.branch_id);

    $('#modal-schedule-title').textContent = '근무 일정 수정';
    $('#schedule-edit-id').value = id;
    $('#schedule-user').value = s.user_id;
    $('#schedule-user').disabled = false;
    $('#schedule-date').value = s.work_date;
    $('#schedule-start').value = s.start_time;
    $('#schedule-end').value = s.end_time;
    $('#schedule-note').value = s.note || '';
    $('#btn-delete-schedule').style.display = 'inline-block';
    $('#modal-schedule').classList.add('active');
  }

  // 모달 바깥 클릭 닫기
  $('#modal-schedule').addEventListener('click', (e) => {
    if (e.target === $('#modal-schedule')) $('#modal-schedule').classList.remove('active');
  });
  $('#modal-day-schedules').addEventListener('click', (e) => {
    if (e.target === $('#modal-day-schedules')) $('#modal-day-schedules').classList.remove('active');
  });

  // 일정 모달의 지점 셀렉트 변경 시 직원 목록 갱신
  $('#schedule-branch').addEventListener('change', () => {
    const bid = $('#schedule-branch').value;
    const currentUser = $('#schedule-user').value;
    fillUserSelect(bid);
    // 직전 선택한 직원이 새 목록에도 있으면 유지
    if (currentUser && $('#schedule-user').querySelector(`option[value="${currentUser}"]`)) {
      $('#schedule-user').value = currentUser;
    }
  });

  // 일정 저장
  $('#form-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = $('#schedule-edit-id').value;
    const branchVal = $('#schedule-branch').value;
    const parsedBranch = parseInt(branchVal);
    const payload = {
      userId: $('#schedule-user').value,
      branchId: Number.isFinite(parsedBranch) ? parsedBranch : null,
      workDate: $('#schedule-date').value,
      startTime: $('#schedule-start').value,
      endTime: $('#schedule-end').value,
      note: $('#schedule-note').value.trim()
    };
    if (!payload.userId) { showToast('직원을 선택해주세요.', 'error'); return; }
    if (!payload.branchId || !Number.isFinite(payload.branchId)) {
      showToast('근무 지점을 선택해주세요.', 'error'); return;
    }

    try {
      let resp;
      if (editId) {
        resp = await apiFetch(`/admin/schedules/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('근무 일정이 수정되었습니다.', 'success');
      } else {
        resp = await apiFetch('/admin/schedules', { method: 'POST', body: JSON.stringify(payload) });
        showToast('근무 일정이 등록되었습니다.', 'success');
      }
      // 시간 겹침 경고 안내
      if (resp && resp.warning) {
        setTimeout(() => showToast('⚠️ ' + resp.warning, 'info'), 600);
      }
      $('#modal-schedule').classList.remove('active');
      await reloadCalSchedules();
      renderCalendar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 일정 삭제
  $('#btn-delete-schedule').addEventListener('click', async () => {
    const editId = $('#schedule-edit-id').value;
    if (!editId) return;
    if (!confirm('이 근무 일정을 삭제하시겠습니까?')) return;
    try {
      await apiFetch(`/admin/schedules/${editId}`, { method: 'DELETE' });
      showToast('근무 일정이 삭제되었습니다.', 'success');
      $('#modal-schedule').classList.remove('active');
      await reloadCalSchedules();
      renderCalendar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // 캘린더 컨트롤
  $('#btn-cal-prev').addEventListener('click', async () => {
    if (calView === 'month') calCursor.setMonth(calCursor.getMonth() - 1);
    else if (calView === 'week') calCursor = addDays(calCursor, -7);
    else calCursor = addDays(calCursor, -1);
    await reloadCalSchedules();
    renderCalendar();
  });

  $('#btn-cal-next').addEventListener('click', async () => {
    if (calView === 'month') calCursor.setMonth(calCursor.getMonth() + 1);
    else if (calView === 'week') calCursor = addDays(calCursor, 7);
    else calCursor = addDays(calCursor, 1);
    await reloadCalSchedules();
    renderCalendar();
  });

  $('#btn-cal-today').addEventListener('click', async () => {
    calCursor = new Date();
    await reloadCalSchedules();
    renderCalendar();
  });

  $$('.view-btn').forEach(b => {
    b.addEventListener('click', async () => {
      calView = b.dataset.view;
      await reloadCalSchedules();
      renderCalendar();
    });
  });

  $('#btn-add-schedule').addEventListener('click', () => {
    if (allUsers.length === 0) {
      apiFetch('/admin/users').then(r => {
        allUsers = r.users.filter(u => u.is_active);
        openScheduleAdd();
      });
    } else {
      openScheduleAdd();
    }
  });

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
// EOF
