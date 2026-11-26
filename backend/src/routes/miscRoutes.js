// Policy, SOPs and cash advances (small routers kept together)
const express = require('express');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { wrap, idParam } = require('../utils/http');
const policy = require('../services/policyService');
const sops = require('../services/sopService');
const cash = require('../services/cashAdvanceService');

const admin = authorize('Admin');

const policyRouter = express.Router();
policyRouter.use(authenticate);
policyRouter.get('/', wrap(async (req, res) => res.json(await policy.current())));
policyRouter.get('/history', admin, wrap(async (req, res) => res.json({ success: true, data: await policy.history() })));
policyRouter.put('/', admin, wrap(async (req, res) => res.json(await policy.save(req.body || {}, req.user.id))));

const sopRouter = express.Router();
sopRouter.use(authenticate);
sopRouter.get('/', wrap(async (req, res) => res.json(await sops.list({ all: req.user.role === 'Admin' && req.query.all === '1' }))));
sopRouter.post('/', admin, wrap(async (req, res) => res.status(201).json(await sops.save(null, req.body || {}, req.user.id))));
sopRouter.put('/:id', admin, wrap(async (req, res) => res.json(await sops.save(idParam(req), req.body || {}, req.user.id))));

const cashRouter = express.Router();
cashRouter.use(authenticate);
cashRouter.get('/mine', wrap(async (req, res) => res.json(await cash.mine(req.user.id))));
cashRouter.get('/limit', admin, wrap(async (req, res) => res.json({ success: true, data: await cash.limit(req.query) })));
cashRouter.get('/', admin, wrap(async (req, res) => res.json({ success: true, data: await cash.list(req.query) })));
cashRouter.post('/', admin, wrap(async (req, res) => res.status(201).json({ success: true, data: await cash.create(req.body || {}, req.user.id) })));
cashRouter.patch('/:id', admin, wrap(async (req, res) => res.json({ success: true, data: await cash.setStatus(idParam(req), req.body || {}) })));

module.exports = { policyRouter, sopRouter, cashRouter };
