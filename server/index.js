const express = require('express');
const cors = require('cors');
const partsRouter = require('./routes/parts');
const inspectionsRouter = require('./routes/inspections');
const defectsRouter = require('./routes/defects');
const statsRouter = require('./routes/stats');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use('/api/parts', partsRouter);
app.use('/api/inspections', inspectionsRouter);
app.use('/api/defects', defectsRouter);
app.use('/api/stats', statsRouter);

// defects.js에서 처리하는 추가 경로
app.get('/api/defect-codes', (req, res) => {
  const db = require('./db');
  try {
    const codes = db.prepare('SELECT * FROM defect_type_codes ORDER BY defect_type_code').all();
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/defect-codes', (req, res) => {
  const db = require('./db');
  try {
    const { defect_type_code, defect_type_name, category } = req.body;
    if (!defect_type_code || !defect_type_name || !category) {
      return res.status(400).json({ error: '코드, 이름, 카테고리는 필수입니다' });
    }
    db.prepare('INSERT INTO defect_type_codes (defect_type_code, defect_type_name, category) VALUES (?, ?, ?)').run(defect_type_code, defect_type_name, category);
    const newCode = db.prepare('SELECT * FROM defect_type_codes WHERE defect_type_code = ?').get(defect_type_code);
    res.status(201).json(newCode);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '이미 존재하는 코드입니다' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/defect-codes/:code', (req, res) => {
  const db = require('./db');
  try {
    const { defect_type_name, category, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM defect_type_codes WHERE defect_type_code = ?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '코드를 찾을 수 없습니다' });
    db.prepare('UPDATE defect_type_codes SET defect_type_name = ?, category = ?, is_active = ? WHERE defect_type_code = ?').run(
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

app.get('/api/suppliers', (req, res) => {
  const db = require('./db');
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY supplier_id').all();
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', (req, res) => {
  const db = require('./db');
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY user_id').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', (req, res) => {
  const db = require('./db');
  try {
    const { username, name, role, email } = req.body;
    if (!username || !name) return res.status(400).json({ error: '사용자명과 이름은 필수입니다' });
    const result = db.prepare('INSERT INTO users (username, name, role, email) VALUES (?, ?, ?, ?)').run(username, name, role || 'ROLE_INSPECTOR', email || null);
    const newUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(result.lastInsertRowid);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '이미 존재하는 사용자명입니다' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', (req, res) => {
  const db = require('./db');
  try {
    const { name, role, email, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
    db.prepare('UPDATE users SET name = ?, role = ?, email = ?, is_active = ? WHERE user_id = ?').run(
      name ?? existing.name, role ?? existing.role, email ?? existing.email, is_active ?? existing.is_active, req.params.id
    );
    const updated = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alert-settings', (req, res) => {
  const db = require('./db');
  try {
    const settings = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/alert-settings', (req, res) => {
  const db = require('./db');
  try {
    const { consecutive_defect_threshold, defect_rate_warning, defect_rate_danger } = req.body;
    const existing = db.prepare('SELECT * FROM alert_settings WHERE id = 1').get();
    db.prepare('UPDATE alert_settings SET consecutive_defect_threshold = ?, defect_rate_warning = ?, defect_rate_danger = ? WHERE id = 1').run(
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Quality Management Server running on http://localhost:${PORT}`);
});
