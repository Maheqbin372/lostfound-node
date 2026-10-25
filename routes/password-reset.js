const express = require('express');
const bcrypt = require('bcrypt');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const pool = require('../db');
const { sendRecoveryMessage, recoveryAvailable } = require('../services/recovery-mail');

const router = express.Router();
const limits = new Map();
const WINDOW = 15 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const tokenValid = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

function limited(key, maximum) {
  const now = Date.now();
  for (const [id, entry] of limits) if (entry.until <= now) limits.delete(id);
  let entry = limits.get(key);
  if (!entry) {
    entry = { count: 0, until: now + WINDOW };
    limits.set(key, entry);
  }
  entry.count += 1;
  return entry.count > maximum;
}

function csrfToken(req) {
  if (!req.session.recoveryCsrf) req.session.recoveryCsrf = randomBytes(32).toString('hex');
  return req.session.recoveryCsrf;
}

function csrfValid(req) {
  const supplied = req.body?.csrf;
  const expected = req.session.recoveryCsrf;
  return tokenValid(supplied) && tokenValid(expected)
    && timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}

function forgot(req, res, errors = [], sent = false) {
  return res.render('forgot-password', {
    title: 'Forgot password', errors, sent, csrf: csrfToken(req), localRecovery: recoveryAvailable()
  });
}

function reset(req, res, token, errors = [], valid = true) {
  return res.render('reset-password', {
    title: 'Reset password', errors, token: valid ? token : '', valid, csrf: csrfToken(req)
  });
}

router.use(['/forgot-password', '/reset-password'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

router.get('/forgot-password', (req, res) => forgot(req, res));

router.post('/forgot-password', async (req, res) => {
  if (!csrfValid(req)) return forgot(req, res.status(403), ['This form expired. Please try again.']);
  if (!recoveryAvailable()) return forgot(req, res.status(503), ['Password recovery is temporarily unavailable.']);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return forgot(req, res.status(400), ['Enter a valid email address.']);
  }
  if (limited(`request-ip:${req.ip}`, 10)) {
    return forgot(req, res.status(429), ['Too many requests. Please wait 15 minutes.']);
  }
  // Identical response for unknown and rate-limited accounts.
  if (limited(`request-email:${hash(email)}`, 3)) return forgot(req, res, [], true);

  let connection;
  let resetId;
  try {
    const origin = new URL(process.env.APP_BASE_URL || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      throw new Error('Invalid APP_BASE_URL.');
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.query('SELECT user_id FROM users WHERE email=? FOR UPDATE', [email]);
    if (!users.length) {
      await connection.commit();
      return forgot(req, res, [], true);
    }
    const userId = users[0].user_id;
    const token = randomBytes(32).toString('hex');
    await connection.query('DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at < UTC_TIMESTAMP()', [userId]);
    const [record] = await connection.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))',
      [userId, hash(token)]
    );
    resetId = record.insertId;
    await connection.commit();
    const url = new URL('/reset-password', origin.origin);
    url.searchParams.set('token', token);
    await sendRecoveryMessage(email, url.href);
    return forgot(req, res, [], true);
  } catch (error) {
    if (connection) await connection.rollback();
    if (resetId) await pool.query('DELETE FROM password_reset_tokens WHERE reset_id=?', [resetId]).catch(() => {});
    console.error('Password recovery failed:', error.code || 'recovery service unavailable');
    return forgot(req, res.status(503), ['Could not prepare recovery. Please try again later.']);
  } finally {
    if (connection) connection.release();
  }
});

router.get('/reset-password', async (req, res) => {
  const token = req.query.token;
  if (!tokenValid(token)) return reset(req, res.status(400), '', [], false);
  try {
    const [rows] = await pool.query(
      'SELECT reset_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()',
      [hash(token)]
    );
    return reset(req, rows.length ? res : res.status(400), token, [], rows.length > 0);
  } catch (error) {
    console.error('Could not open password recovery:', error.code || 'database error');
    return reset(req, res.status(503), '', ['Password recovery is temporarily unavailable.'], false);
  }
});

router.post('/reset-password', async (req, res) => {
  const token = req.body?.token;
  if (!csrfValid(req)) return reset(req, res.status(403), token, ['This form expired. Reopen your recovery link.'], false);
  if (!tokenValid(token)) return reset(req, res.status(400), '', [], false);
  if (limited(`reset-ip:${req.ip}`, 30)) return reset(req, res.status(429), '', ['Too many attempts. Please wait 15 minutes.'], false);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
  const errors = [];
  if (password.length < 8) errors.push('Use at least 8 characters.');
  if (Buffer.byteLength(password, 'utf8') > 72) errors.push('Password is too long. Use no more than 72 bytes.');
  if (password !== confirm) errors.push('Passwords do not match.');
  if (errors.length) return reset(req, res.status(400), token, errors);

  let connection;
  try {
    const [lookup] = await pool.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=?', [hash(token)]);
    if (!lookup.length) return reset(req, res.status(400), '', [], false);
    const passwordHash = await bcrypt.hash(password, 10);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // Use the same user -> token lock order as link issuance, including races.
    await connection.query('SELECT user_id FROM users WHERE user_id=? FOR UPDATE', [lookup[0].user_id]);
    const [rows] = await connection.query(
      'SELECT reset_id, user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE',
      [hash(token)]
    );
    if (!rows.length) {
      await connection.rollback();
      return reset(req, res.status(400), '', [], false);
    }
    await connection.query('UPDATE users SET password_hash=?, session_version=session_version+1 WHERE user_id=?', [passwordHash, rows[0].user_id]);
    await connection.query('UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND used_at IS NULL', [rows[0].user_id]);
    await connection.commit();
    req.session.destroy(error => {
      if (error) return res.status(500).send('Password changed. Please close this browser session and log in again.');
      res.clearCookie('connect.sid', { httpOnly: true, sameSite: 'lax' });
      return res.redirect('/login?reset=success');
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Could not reset password:', error.code || 'database error');
    return reset(req, res.status(503), token, ['Could not reset your password. Please try again later.']);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
