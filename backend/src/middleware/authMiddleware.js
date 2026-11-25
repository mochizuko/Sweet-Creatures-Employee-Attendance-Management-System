const jwt = require('jsonwebtoken');
const userService = require('../services/userService');

async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Missing or malformed token.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userService.findById(payload.id);

    if (!user || user.account_status !== 'Active') {
      return res.status(401).json({ message: 'Account is inactive or no longer exists.' });
    }

    req.user = { id: user.user_id, user_id: user.user_id, role: user.account_role };
    req.currentUser = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

// Usage: router.post('/x', authenticate, authorize('Admin'), handler)
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do this.' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };