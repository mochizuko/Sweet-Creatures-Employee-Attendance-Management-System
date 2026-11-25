const payroll = require('../services/payrollService');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ success: false, message: err.message });
  console.error(err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

const idParam = (req, name) => {
  const n = parseInt(req.params[name], 10);
  if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error(`Invalid ${name}`), { status: 400 });
  return n;
};

exports.createCutoff = async (req, res) => {
  try {
    const { start_date, end_date } = req.body;
    if (!DATE_RE.test(start_date || '') || !DATE_RE.test(end_date || '')) {
      return res.status(400).json({ success: false, message: 'start_date and end_date must be YYYY-MM-DD' });
    }
    const data = await payroll.createCutoff({ start_date, end_date });
    res.status(201).json({ success: true, data });
  } catch (err) { handleError(res, err); }
};

exports.ensureCutoff = async (req, res) => {
  try {
    const { start_date, end_date } = req.body;
    if (!DATE_RE.test(start_date || '') || !DATE_RE.test(end_date || '')) {
      return res.status(400).json({ success: false, message: 'start_date and end_date must be YYYY-MM-DD' });
    }
    res.json({ success: true, data: await payroll.ensureCutoff({ start_date, end_date }) });
  } catch (err) { handleError(res, err); }
};

exports.listCutoffs = async (req, res) => {
  try {
    res.json({ success: true, data: await payroll.listCutoffs() });
  } catch (err) { handleError(res, err); }
};

exports.generate = async (req, res) => {
  try {
    const data = await payroll.generatePayslips(idParam(req, 'cutoffId'));
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
};

exports.listCutoffPayslips = async (req, res) => {
  try {
    const data = await payroll.listPayslipsForCutoff(idParam(req, 'cutoffId'));
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
};

exports.updateDraft = async (req, res) => {
  try {
    const data = await payroll.updateDraft(idParam(req, 'payslipId'), req.body);
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
};

exports.finalize = async (req, res) => {
  try {
    const data = await payroll.finalizeCutoff(idParam(req, 'cutoffId'), req.user.user_id);
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
};

exports.myPayslips = async (req, res) => {
  try {
    res.json({ success: true, data: await payroll.listOwnPayslips(req.user.user_id) });
  } catch (err) { handleError(res, err); }
};

exports.getPayslip = async (req, res) => {
  try {
    const data = await payroll.getPayslip(idParam(req, 'payslipId'), req.user);
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
};