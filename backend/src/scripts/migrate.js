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

  console.log('Migration complete.');
  process.exit(0);
}

main().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
