// Idempotent schema upgrade. Safe to run many times:  node src/scripts/migrate.js
const db = require('../config/db');

async function hasColumn(table, col) {
  const [r] = await db.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, col]
  );
  return r.length > 0;
}
async function addColumn(table, col, ddl) {
  if (await hasColumn(table, col)) return;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
  console.log(`added ${table}.${col}`);
}

async function main() {
  // Staff can be deactivated (the admin page already offers this)
  await db.query("ALTER TABLE `user` MODIFY `account_status` ENUM('Active','Locked','Inactive') NOT NULL DEFAULT 'Active'");

  // Attendance: punctuality stays in `status`; review of flagged records gets its own columns
  await addColumn('attendance_record', 'review_status', "ENUM('None','Pending','Approved','Rejected') NOT NULL DEFAULT 'None'");
  await addColumn('attendance_record', 'flag_reason', 'VARCHAR(150) NULL');
  await addColumn('attendance_record', 'review_notes', 'VARCHAR(255) NULL');
  await addColumn('attendance_record', 'reviewed_at', 'DATETIME NULL');

  // Photos are stored in the database (compressed JPEG data URL)
  await db.query('ALTER TABLE `attendance_photo` MODIFY `photo_url` VARCHAR(255) NULL');
  await addColumn('attendance_photo', 'photo_data', 'MEDIUMTEXT NULL');

  // One row per submitted action; makes offline re-sync safe (no duplicates)
  await db.query(`CREATE TABLE IF NOT EXISTS attendance_event (
    client_id VARCHAR(64) NOT NULL PRIMARY KEY,
    record_id INT NOT NULL,
    action VARCHAR(20) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_attendance_event_record (record_id),
    CONSTRAINT fk_attendance_event_record FOREIGN KEY (record_id) REFERENCES attendance_record (record_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Policy: the staff app needs shift start, standard shift and overtime multiplier
  await addColumn('attendance_policy', 'shift_start', "TIME NOT NULL DEFAULT '08:00:00'");
  await addColumn('attendance_policy', 'standard_shift_hours', "DECIMAL(4,2) NOT NULL DEFAULT 8.00");
  await addColumn('attendance_policy', 'ot_multiplier', "DECIMAL(4,2) NOT NULL DEFAULT 1.25");

  // SOPs can be draft or published
  await addColumn('sop_document', 'status', "VARCHAR(20) NOT NULL DEFAULT 'published'");

  // Cash advances: admin approves before payroll deducts them
  await db.query("ALTER TABLE `cash_advance` MODIFY `status` ENUM('Pending','Approved','Deducted','Rejected') NOT NULL DEFAULT 'Pending'");
  await addColumn('cash_advance', 'notes', 'VARCHAR(255) NULL');

  // Payslip breakdown (basic pay, overtime pay and late/undertime deduction)
  await addColumn('payslip', 'basic_pay', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumn('payslip', 'overtime_pay', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumn('payslip', 'late_undertime_minutes', 'INT NOT NULL DEFAULT 0');
  await addColumn('payslip', 'late_undertime_deduction', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');

  // Time-in schedule: opening time and regular time-out by date range (no end date = until changed)
  await db.query(`CREATE TABLE IF NOT EXISTS attendance_schedule (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    time_in_opens TIME NOT NULL,
    regular_time_out TIME NULL,
    ot_grace_minutes INT NOT NULL DEFAULT 15,
    created_by_user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_attendance_schedule_from (effective_from)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Overtime past the regular time-out waits for owner approval before it is paid
  await addColumn('attendance_record', 'ot_pending_hours', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');
  await addColumn('attendance_record', 'ot_approved_hours', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00');

  // Promotions and pay changes, with the date each change starts
  await db.query(`CREATE TABLE IF NOT EXISTS employee_change_history (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    effective_from DATE NOT NULL,
    job_position VARCHAR(100) NULL,
    hourly_rate DECIMAL(10,2) NULL,
    account_role VARCHAR(10) NULL,
    reason VARCHAR(255) NULL,
    changed_by_user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_employee_change_user_date (user_id, effective_from)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('Migration complete.');
  process.exit(0);
}

main().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
