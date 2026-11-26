const db = require('../config/db');
const { AppError } = require('../utils/http');

const shape = (s) => ({ id: s.sop_id, title: s.title, body: s.content, version: `v${s.version}`, status: s.status, updatedAt: s.updated_at });

async function list({ all } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM sop_document ${all ? '' : "WHERE status = 'published'"} ORDER BY title`);
  return rows.map(shape);
}

async function save(id, { title, body, status }, userId) {
  if (!String(title || '').trim() || !String(body || '').trim()) throw new AppError('title and body are required');
  const st = ['draft', 'published'].includes(status) ? status : 'published';
  if (id) {
    const [[cur]] = await db.query('SELECT version FROM sop_document WHERE sop_id = ?', [id]);
    if (!cur) throw new AppError('SOP not found', 404);
    const next = String((parseFloat(cur.version) || 1) + 1);
    await db.query('UPDATE sop_document SET title=?, content=?, status=?, version=?, updated_by_user_id=? WHERE sop_id=?',
      [String(title).slice(0, 150), body, st, next, userId, id]);
  } else {
    const [r] = await db.query(
      'INSERT INTO sop_document (title, content, status, version, updated_by_user_id) VALUES (?, ?, ?, ?, ?)',
      [String(title).slice(0, 150), body, st, '1', userId]);
    id = r.insertId;
  }
  const [[row]] = await db.query('SELECT * FROM sop_document WHERE sop_id = ?', [id]);
  return shape(row);
}

module.exports = { list, save };
