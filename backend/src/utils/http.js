class AppError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Already recorded.', code: 'invalid' });
  console.error(err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { handleError(res, err); }
};

const idParam = (req, name = 'id') => {
  const n = parseInt(req.params[name], 10);
  if (!Number.isInteger(n) || n < 1) throw new AppError(`Invalid ${name}`, 400);
  return n;
};

module.exports = { AppError, handleError, wrap, idParam };
