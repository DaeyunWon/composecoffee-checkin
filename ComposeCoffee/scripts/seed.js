/**
 * ComposeCoffee 초기 데이터 생성 스크립트
 * 사용법: npm run seed
 */

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initDatabase } = require('../database');

async function seed() {
  console.log('=== ComposeCoffee 초기 데이터 생성 ===\n');

  const db = await initDatabase();

  // 1. 지점 생성
  console.log('📍 지점 생성 중...');

  db.prepare(
    'INSERT OR IGNORE INTO branches (name, address, latitude, longitude, radius_meters) VALUES (?, ?, ?, ?, ?)'
  ).run('강남점', '서울시 강남구 역삼동 123-45', 37.4979, 127.0276, 50);

  db.prepare(
    'INSERT OR IGNORE INTO branches (name, address, latitude, longitude, radius_meters) VALUES (?, ?, ?, ?, ?)'
  ).run('홍대점', '서울시 마포구 서교동 456-78', 37.5563, 126.9236, 50);

  const branches = db.prepare('SELECT * FROM branches').all();
  branches.forEach(b => console.log(`  ✅ ${b.name} (ID: ${b.id}, 좌표: ${b.latitude}, ${b.longitude}, 반경: ${b.radius_meters}m)`));

  // 2. 관리자 계정 (본사 소속)
  console.log('\n👤 관리자 계정 생성 중...');
  const hqBranch = db.prepare("SELECT id FROM branches WHERE name = '본사'").get();
  const existingAdmin = db.prepare("SELECT id FROM users WHERE login_id = 'admin'").get();
  if (!existingAdmin) {
    const adminId = uuidv4();
    const adminPw = bcrypt.hashSync('admin123', 12);
    db.prepare(
      'INSERT INTO users (id, login_id, password_hash, name, phone, role, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(adminId, 'admin', adminPw, '관리자', '010-0000-0000', 'admin', hqBranch.id);
    console.log('  ✅ 관리자 - ID: admin / PW: admin123 (소속: 본사)');
  } else {
    // 기존 관리자도 본사로 이동
    db.prepare("UPDATE users SET branch_id = ? WHERE login_id = 'admin' AND role = 'admin'").run(hqBranch.id);
    console.log('  ⏭️ 관리자 계정이 이미 존재합니다. (본사로 업데이트)');
  }

  // 3. 직원 계정
  console.log('\n👥 직원 계정 생성 중...');
  const staffMembers = [
    { loginId: 'staff01', name: '김민준', phone: '010-1111-1111', branchId: branches[0].id },
    { loginId: 'staff02', name: '이서연', phone: '010-2222-2222', branchId: branches[0].id },
    { loginId: 'staff03', name: '박지훈', phone: '010-3333-3333', branchId: branches[1]?.id || branches[0].id },
    { loginId: 'staff04', name: '최수빈', phone: '010-4444-4444', branchId: branches[1]?.id || branches[0].id },
  ];

  staffMembers.forEach(s => {
    const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(s.loginId);
    if (!existing) {
      const id = uuidv4();
      const pw = bcrypt.hashSync('pass1234', 12);
      db.prepare(
        'INSERT INTO users (id, login_id, password_hash, name, phone, role, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, s.loginId, pw, s.name, s.phone, 'staff', s.branchId);
      console.log(`  ✅ ${s.name} - ID: ${s.loginId} / PW: pass1234`);
    } else {
      console.log(`  ⏭️ ${s.name} 계정이 이미 존재합니다.`);
    }
  });

  console.log('\n✨ 초기 데이터 생성이 완료되었습니다!');
  console.log('\n=== 로그인 정보 ===');
  console.log('관리자: admin / admin123');
  console.log('직원:   staff01~04 / pass1234');
  console.log('\n관리자 페이지: http://localhost:3000/admin.html');
  console.log('직원 출퇴근:  http://localhost:3000/');
}

seed().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
