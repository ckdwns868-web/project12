const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/parts — 전체 조회 (supplier JOIN, 필터)
router.get('/', (req, res) => {
  try {
    const { search, category, grade } = req.query;
    let sql = `
      SELECT p.*, s.supplier_name
      FROM parts p
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE p.is_active = 1
    `;
    const params = [];
    if (search) {
      sql += ' AND (p.part_no LIKE ? OR p.part_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    if (grade) {
      sql += ' AND p.quality_grade = ?';
      params.push(grade);
    }
    sql += ' ORDER BY p.created_at DESC';
    const parts = db.prepare(sql).all(...params);
    res.json(parts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parts/:id — 단건
router.get('/:id', (req, res) => {
  try {
    const part = db.prepare(`
      SELECT p.*, s.supplier_name
      FROM parts p
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE p.part_id = ?
    `).get(req.params.id);
    if (!part) return res.status(404).json({ error: '부품을 찾을 수 없습니다' });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/parts — 등록
router.post('/', (req, res) => {
  try {
    const { part_no, part_name, supplier_id, category, quality_grade } = req.body;
    if (!part_no || !part_name) {
      return res.status(400).json({ error: '부품번호와 부품명은 필수입니다' });
    }
    const result = db.prepare(`
      INSERT INTO parts (part_no, part_name, supplier_id, category, quality_grade)
      VALUES (?, ?, ?, ?, ?)
    `).run(part_no, part_name, supplier_id || null, category || null, quality_grade || 'A');
    const newPart = db.prepare('SELECT * FROM parts WHERE part_id = ?').get(result.lastInsertRowid);
    res.status(201).json(newPart);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 존재하는 부품번호입니다' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/parts/:id — 수정
router.put('/:id', (req, res) => {
  try {
    const { part_name, supplier_id, category, quality_grade, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM parts WHERE part_id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '부품을 찾을 수 없습니다' });

    db.prepare(`
      UPDATE parts
      SET part_name = ?, supplier_id = ?, category = ?, quality_grade = ?, is_active = ?, updated_at = datetime('now','localtime')
      WHERE part_id = ?
    `).run(
      part_name ?? existing.part_name,
      supplier_id ?? existing.supplier_id,
      category ?? existing.category,
      quality_grade ?? existing.quality_grade,
      is_active ?? existing.is_active,
      req.params.id
    );
    const updated = db.prepare(`
      SELECT p.*, s.supplier_name FROM parts p
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE p.part_id = ?
    `).get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parts/:id/history — 해당 부품의 검사 이력 목록 (defect_details JOIN)
router.get('/:id/history', (req, res) => {
  try {
    const inspections = db.prepare(`
      SELECT i.*,
        GROUP_CONCAT(dtc.defect_type_name, ', ') as defect_types
      FROM inspections i
      LEFT JOIN defect_details dd ON i.inspection_id = dd.inspection_id
      LEFT JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE i.part_id = ?
      GROUP BY i.inspection_id
      ORDER BY i.incoming_date DESC
    `).all(req.params.id);
    res.json(inspections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defect-codes — 불량 유형 코드 전체
router.get('/defect-codes/all', (req, res) => {
  try {
    const codes = db.prepare('SELECT * FROM defect_type_codes ORDER BY defect_type_code').all();
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers — 공급사 목록
router.get('/suppliers/all', (req, res) => {
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY supplier_id').all();
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
