const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware'); // must set req.user = { user_id, role }
const controller = require('../controllers/attendanceController');

router.use(authenticate);

router.post('/clock-in', controller.clockIn);
router.post('/clock-out', controller.clockOut);
router.get('/', controller.getAttendance);

module.exports = router;