const pool = require('../../db');

(async () => {
  try {
    const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'session_version'");
    if (!columns.length) await pool.query('ALTER TABLE users ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0');
    await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      reset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY password_reset_user (user_id),
      CONSTRAINT password_reset_user_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Password recovery database migration complete.');
  } catch (error) {
    console.error('Password recovery migration failed:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
