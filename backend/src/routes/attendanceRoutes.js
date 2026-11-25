const express = require('express');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const c = require('../controllers/attendanceController');

const router = express.Router();
const admin = authorize('Admin');

router.use(authenticate);

// Staff
router.get('/mine', c.mine);
router.post('/', c.submit);

// Admin (fixed paths first, then :id routes)
router.get('/day', admin, c.day);
router.get('/flagged', admin, c.flagged);
router.get('/', admin, c.list);
router.get('/:id/photos', admin, c.photos);
router.patch('/:id/review', admin, c.review);

module.exports = router;
