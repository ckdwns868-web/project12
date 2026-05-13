const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'quality.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL,
    contact TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS parts (
    part_id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_no TEXT UNIQUE NOT NULL,
    part_name TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(supplier_id),
    category TEXT,
    quality_grade TEXT DEFAULT 'A',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS defect_type_codes (
    defect_type_code TEXT PRIMARY KEY,
    defect_type_name TEXT NOT NULL,
    category TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS inspections (
    inspection_id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER NOT NULL REFERENCES parts(part_id),
    lot_no TEXT NOT NULL,
    incoming_date TEXT NOT NULL,
    incoming_qty INTEGER NOT NULL,
    inspect_qty INTEGER NOT NULL,
    defect_qty INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL DEFAULT '합격',
    inspector_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS defect_details (
    defect_id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id INTEGER NOT NULL REFERENCES inspections(inspection_id),
    defect_type_code TEXT NOT NULL,
    defect_count INTEGER NOT NULL DEFAULT 1,
    defect_description TEXT,
    action_code TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ROLE_INSPECTOR',
    email TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS alert_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    consecutive_defect_threshold INTEGER DEFAULT 3,
    defect_rate_warning REAL DEFAULT 0.05,
    defect_rate_danger REAL DEFAULT 0.10
  );
`);

// Seed 데이터 삽입
function seedData() {
  const supplierCount = db.prepare('SELECT COUNT(*) as cnt FROM suppliers').get().cnt;
  if (supplierCount > 0) return;

  // 공급사
  const insertSupplier = db.prepare('INSERT INTO suppliers (supplier_name, contact) VALUES (?, ?)');
  insertSupplier.run('OO정밀', '010-1234-5678');
  insertSupplier.run('AA금속', '010-2345-6789');
  insertSupplier.run('BB전자', '010-3456-7890');

  // 부품
  const insertPart = db.prepare('INSERT INTO parts (part_no, part_name, supplier_id, category, quality_grade) VALUES (?, ?, ?, ?, ?)');
  insertPart.run('P-20341', '브라켓 A형', 1, '기구부품', 'B');
  insertPart.run('P-10022', '샤프트 B', 2, '금속부품', 'A');
  insertPart.run('P-30156', '커버 플레이트', 3, '전장부품', 'C');
  insertPart.run('P-40089', '볼트 세트', 1, '기구부품', 'A');
  insertPart.run('P-50213', '스프링 C', 2, '금속부품', 'B');

  // 불량 유형 코드
  const insertCode = db.prepare('INSERT INTO defect_type_codes (defect_type_code, defect_type_name, category) VALUES (?, ?, ?)');
  insertCode.run('D001', '치수 불량', '치수');
  insertCode.run('D002', '외관 스크래치', '외관');
  insertCode.run('D003', '외관 찍힘', '외관');
  insertCode.run('D004', '외관 녹/부식', '외관');
  insertCode.run('D005', '재질 불량', '재질');
  insertCode.run('D006', '용접 불량', '용접');
  insertCode.run('D007', '도금 불량', '표면처리');
  insertCode.run('D008', '조립 불량', '조립');
  insertCode.run('D009', '기능 불량', '기능');
  insertCode.run('D010', '포장 불량', '포장');
  insertCode.run('D011', '이물 혼입', '이물');
  insertCode.run('D012', '수량 부족', '수량');
  insertCode.run('D099', '기타', '기타');

  // 사용자
  const insertUser = db.prepare('INSERT INTO users (username, name, role, email) VALUES (?, ?, ?, ?)');
  insertUser.run('admin', '관리자', 'ROLE_ADMIN', 'admin@quality.com');
  insertUser.run('qc1', '품질담당자', 'ROLE_QC', 'qc1@quality.com');
  insertUser.run('inspector1', '검사원1', 'ROLE_INSPECTOR', 'inspector1@quality.com');

  // alert_settings
  db.prepare('INSERT OR IGNORE INTO alert_settings (id, consecutive_defect_threshold, defect_rate_warning, defect_rate_danger) VALUES (1, 3, 0.05, 0.10)').run();

  // 검사 이력 (10건 이상, 불량 포함)
  const insertInspection = db.prepare(`
    INSERT INTO inspections (part_id, lot_no, incoming_date, incoming_qty, inspect_qty, defect_qty, result, inspector_name, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDefect = db.prepare(`
    INSERT INTO defect_details (inspection_id, defect_type_code, defect_count, defect_description, action_code)
    VALUES (?, ?, ?, ?, ?)
  `);

  // P-20341 검사 이력 (part_id=1)
  let ins;
  ins = insertInspection.run(1, 'P-20341-2025-001', '2025-03-10', 500, 50, 3, '불합격', 'inspector1', '치수 불량 발생');
  insertDefect.run(ins.lastInsertRowid, 'D001', 3, '길이 +0.3mm 초과', '전량반품');

  ins = insertInspection.run(1, 'P-20341-2025-002', '2025-04-05', 500, 50, 2, '특채', 'inspector1', '외관 스크래치');
  insertDefect.run(ins.lastInsertRowid, 'D002', 2, '표면 미세 스크래치', '선별후사용');

  ins = insertInspection.run(1, 'P-20341-2025-003', '2025-04-20', 500, 50, 0, '합격', 'qc1', null);

  ins = insertInspection.run(1, 'P-20341-2025-004', '2025-05-02', 500, 50, 4, '불합격', 'inspector1', '치수 재불량');
  insertDefect.run(ins.lastInsertRowid, 'D001', 2, '폭 불량', '전량반품');
  insertDefect.run(ins.lastInsertRowid, 'D002', 2, '외관 흠집', '전량반품');

  ins = insertInspection.run(1, 'P-20341-2025-005', '2025-05-10', 300, 30, 5, '불합격', 'qc1', '3연속 불량 발생');
  insertDefect.run(ins.lastInsertRowid, 'D001', 3, '치수 반복불량', '전량반품');
  insertDefect.run(ins.lastInsertRowid, 'D003', 2, '찍힘 불량', '전량반품');

  // P-10022 검사 이력 (part_id=2)
  ins = insertInspection.run(2, 'P-10022-2025-001', '2025-02-15', 200, 20, 0, '합격', 'inspector1', null);

  ins = insertInspection.run(2, 'P-10022-2025-002', '2025-03-20', 200, 20, 1, '특채', 'qc1', '경미한 외관 불량');
  insertDefect.run(ins.lastInsertRowid, 'D002', 1, '표면 긁힘', '선별후사용');

  ins = insertInspection.run(2, 'P-10022-2025-003', '2025-04-25', 200, 20, 0, '합격', 'inspector1', null);

  // P-30156 검사 이력 (part_id=3)
  ins = insertInspection.run(3, 'P-30156-2025-001', '2025-03-01', 300, 30, 5, '불합격', 'qc1', '용접 불량 다수');
  insertDefect.run(ins.lastInsertRowid, 'D006', 3, '용접 기공 발생', '전량반품');
  insertDefect.run(ins.lastInsertRowid, 'D007', 2, '도금 박리', '전량반품');

  ins = insertInspection.run(3, 'P-30156-2025-002', '2025-04-10', 300, 30, 8, '불합격', 'inspector1', '용접 불량 재발');
  insertDefect.run(ins.lastInsertRowid, 'D006', 5, '용접 크랙', '전량반품');
  insertDefect.run(ins.lastInsertRowid, 'D009', 3, '기능 테스트 불합격', '폐기');

  ins = insertInspection.run(3, 'P-30156-2025-003', '2025-05-05', 300, 30, 3, '불합격', 'qc1', '용접 개선 미흡');
  insertDefect.run(ins.lastInsertRowid, 'D006', 3, '용접 불량 지속', '전량반품');

  // P-40089 검사 이력 (part_id=4)
  ins = insertInspection.run(4, 'P-40089-2025-001', '2025-04-01', 1000, 100, 0, '합격', 'inspector1', null);
  ins = insertInspection.run(4, 'P-40089-2025-002', '2025-05-01', 1000, 100, 2, '특채', 'qc1', '수량 부족 일부');
  insertDefect.run(ins.lastInsertRowid, 'D012', 2, '박스당 2개 부족', '선별후사용');

  // P-50213 검사 이력 (part_id=5)
  ins = insertInspection.run(5, 'P-50213-2025-001', '2025-03-15', 500, 50, 1, '특채', 'inspector1', '재질 일부 미달');
  insertDefect.run(ins.lastInsertRowid, 'D005', 1, '경도 미달', '선별후사용');

  ins = insertInspection.run(5, 'P-50213-2025-002', '2025-04-20', 500, 50, 0, '합격', 'inspector1', null);
  ins = insertInspection.run(5, 'P-50213-2025-003', '2025-05-08', 500, 50, 0, '합격', 'qc1', null);

  console.log('Seed data inserted successfully');
}

seedData();

module.exports = db;
