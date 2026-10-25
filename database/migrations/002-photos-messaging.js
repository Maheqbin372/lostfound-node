const pool = require('../../db');
(async () => {
  try {
    const [columns] = await pool.query("SHOW COLUMNS FROM items LIKE 'photo_filename'");
    if (!columns.length) await pool.query('ALTER TABLE items ADD COLUMN photo_filename VARCHAR(80) DEFAULT NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
      conversation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      item_id INT NOT NULL,
      reporter_id INT NOT NULL,
      participant_id INT NOT NULL,
      reporter_last_read BIGINT UNSIGNED NOT NULL DEFAULT 0,
      participant_last_read BIGINT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY conversation_item_participant (item_id, participant_id),
      KEY conversation_reporter (reporter_id),
      KEY conversation_participant (participant_id),
      CONSTRAINT conversation_item_fk FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
      CONSTRAINT conversation_reporter_fk FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CONSTRAINT conversation_participant_fk FOREIGN KEY (participant_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (
      message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      conversation_id BIGINT UNSIGNED NOT NULL,
      sender_id INT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY message_conversation (conversation_id, message_id),
      CONSTRAINT message_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      CONSTRAINT message_sender_fk FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Photo uploads and messaging migration complete.');
  } catch (error) {
    console.error('Migration failed:', error.code || error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
