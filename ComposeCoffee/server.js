const express = require('express');
const path = require('path');
const config = require('./config');
const { initDatabase } = require('./database');

async function startServer() {
  // DB 초기화 (비동기)
  const db = await initDatabase();

  // db를 글로벌로 공유
  global.db = db;

  const authRoutes = require('./routes/auth');
  const attendanceRoutes = require('./routes/attendance');
  const adminRoutes = require('./routes/admin');

  const app = express();

  // 미들웨어
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 정적 파일 서빙
  app.use(express.static(path.join(__dirname, 'public')));

  // API 라우트
  app.use('/api/auth', authRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/admin', adminRoutes);

  // SPA 라우팅 - 모든 비-API 요청은 index.html로
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  // 서버 시작
  app.listen(config.PORT, config.HOST, () => {
    console.log('='.repeat(50));
    console.log('  ComposeCoffee 출퇴근 관리 시스템');
    console.log(`  서버 주소: http://localhost:${config.PORT}`);
    console.log(`  관리자 페이지: http://localhost:${config.PORT}/admin.html`);
    console.log('='.repeat(50));
  });
}

startServer().catch(err => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
