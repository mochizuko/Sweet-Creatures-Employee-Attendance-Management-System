const svc = require('../services/attendanceService');
const { wrap, idParam } = require('../utils/http');

exports.submit = wrap(async (req, res) => res.status(201).json(await svc.recordEvent(req.user, req.body)));
exports.mine = wrap(async (req, res) => res.json(await svc.mine(req.user.id)));
exports.day = wrap(async (req, res) => res.json({ success: true, ...(await svc.day(req.query.date)) }));
exports.flagged = wrap(async (req, res) => res.json({ success: true, data: await svc.flagged({ status: req.query.status }) }));
exports.list = wrap(async (req, res) => res.json({ success: true, data: await svc.list(req.query) }));
exports.photos = wrap(async (req, res) => res.json({ success: true, data: await svc.photos(idParam(req)) }));
exports.review = wrap(async (req, res) =>
  res.json({ success: true, data: await svc.review(idParam(req), req.user.id, req.body) }));
