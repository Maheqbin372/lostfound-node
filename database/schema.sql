CREATE DATABASE IF NOT EXISTS lostfound
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE lostfound;

CREATE TABLE IF NOT EXISTS users (
  user_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  session_version INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id),
  UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  category_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  PRIMARY KEY (category_id),
  UNIQUE KEY name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS locations (
  location_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (location_id),
  UNIQUE KEY name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  item_id INT NOT NULL AUTO_INCREMENT,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  type ENUM('lost', 'found') NOT NULL,
  status ENUM('open', 'claimed', 'returned') NOT NULL DEFAULT 'open',
  date_reported DATE NOT NULL,
  category_id INT NOT NULL,
  location_id INT NOT NULL,
  reported_by INT NOT NULL,
  PRIMARY KEY (item_id),
  KEY category_id (category_id),
  KEY location_id (location_id),
  KEY reported_by (reported_by),
  CONSTRAINT items_category_fk FOREIGN KEY (category_id) REFERENCES categories (category_id),
  CONSTRAINT items_location_fk FOREIGN KEY (location_id) REFERENCES locations (location_id),
  CONSTRAINT items_reporter_fk FOREIGN KEY (reported_by) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS claims (
  claim_id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  claimed_by INT NOT NULL,
  message TEXT,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (claim_id),
  KEY item_id (item_id),
  KEY claimed_by (claimed_by),
  CONSTRAINT claims_item_fk FOREIGN KEY (item_id) REFERENCES items (item_id),
  CONSTRAINT claims_user_fk FOREIGN KEY (claimed_by) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  reset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY password_reset_user (user_id),
  CONSTRAINT password_reset_user_fk FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO categories (name) VALUES
  ('Phone'), ('Wallet'), ('ID Card'), ('Keys'), ('Bag'), ('Other');

INSERT IGNORE INTO locations (name) VALUES
  ('Library'), ('Canteen'), ('Main Gate'), ('Classroom'), ('Bus Stop');
