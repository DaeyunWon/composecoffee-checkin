const express = require('express');
const path = require('path');
const config = require('./config');
const { initDatabase } = require('./database');

async function startServer() {
  const db = await initDatabase();
  global.db = db;

  const authRoutes = require('./routes/auth');
  const attendanceRoutes = require('./routes/attendance');
  const adminRoutes = require('./routes/admin');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  app.get('/api/branch/:id/info', (req, res) => {
    const branch = db.prepare('SELECT id, name, latitude, longitude, radius_meters FROM branches WHERE id = ?').get(parseInt(req.params.id));
    if (!branch) return res.status(404).json({ error: '지점을 찾을 수 없습니다.' });
    res.json(branch);
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  app.listen(config.PORT, config.HOST, () => {
    console.log('='.repeat(50));
    console.log('  ComposeCoffee 출퇴근 관리 시스템');
    console.log('  서버 주소: http://localhost:' + config.PORT);
    console.log('  관리자 페이지: http://localhost:' + config.PORT + '/admin.html');
    console.log('='.repeat(50));
  });
}

startServer().catch(err => { console.error('서버 시작 실패:', err); process.exit(1); });
