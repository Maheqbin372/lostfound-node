const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');

const router = express.Router();

router.get('/register', (req, res) => {
  res.render('register', { title: 'Register', errors: [], form: {} });
});

router.post('/register', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const phone = (req.body.phone || '').trim();
  const password = req.body.password || '';
  const confirm = req.body.confirm || '';
  const errors = [];

  if (!name || name.length > 100) errors.push('Name is required (max 100 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) errors.push('Enter a valid email address.');
  if (phone.length > 20) errors.push('Phone number is too long.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm) errors.push('Passwords do not match.');

  if (errors.length) {
    return res.status(400).render('register', { title: 'Register', errors, form: { name, email, phone } });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
      [name, email, phone, hash]
    );
    res.redirect('/login');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('register', {
        title: 'Register', errors: ['That email is already registered.'], form: { name, email, phone }
      });
    }
    console.error('Could not register user:', err.message);
    res.status(500).send('Could not create your account. Please try again.');
  }
});

router.get('/login', (req, res) => {
  res.render('login', { title: 'Log in', errors: [] });
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  try {
    const [users] = await pool.query(
      'SELECT user_id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).render('login', { title: 'Log in', errors: ['Email or password is incorrect.'] });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Could not start your session. Please try again.');
      req.session.user = {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role
      };
      res.redirect('/');
    });
  } catch (err) {
    console.error('Could not log in:', err.message);
    res.status(500).send('Could not log in. Please try again.');
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid', { httpOnly: true, sameSite: 'lax' });
    res.redirect('/');
  });
});

module.exports = router;
