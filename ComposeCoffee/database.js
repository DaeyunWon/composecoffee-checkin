const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// data 디렉토리 생성
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;

// DB를 파일로 저장
function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.DB_PATH, buffer);
  }
}

// 주기적 자동 저장 (30초)
setInterval(saveDb, 30000);

// sql.js wrapper - better-sqlite3와 유사한 인터페이스 제공
class DbWrapper {
  constructor(sqlDb) {
    this.db = sqlDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self.db.run(sql, params);
        saveDb();
        const lastId = self.db.exec('SELECT last_insert_rowid() as id')[0];
        return { lastInsertRowid: lastId ? lastId.values[0][0] : 0 };
      },
      get(...params) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this.db.run(sql);
    saveDb();
  }

  pragma(sql) {
    this.db.run(`PRAGMA ${sql}`);
  }

  transaction(fn) {
    return (...args) => {
      this.db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        this.db.run('COMMIT');
        saveDb();
        return result;
      } catch (err) {
        this.db.run('ROLLBACK');
        throw err;
      }
    };
  }
}

async function initDatabase() {
  const SQL = await initSqlJs();

  // 기존 DB 파일이 있으면 로드
  if (fs.existsSync(config.DB_PATH)) {
    const buffer = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const wrapper = new DbWrapper(db);

  wrapper.pragma('journal_mode = WAL');
  wrapper.pragma('foreign_keys = ON');

  // 테이블 생성
  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER DEFAULT ${config.DEFAULT_RADIUS_METERS},
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
      branch_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      branch_id INTEGER NOT NULL,
      check_type TEXT NOT NULL CHECK(check_type IN ('in', 'out')),
      check_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      latitude REAL,
      longitude REAL,
      distance_meters REAL,
      is_valid_location INTEGER DEFAULT 1,
      note TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )
  `);

  // 인덱스 (IF NOT EXISTS로 안전하게)
  db.run('CREATE INDEX IF NOT EXISTS idx_attendance_user_time ON attendance(user_id, check_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_attendance_branch_time ON attendance(branch_id, check_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_id)');

  saveDb();

  return wrapper;
}

// 프로세스 종료 시 저장
process.on('exit', saveDb);
process.on('SIGINT', () => { saveDb(); process.exit(); });
process.on('SIGTERM', () => { saveDb(); process.exit(); });

module.exports = { initDatabase };
