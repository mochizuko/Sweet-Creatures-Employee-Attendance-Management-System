const bcrypt = require('bcryptjs');
const employeeService = require('../services/employeeService');

const ROLES = ['Admin', 'Staff'];
const PIN_REGEX = /^\d{4,6}$/;

function canManage(actor, target) {
  return actor.role === 'Admin' || target.account_role === 'Staff';
}

// Loads the target employee, or sends the 404/403 itself and returns null.
async function loadTarget(req, res) {
  const target = await employeeService.getById(req.params.id);
  if (!target) {
    res.status(404).json({ message: 'Employee not found.' });
    return null;
  }
  if (!canManage(req.user, target)) {
    res.status(403).json({ message: 'Only an Admin can modify this account.' });
    return null;
  }
  return target;
}

function serverError(res, err, label) {
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'Username or email already exists.' });
  }
  console.error(`${label}:`, err);
  return res.status(500).json({ message: 'Server error.' });
}

async function listEmployees(req, res) {
  try {
    res.json(await employeeService.list(req.query));
  } catch (err) {
    serverError(res, err, 'List employees');
  }
}

async function getEmployee(req, res) {
  try {
    const employee = await employeeService.getById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found.' });
    res.json({ ...employee, currentShift: null });
  } catch (err) {
    serverError(res, err, 'Get employee');
  }
}

async function createEmployee(req, res) {
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
    if (!ROLES.includes(role)) {
      return res.status(400).json({ message: 'Role must be Admin or Staff.' });
    }
    if (role !== 'Staff' && req.user.role !== 'Admin') {
      return res.status(403).json({ message: 'Only an Admin can create Admin accounts.' });
    }
    if (hourlyRate !== undefined && (isNaN(hourlyRate) || Number(hourlyRate) < 0)) {
      return res.status(400).json({ message: 'hourlyRate must be a non-negative number.' });
    }

    const id = await employeeService.create({
      role,
      firstName: firstName.trim(),
      middleName: middleName?.trim(),
      lastName: lastName.trim(),
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      pinHash: await bcrypt.hash(String(pin), 10),
      jobPosition: jobPosition?.trim(),
      hourlyRate,
    });

    res.status(201).json({ message: 'Employee created.', userId: id });
  } catch (err) {
    serverError(res, err, 'Create employee');
  }
}

async function updateEmployee(req, res) {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const changes = { ...req.body };

    if (changes.role !== undefined) {
      if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Only an Admin can change roles.' });
      }
      if (!ROLES.includes(changes.role)) {
        return res.status(400).json({ message: 'Role must be Admin or Staff.' });
      }
      if (target.user_id === req.user.id && changes.role !== 'Admin') {
        return res.status(400).json({ message: 'You cannot remove your own Admin role.' });
      }
    }
    if (changes.hourlyRate !== undefined && (isNaN(changes.hourlyRate) || Number(changes.hourlyRate) < 0)) {
      return res.status(400).json({ message: 'hourlyRate must be a non-negative number.' });
    }
    for (const key of ['firstName', 'middleName', 'lastName', 'jobPosition']) {
      if (typeof changes[key] === 'string') changes[key] = changes[key].trim();
    }
    if (typeof changes.email === 'string') changes.email = changes.email.trim().toLowerCase();

    if (!(await employeeService.update(target.user_id, changes))) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }
    res.json(await employeeService.getById(target.user_id));
  } catch (err) {
    serverError(res, err, 'Update employee');
  }
}

// Soft delete: the row stays (attendance and payslips reference it).
async function deactivateEmployee(req, res) {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    if (target.user_id === req.user.id) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }
    await employeeService.setStatus(target.user_id, 'Inactive');
    res.json({ message: 'Employee deactivated.' });
  } catch (err) {
    serverError(res, err, 'Deactivate employee');
  }
}

async function reactivateEmployee(req, res) {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    await employeeService.setStatus(target.user_id, 'Active');
    res.json({ message: 'Employee reactivated.' });
  } catch (err) {
    serverError(res, err, 'Reactivate employee');
  }
}

async function resetPin(req, res) {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;
    const { pin } = req.body;
    if (!PIN_REGEX.test(String(pin || ''))) {
      return res.status(400).json({ message: 'PIN must be 4 to 6 digits.' });
    }
    await employeeService.resetPin(target.user_id, await bcrypt.hash(String(pin), 10));
    res.json({ message: 'PIN reset.' });
  } catch (err) {
    serverError(res, err, 'Reset PIN');
  }
}

module.exports = {
  listEmployees, getEmployee, createEmployee, updateEmployee,
  deactivateEmployee, reactivateEmployee, resetPin,
};