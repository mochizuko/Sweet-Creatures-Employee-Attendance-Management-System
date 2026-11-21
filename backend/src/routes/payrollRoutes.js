// routes/payrollRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware'); // sets req.user = { user_id, role }
const c = require('../controllers/payrollController');

const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin'
    ? next()
    : res.status(403).json({ success: false, message: 'Forbidden' });

router.use(authenticate);

// Employee: own finalized payslips (declare before '/payslips/:payslipId')
router.get('/payslips/me', c.myPayslips);
router.get('/payslips/:payslipId', c.getPayslip); // admin: any; employee: own + finalized

// Admin only
router.post('/cutoffs', requireAdmin, c.createCutoff);
router.get('/cutoffs', requireAdmin, c.listCutoffs);
router.post('/cutoffs/:cutoffId/generate', requireAdmin, c.generate);
router.get('/cutoffs/:cutoffId/payslips', requireAdmin, c.listCutoffPayslips);
router.post('/cutoffs/:cutoffId/finalize', requireAdmin, c.finalize);
router.patch('/payslips/:payslipId', requireAdmin, c.updateDraft);

module.exports = router;
