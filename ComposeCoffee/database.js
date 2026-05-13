const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db = null;

function saveDb() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(config.DB_PATH, Buffer.from(data));
  }
}
setInterval(saveDb, 30000);

class DbWrapper {
  constructor(sqlDb) { this.db = sqlDb; }
  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self.db.run(sql, params);
        const lastId = self.db.exec('SELECT last_insert_rowid() as id')[0];
        saveDb();
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
  exec(sql) { this.db.run(sql); saveDb(); }
  pragma(sql) { this.db.run('PRAGMA ' + sql); }
  transaction(fn) {
    return (...args) => {
      this.db.run('BEGIN TRANSACTION');
      try { const r = fn(...args); this.db.run('COMMIT'); saveDb(); return r; }
      catch (e) { this.db.run('ROLLBACK'); throw e; }
    };
  }
}

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(config.DB_PATH)) {
    const buffer = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  const wrapper = new DbWrapper(db);
  wrapper.pragma('journal_mode = WAL');
  wrapper.pragma('foreign_keys = ON');

  db.run('CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, address TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, radius_meters INTEGER DEFAULT ' + config.DEFAULT_RADIUS_METERS + ', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin', 'staff')), branch_id INTEGER NOT NULL, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (branch_id) REFERENCES branches(id))");
  db.run("CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, branch_id INTEGER NOT NULL, check_type TEXT NOT NULL CHECK(check_type IN ('in', 'out')), check_time DATETIME DEFAULT CURRENT_TIMESTAMP, latitude REAL, longitude REAL, distance_meters REAL, is_valid_location INTEGER DEFAULT 1, note TEXT, user_note TEXT, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (branch_id) REFERENCES branches(id))");
  try { db.run('ALTER TABLE attendance ADD COLUMN user_note TEXT'); } catch (e) {}

  db.run("CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, branch_id INTEGER NOT NULL, work_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, note TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, work_date, start_time), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (branch_id) REFERENCES branches(id))");

  try {
    const schemaRow = wrapper.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='schedules'").get();
    if (schemaRow && schemaRow.sql && /UNIQUE\s*\(\s*user_id\s*,\s*work_date\s*\)/i.test(schemaRow.sql) && !/start_time/.test(schemaRow.sql.match(/UNIQUE[^)]+\)/i)[0])) {
      db.run('ALTER TABLE schedules RENAME TO schedules_old_unique_date');
      db.run("CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, branch_id INTEGER NOT NULL, work_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, note TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, work_date, start_time), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (branch_id) REFERENCES branches(id))");
      db.run('INSERT INTO schedules SELECT * FROM schedules_old_unique_date');
      db.run('DROP TABLE schedules_old_unique_date');
    }
  } catch (e) { console.warn('schedules migration:', e.message); }

  const hq = wrapper.prepare("SELECT id FROM branches WHERE name = '본사'").get();
  if (!hq) db.run("INSERT INTO branches (name, address, latitude, longitude, radius_meters) VALUES ('본사', '관리자 전용', 0, 0, 0)");

  db.run('CREATE INDEX IF NOT EXISTS idx_attendance_user_time ON attendance(user_id, check_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_attendance_branch_time ON attendance(branch_id, check_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(work_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_schedules_user_date ON schedules(user_id, work_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_schedules_branch_date ON schedules(branch_id, work_date)');

  saveDb();
  return wrapper;
}

process.on('exit', saveDb);
process.on('SIGINT', () => { saveDb(); process.exit(); });
process.on('SIGTERM', () => { saveDb(); process.exit(); });

module.exports = { initDatabase };
