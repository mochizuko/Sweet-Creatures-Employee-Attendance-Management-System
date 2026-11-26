const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');

const MAX_ATTEMPTS = parseInt(process.env.MAX_PIN_ATTEMPTS, 10) || 5;
const PIN_REGEX = /^\d{4,6}$/;

function signToken(user) {
  return jwt.sign(
    { id: user.user_id, role: user.account_role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

// Admin-only (enforced in the routes file)
async function register(req, res) {
  try {
    const {
      firstName, middleName, lastName, username, email, pin,
      role = 'Staff', jobPosition, hourlyRate,
    } = req.body;

    if (!firstName || !lastName || !username || !email || !pin) {
      return res.status(400).json({
        message: 'firstName, lastName, username, email and pin are required.',
      });
    }
    if (!PIN_REGEX.test(String(pin))) {
      return res.status(400).json({ message: 'PIN must be 4 to 6 digits.' });
    }
    if (!['Admin', 'Staff'].includes(role)) {
      return res.status(400).json({ message: "Role must be 'Admin' or 'Staff'." });
    }

    const pinHash = await bcrypt.hash(String(pin), 10);

    const id = await userService.createUser({
      role,
      firstName: firstName.trim(),
      middleName: middleName?.trim(),
      lastName: lastName.trim(),
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      pinHash,
      jobPosition,
      hourlyRate,
    });

    res.status(201).json({ message: 'User created.', userId: id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username or email already exists.' });
    }
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
}

async function login(req, res) {
  try {
    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({ message: 'Username and PIN are required.' });
    }

    const user = await userService.findByUsername(username.trim().toLowerCase());

    // Same message whether the username or the PIN is wrong.
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or PIN.' });
    }

    if (user.account_status === 'Locked') {
      return res.status(423).json({
        message: 'Account is locked. Please contact an administrator.',
      });
    }

    if (user.account_status === 'Inactive') {
      return res.status(403).json({
        message: 'Account is deactivated. Please contact an administrator.',
      });
    }

    const valid = await bcrypt.compare(String(pin), user.pin_hash);

    if (!valid) {
      await userService.recordFailedAttempt(user.user_id, MAX_ATTEMPTS);
      const remaining = MAX_ATTEMPTS - (user.failed_pin_attempts + 1);
      return res.status(401).json({
        message: remaining > 0
          ? `Invalid username or PIN. ${remaining} attempt(s) left.`
          : 'Too many failed attempts. Account locked.',
      });
    }

    if (user.failed_pin_attempts > 0) {
      await userService.resetFailedAttempts(user.user_id);
    }

    res.json({
      token: signToken(user),
      user: {
        id: user.user_id,
        role: user.account_role,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
}

async function me(req, res) {
  res.json(req.currentUser); // loaded by the authenticate middleware, no pin_hash
}

// Admin-only
async function unlockUser(req, res) {
  try {
    const ok = await userService.unlock(req.params.id);
    if (!ok) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'Account unlocked.' });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
}

module.exports = { register, login, me, unlockUser };