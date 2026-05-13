const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/defects — 불량 상세 등록
router.post('/', (req, res) => {
  try {
    const { inspection_id, defect_type_code, defect_count, defect_description, action_code } = req.body;
    if (!inspection_id || !defect_type_code) {
      return res.status(400).json({ error: '검사 ID와 불량 유형 코드는 필수입니다' });
    }
    const result = db.prepare(`
      INSERT INTO defect_details (inspection_id, defect_type_code, defect_count, defect_description, action_code)
      VALUES (?, ?, ?, ?, ?)
    `).run(inspection_id, defect_type_code, defect_count || 1, defect_description || null, action_code || null);

    const newDefect = db.prepare(`
      SELECT dd.*, dtc.defect_type_name, dtc.category
      FROM defect_details dd
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE dd.defect_id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(newDefect);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/defects/batch — 여러 불량 상세 일괄 등록
router.post('/batch', (req, res) => {
  try {
    const { inspection_id, defects } = req.body;
    if (!inspection_id || !Array.isArray(defects) || defects.length === 0) {
      return res.status(400).json({ error: '검사 ID와 불량 목록은 필수입니다' });
    }
    const insertDefect = db.prepare(`
      INSERT INTO defect_details (inspection_id, defect_type_code, defect_count, defect_description, action_code)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items) => {
      for (const d of items) {
        insertDefect.run(inspection_id, d.defect_type_code, d.defect_count || 1, d.defect_description || null, d.action_code || null);
      }
    });
    insertMany(defects);
    const inserted = db.prepare(`
      SELECT dd.*, dtc.defect_type_name, dtc.category
      FROM defect_details dd
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE dd.inspection_id = ?
    `).all(inspection_id);
    res.status(201).json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defects/by-inspection/:id — 특정 검사의 불량 목록
router.get('/by-inspection/:id', (req, res) => {
  try {
    const defects = db.prepare(`
      SELECT dd.*, dtc.defect_type_name, dtc.category
      FROM defect_details dd
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE dd.inspection_id = ?
      ORDER BY dd.defect_id
    `).all(req.params.id);
    res.json(defects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parts/:part_id/defect-history — 불량 이력 알림용 데이터
router.get('/parts/:part_id/defect-history', (req, res) => {
  try {
    const { part_id } = req.params;
    const alertSettings = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    const threshold = alertSettings ? alertSettings.consecutive_defect_threshold : 3;
    const warningRate = alertSettings ? alertSettings.defect_rate_warning : 0.05;
    const dangerRate = alertSettings ? alertSettings.defect_rate_danger : 0.10;

    const part = db.prepare('SELECT * FROM parts WHERE part_id = ?').get(part_id);
    if (!part) return res.status(404).json({ error: '부품을 찾을 수 없습니다' });

    // 전체 검사 이력
    const allInspections = db.prepare(`
      SELECT * FROM inspections WHERE part_id = ? ORDER BY incoming_date DESC
    `).all(part_id);

    const totalCount = allInspections.length;

    // 최근 불량 발생 차수 (연속 불량 포함)
    let recentCount = 0;
    for (const insp of allInspections) {
      if (insp.defect_qty > 0 || insp.result !== '합격') {
        recentCount++;
      } else {
        break;
      }
    }

    // 마지막 불량 검사
    const lastDefectInspection = allInspections.find(i => i.defect_qty > 0);
    const lastDate = lastDefectInspection ? lastDefectInspection.incoming_date : null;
    const lastLotNo = lastDefectInspection ? lastDefectInspection.lot_no : null;
    const lastDefectRate = lastDefectInspection
      ? (lastDefectInspection.defect_qty / lastDefectInspection.inspect_qty)
      : null;

    // 주요 불량 유형 TOP 3
    const topDefects = db.prepare(`
      SELECT dd.defect_type_code as code, dtc.defect_type_name as name, SUM(dd.defect_count) as count
      FROM defect_details dd
      JOIN inspections i ON dd.inspection_id = i.inspection_id
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE i.part_id = ?
      GROUP BY dd.defect_type_code
      ORDER BY count DESC
      LIMIT 3
    `).all(part_id);

    // 등급 판정
    let grade = 'normal';
    if (recentCount >= threshold) {
      const recentRates = allInspections.slice(0, threshold).map(i =>
        i.inspect_qty > 0 ? i.defect_qty / i.inspect_qty : 0
      );
      const avgRate = recentRates.reduce((a, b) => a + b, 0) / recentRates.length;
      if (avgRate >= dangerRate) {
        grade = 'danger';
      } else if (avgRate >= warningRate) {
        grade = 'warning';
      } else {
        grade = 'caution';
      }
    } else if (recentCount >= 1) {
      grade = 'caution';
    }

    // 등급에 따른 품질 등급 업데이트
    const gradeMap = { normal: 'A', caution: 'B', warning: 'C', danger: 'D' };
    const newQualityGrade = gradeMap[grade];
    if (part.quality_grade !== newQualityGrade) {
      db.prepare("UPDATE parts SET quality_grade = ?, updated_at = datetime('now','localtime') WHERE part_id = ?")
        .run(newQualityGrade, part_id);
    }

    // 체크리스트 자동 생성
    const checklistItems = [];
    if (topDefects.length > 0) {
      topDefects.forEach(d => {
        checklistItems.push(`${d.name}(${d.code}) 중점 확인 — 과거 ${d.count}건 발생`);
      });
    }
    if (recentCount >= threshold) {
      checklistItems.push(`최근 ${recentCount}차 연속 불량 발생 — 샘플링 비율 확대 필요`);
    }
    if (lastDefectRate !== null && lastDefectRate >= dangerRate) {
      checklistItems.push(`최근 불량률 ${(lastDefectRate * 100).toFixed(1)}% — 위험 수준, 전수 검사 권고`);
    } else if (lastDefectRate !== null && lastDefectRate >= warningRate) {
      checklistItems.push(`최근 불량률 ${(lastDefectRate * 100).toFixed(1)}% — 경고 수준, 강화 검사 실시`);
    }

    res.json({
      grade,
      recentCount,
      totalCount,
      topDefects,
      lastDate,
      lastLotNo,
      lastDefectRate,
      checklistItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defect-codes
router.get('/codes', (req, res) => {
  try {
    const codes = db.prepare('SELECT * FROM defect_type_codes ORDER BY defect_type_code').all();
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/defect-codes
router.post('/codes', (req, res) => {
  try {
    const { defect_type_code, defect_type_name, category } = req.body;
    if (!defect_type_code || !defect_type_name || !category) {
      return res.status(400).json({ error: '코드, 이름, 카테고리는 필수입니다' });
    }
    db.prepare(`
      INSERT INTO defect_type_codes (defect_type_code, defect_type_name, category) VALUES (?, ?, ?)
    `).run(defect_type_code, defect_type_name, category);
    const newCode = db.prepare('SELECT * FROM defect_type_codes WHERE defect_type_code = ?').get(defect_type_code);
    res.status(201).json(newCode);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '이미 존재하는 코드입니다' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/defect-codes/:code
router.put('/codes/:code', (req, res) => {
  try {
    const { defect_type_name, category, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM defect_type_codes WHERE defect_type_code = ?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '코드를 찾을 수 없습니다' });
    db.prepare(`
      UPDATE defect_type_codes SET defect_type_name = ?, category = ?, is_active = ? WHERE defect_type_code = ?
    `).run(
      defect_type_name ?? existing.defect_type_name,
      category ?? existing.category,
      is_active ?? existing.is_active,
      req.params.code
    );
    const updated = db.prepare('SELECT * FROM defect_type_codes WHERE defect_type_code = ?').get(req.params.code);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suppliers
router.get('/suppliers', (req, res) => {
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY supplier_id').all();
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users
router.get('/users', (req, res) => {
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
router.get('/alert-settings', (req, res) => {
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
