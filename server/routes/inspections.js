const express = require('express');
const router = express.Router();
const db = require('../db');

// lot_no 자동 생성
function generateLotNo(partNo, year) {
  const count = db.prepare(`
    SELECT COUNT(*) as cnt FROM inspections i
    JOIN parts p ON i.part_id = p.part_id
    WHERE p.part_no = ? AND strftime('%Y', i.incoming_date) = ?
  `).get(partNo, String(year)).cnt;
  const seq = String(count + 1).padStart(3, '0');
  return `${partNo}-${year}-${seq}`;
}

// GET /api/inspections — 전체 (복합 필터)
router.get('/', (req, res) => {
  try {
    const { part_id, start_date, end_date, result } = req.query;
    let sql = `
      SELECT i.*, p.part_no, p.part_name, s.supplier_name,
        (SELECT GROUP_CONCAT(dtc.defect_type_name, ', ')
         FROM defect_details dd
         JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
         WHERE dd.inspection_id = i.inspection_id) as defect_types
      FROM inspections i
      JOIN parts p ON i.part_id = p.part_id
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE 1=1
    `;
    const params = [];
    if (part_id) {
      sql += ' AND i.part_id = ?';
      params.push(part_id);
    }
    if (start_date) {
      sql += ' AND i.incoming_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      sql += ' AND i.incoming_date <= ?';
      params.push(end_date);
    }
    if (result) {
      sql += ' AND i.result = ?';
      params.push(result);
    }
    sql += ' ORDER BY i.incoming_date DESC, i.inspection_id DESC';
    const inspections = db.prepare(sql).all(...params);
    res.json(inspections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inspections — 등록
router.post('/', (req, res) => {
  try {
    const { part_id, incoming_date, incoming_qty, inspect_qty, defect_qty, result, inspector_name, notes } = req.body;
    if (!part_id || !incoming_date || !incoming_qty || !inspect_qty) {
      return res.status(400).json({ error: '필수 항목이 누락되었습니다' });
    }
    const part = db.prepare('SELECT * FROM parts WHERE part_id = ?').get(part_id);
    if (!part) return res.status(404).json({ error: '부품을 찾을 수 없습니다' });

    const year = new Date(incoming_date).getFullYear();
    const lot_no = generateLotNo(part.part_no, year);

    const ins = db.prepare(`
      INSERT INTO inspections (part_id, lot_no, incoming_date, incoming_qty, inspect_qty, defect_qty, result, inspector_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(part_id, lot_no, incoming_date, incoming_qty, inspect_qty, defect_qty || 0, result || '합격', inspector_name || null, notes || null);

    const newInspection = db.prepare(`
      SELECT i.*, p.part_no, p.part_name FROM inspections i
      JOIN parts p ON i.part_id = p.part_id
      WHERE i.inspection_id = ?
    `).get(ins.lastInsertRowid);
    res.status(201).json(newInspection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inspections/:id — 단건 (defect_details JOIN)
router.get('/:id', (req, res) => {
  try {
    const inspection = db.prepare(`
      SELECT i.*, p.part_no, p.part_name, s.supplier_name
      FROM inspections i
      JOIN parts p ON i.part_id = p.part_id
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE i.inspection_id = ?
    `).get(req.params.id);
    if (!inspection) return res.status(404).json({ error: '검사 이력을 찾을 수 없습니다' });

    const defects = db.prepare(`
      SELECT dd.*, dtc.defect_type_name, dtc.category
      FROM defect_details dd
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE dd.inspection_id = ?
    `).all(req.params.id);

    res.json({ ...inspection, defects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users
router.get('/users/all', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY user_id').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
router.post('/users', (req, res) => {
  try {
    const { username, name, role, email } = req.body;
    if (!username || !name) return res.status(400).json({ error: '사용자명과 이름은 필수입니다' });
    const result = db.prepare(`
      INSERT INTO users (username, name, role, email) VALUES (?, ?, ?, ?)
    `).run(username, name, role || 'ROLE_INSPECTOR', email || null);
    const newUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(result.lastInsertRowid);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '이미 존재하는 사용자명입니다' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id
router.put('/users/:id', (req, res) => {
  try {
    const { name, role, email, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
    db.prepare(`
      UPDATE users SET name = ?, role = ?, email = ?, is_active = ? WHERE user_id = ?
    `).run(
      name ?? existing.name,
      role ?? existing.role,
      email ?? existing.email,
      is_active ?? existing.is_active,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alert-settings
router.get('/alert-settings/current', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/alert-settings
router.put('/alert-settings', (req, res) => {
  try {
    const { consecutive_defect_threshold, defect_rate_warning, defect_rate_danger } = req.body;
    const existing = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    db.prepare(`
      UPDATE alert_settings
      SET consecutive_defect_threshold = ?, defect_rate_warning = ?, defect_rate_danger = ?
      WHERE id = 1
    `).run(
      consecutive_defect_threshold ?? existing.consecutive_defect_threshold,
      defect_rate_warning ?? existing.defect_rate_warning,
      defect_rate_danger ?? existing.defect_rate_danger
    );
    const updated = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
