const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).send('Admin access only.');
  next();
}

function parseClaimId(value) {
  if (!/^\d+$/.test(value)) return null;
  const claimId = Number(value);
  return Number.isSafeInteger(claimId) && claimId > 0 ? claimId : null;
}

router.get('/admin/claims', requireAdmin, async (req, res) => {
  try {
    const [claims] = await pool.query(
      `SELECT c.claim_id, c.message, c.created_at, u.name AS claimant,
              i.item_id, i.title AS item_title, i.type, i.date_reported,
              category.name AS category, location.name AS location
       FROM claims AS c
       JOIN users AS u ON u.user_id = c.claimed_by
       JOIN items AS i ON i.item_id = c.item_id
       LEFT JOIN categories AS category ON category.category_id = i.category_id
       LEFT JOIN locations AS location ON location.location_id = i.location_id
       WHERE c.status = 'pending' AND i.status = 'open'
       ORDER BY c.created_at ASC, c.claim_id ASC`
    );
    res.render('admin-claims', {
      title: 'Review claims',
      claims,
      result: ['approved', 'rejected', 'closed', 'missing'].includes(req.query.result) ? req.query.result : ''
    });
  } catch (err) {
    console.error('Could not load pending claims:', err.message);
    res.status(500).send('Could not load claims. Please try again.');
  }
});

router.post('/admin/claims/:id/:decision', requireAdmin, async (req, res) => {
  const claimId = parseClaimId(req.params.id);
  const decision = req.params.decision;
  if (claimId === null || !['approve', 'reject'].includes(decision)) {
    return res.status(404).send('Claim action not found.');
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT c.claim_id, c.item_id, c.status AS claim_status, i.status AS item_status
       FROM claims AS c
       JOIN items AS i ON i.item_id = c.item_id
       WHERE c.claim_id = ?
       FOR UPDATE`,
      [claimId]
    );
    const claim = rows[0];

    if (!claim) {
      await connection.rollback();
      return res.redirect('/admin/claims?result=missing');
    }
    if (claim.claim_status !== 'pending') {
      await connection.rollback();
      return res.redirect('/admin/claims?result=missing');
    }

    if (decision === 'approve') {
      if (claim.item_status !== 'open') {
        await connection.rollback();
        return res.redirect('/admin/claims?result=closed');
      }
      await connection.query("UPDATE items SET status = 'claimed' WHERE item_id = ?", [claim.item_id]);
      await connection.query("UPDATE claims SET status = 'approved' WHERE claim_id = ?", [claimId]);
      await connection.query(
        "UPDATE claims SET status = 'rejected' WHERE item_id = ? AND claim_id <> ? AND status = 'pending'",
        [claim.item_id, claimId]
      );
    } else {
      await connection.query("UPDATE claims SET status = 'rejected' WHERE claim_id = ?", [claimId]);
    }

    await connection.commit();
    return res.redirect(`/admin/claims?result=${decision === 'approve' ? 'approved' : 'rejected'}`);
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Could not update claim:', err.message);
    return res.status(500).send('Could not update this claim. Please try again.');
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
