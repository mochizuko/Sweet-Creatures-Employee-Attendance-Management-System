const express = require('express');
const c = require('../controllers/employeeController');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { wrap, idParam } = require('../utils/http');
const promotions = require('../services/promotionService');

const router = express.Router();

router.use(authenticate, authorize('Admin'));

router.get('/', c.listEmployees);
router.post('/', c.createEmployee);
router.get('/:id', c.getEmployee);
router.patch('/:id', c.updateEmployee);
router.patch('/:id/deactivate', c.deactivateEmployee);
router.patch('/:id/reactivate', c.reactivateEmployee);
router.patch('/:id/pin', c.resetPin);
router.get('/:id/promotions', wrap(async (req, res) => res.json({ success: true, data: await promotions.list(idParam(req)) })));
router.post('/:id/promotions', wrap(async (req, res) =>
  res.status(201).json({ success: true, data: await promotions.promote(idParam(req), req.body || {}, req.user) })));

module.exports = router;