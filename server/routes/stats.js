const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/stats/dashboard — 대시보드 통계
router.get('/dashboard', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 오늘 입고 건수
    const todayIncoming = db.prepare(`
      SELECT COUNT(*) as cnt FROM inspections WHERE incoming_date = ?
    `).get(today).cnt;

    // 이번 주 불량 건수 (불량 있는 검사)
    const weeklyDefectCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM inspections
      WHERE incoming_date >= ? AND incoming_date <= ? AND defect_qty > 0
    `).get(weekAgo, today).cnt;

    // 경고 등급 부품 수 (quality_grade C 또는 D)
    const warningParts = db.prepare(`
      SELECT COUNT(*) as cnt FROM parts WHERE quality_grade IN ('C','D') AND is_active = 1
    `).get().cnt;

    // 전체 평균 불량률
    const rateRow = db.prepare(`
      SELECT SUM(defect_qty) as total_defect, SUM(inspect_qty) as total_inspect FROM inspections
    `).get();
    const totalDefectRate = rateRow.total_inspect > 0
      ? rateRow.total_defect / rateRow.total_inspect
      : 0;

    // 이번 주 불량 TOP 5 부품
    const weeklyTop5 = db.prepare(`
      SELECT p.part_no, p.part_name, p.quality_grade, s.supplier_name,
        SUM(i.defect_qty) as total_defect,
        SUM(i.inspect_qty) as total_inspect,
        COUNT(i.inspection_id) as inspection_count
      FROM inspections i
      JOIN parts p ON i.part_id = p.part_id
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE i.incoming_date >= ? AND i.incoming_date <= ?
      GROUP BY i.part_id
      HAVING total_defect > 0
      ORDER BY total_defect DESC
      LIMIT 5
    `).all(weekAgo, today);

    // 경고/위험 등급 부품 알림 리스트
    const warningPartsList = db.prepare(`
      SELECT p.*, s.supplier_name,
        (SELECT COUNT(*) FROM inspections WHERE part_id = p.part_id AND defect_qty > 0) as defect_count
      FROM parts p
      LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE p.quality_grade IN ('C','D') AND p.is_active = 1
      ORDER BY p.quality_grade DESC
    `).all();

    // 최근 7일 일별 불량 건수
    const dailyDefects = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const row = db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(defect_qty), 0) as defect_qty
        FROM inspections WHERE incoming_date = ?
      `).get(date);
      dailyDefects.push({ date, count: row.count, defect_qty: row.defect_qty });
    }

    res.json({
      todayIncoming,
      weeklyDefectCount,
      warningParts,
      totalDefectRate,
      weeklyTop5,
      warningPartsList,
      dailyDefects,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/by-part/:part_id — 부품별 월별 불량률 추이 (최근 12개월)
router.get('/by-part/:part_id', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', incoming_date) as month,
        SUM(inspect_qty) as total_inspect,
        SUM(defect_qty) as total_defect,
        COUNT(*) as inspection_count
      FROM inspections
      WHERE part_id = ?
        AND incoming_date >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month ASC
    `).all(req.params.part_id);

    const result = rows.map(r => ({
      month: r.month,
      defectRate: r.total_inspect > 0 ? (r.total_defect / r.total_inspect) * 100 : 0,
      totalInspect: r.total_inspect,
      totalDefect: r.total_defect,
      inspectionCount: r.inspection_count,
    }));

    // 불량 유형별 누적
    const defectByType = db.prepare(`
      SELECT dd.defect_type_code, dtc.defect_type_name, SUM(dd.defect_count) as count
      FROM defect_details dd
      JOIN inspections i ON dd.inspection_id = i.inspection_id
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE i.part_id = ?
      GROUP BY dd.defect_type_code
      ORDER BY count DESC
    `).all(req.params.part_id);

    res.json({ monthly: result, defectByType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/by-supplier — 공급사별 불량 현황
router.get('/by-supplier', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.supplier_name,
        COUNT(DISTINCT p.part_id) as part_count,
        COUNT(i.inspection_id) as inspection_count,
        COALESCE(SUM(i.inspect_qty), 0) as total_inspect,
        COALESCE(SUM(i.defect_qty), 0) as total_defect
      FROM suppliers s
      LEFT JOIN parts p ON s.supplier_id = p.supplier_id AND p.is_active = 1
      LEFT JOIN inspections i ON p.part_id = i.part_id
      GROUP BY s.supplier_id
      ORDER BY total_defect DESC
    `).all();

    const result = rows.map(r => ({
      ...r,
      defectRate: r.total_inspect > 0 ? (r.total_defect / r.total_inspect) * 100 : 0,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/top-defects — 기간별 불량 다발 TOP N
router.get('/top-defects', (req, res) => {
  try {
    const { start_date, end_date, limit = 10 } = req.query;
    let sql = `
      SELECT dd.defect_type_code, dtc.defect_type_name, dtc.category,
        SUM(dd.defect_count) as total_count,
        COUNT(DISTINCT i.inspection_id) as occurrence_count
      FROM defect_details dd
      JOIN inspections i ON dd.inspection_id = i.inspection_id
      JOIN defect_type_codes dtc ON dd.defect_type_code = dtc.defect_type_code
      WHERE 1=1
    `;
    const params = [];
    if (start_date) { sql += ' AND i.incoming_date >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND i.incoming_date <= ?'; params.push(end_date); }
    sql += ' GROUP BY dd.defect_type_code ORDER BY total_count DESC LIMIT ?';
    params.push(Number(limit));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
