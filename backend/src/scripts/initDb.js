// One-time setup script: loads db/schema.sql into the database.
// Used on AWS to create the tables and the default admin account.
// WARNING: schema.sql starts with DROP TABLE, so running this again erases the data.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const file = path.resolve(__dirname, '../../db/schema.sql');
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Read', file, '(' + sql.length + ' characters)');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    connectTimeout: 15000
  });
  console.log('Connected to', process.env.DB_HOST);

  await conn.query(sql);

  const [tables] = await conn.query('SHOW TABLES');
  console.log('Tables now in the database:', tables.map((t) => Object.values(t)[0]).join(', '));
  const [admin] = await conn.query('SELECT username FROM `user` WHERE username = ?', ['lysa']);
  console.log('Default admin (lysa) present:', admin.length > 0);

  await conn.end();
  console.log('DATABASE SETUP COMPLETE');
}

main().catch((err) => {
  console.error('DATABASE SETUP FAILED:', err.message);
  process.exit(1);
});
