const express = require('express');
const pool = require('../db');
const { photoDirectory, photoNameValid } = require('../services/item-photos');
const router = express.Router();

router.get('/item-photos/:filename', async (req, res) => {
  if (!photoNameValid(req.params.filename)) return res.sendStatus(404);
  try {
    const [rows] = await pool.query('SELECT item_id FROM items WHERE photo_filename=? LIMIT 1', [req.params.filename]);
    if (!rows.length) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'");
    res.type('webp');
    res.sendFile(req.params.filename, { root: photoDirectory, dotfiles: 'deny', maxAge: '1d' }, error => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  } catch (error) {
    console.error('Could not load item photo:', error.code || 'storage error');
    res.sendStatus(503);
  }
});

module.exports = router;
