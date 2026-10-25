const mysql = require('mysql2/promise');

let localConfig = {};
try {
  localConfig = require('./db.local');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes('./db.local')) throw error;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST || localConfig.host,
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || localConfig.port),
  user: process.env.DB_USER || process.env.MYSQLUSER || localConfig.user,
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || localConfig.password,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE || localConfig.database,
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool;
