// Time-in schedule (opening time and regular time-out by date range)
const express = require('express');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { wrap, idParam } = require('../utils/http');
const schedules = require('../services/scheduleService');

const admin = authorize('Admin');
const router = express.Router();
router.use(authenticate);

// Any logged-in user: the schedule in force today (the staff app uses it to show when time-in opens)
router.get('/today', wrap(async (req, res) => res.json({ success: true, data: await schedules.today() })));
router.get('/', admin, wrap(async (req, res) => res.json({ success: true, data: await schedules.list() })));
router.post('/', admin, wrap(async (req, res) =>
  res.status(201).json({ success: true, data: await schedules.create(req.body || {}, req.user.id) })));
router.delete('/:id', admin, wrap(async (req, res) => {
  await schedules.remove(idParam(req));
  res.json({ success: true });
}));

module.exports = router;
