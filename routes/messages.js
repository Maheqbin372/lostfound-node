const express = require('express');
const pool = require('../db');
const { validFormToken, rateLimited } = require('../services/form-security');
const router = express.Router();

function id(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  next();
}
function bodyText(req) { return typeof req.body?.message === 'string' ? req.body.message.trim() : ''; }
async function conversationFor(conversationId, userId) {
  const [rows] = await pool.query(
    `SELECT c.*, i.title AS item_title, reporter.name AS reporter_name, participant.name AS participant_name
     FROM conversations c JOIN items i ON i.item_id=c.item_id
     JOIN users reporter ON reporter.user_id=c.reporter_id
     JOIN users participant ON participant.user_id=c.participant_id
     WHERE c.conversation_id=? AND (c.reporter_id=? OR c.participant_id=?)`,
    [conversationId, userId, userId]
  );
  return rows[0];
}
async function showThread(req, res, conversation, errors = [], draft = '') {
  const before = req.query.before === undefined ? null : id(req.query.before);
  if (req.query.before !== undefined && before === null) return res.sendStatus(400);
  const values = [conversation.conversation_id];
  if (before) values.push(before);
  const [rows] = await pool.query(
    `SELECT m.message_id,m.sender_id,m.body,m.created_at,u.name AS sender_name
     FROM messages m JOIN users u ON u.user_id=m.sender_id
     WHERE m.conversation_id=? ${before ? 'AND m.message_id < ?' : ''}
     ORDER BY m.message_id DESC LIMIT 51`, values
  );
  const hasOlder = rows.length > 50;
  const messages = rows.slice(0,50).reverse();
  if (messages.length) {
    const readColumn = conversation.reporter_id === req.session.user.user_id ? 'reporter_last_read' : 'participant_last_read';
    await pool.query(`UPDATE conversations SET ${readColumn}=GREATEST(${readColumn},?) WHERE conversation_id=?`, [messages[messages.length-1].message_id, conversation.conversation_id]);
  }
  res.render('message-thread', { title:'Conversation', conversation, messages, errors, draft, hasOlder, olderBefore: messages[0]?.message_id, olderPage: Boolean(before) });
}

router.get('/messages', requireLogin, async (req, res) => {
  try {
    const uid = req.session.user.user_id;
    const page = req.query.page === undefined ? 1 : id(req.query.page);
    if (!page || page > 10000) return res.sendStatus(400);
    const [rows] = await pool.query(
      `SELECT c.conversation_id,c.item_id,i.title AS item_title,
       CASE WHEN c.reporter_id=? THEN participant.name ELSE reporter.name END AS other_name,
       (SELECT body FROM messages WHERE conversation_id=c.conversation_id ORDER BY message_id DESC LIMIT 1) AS last_message,
       (SELECT created_at FROM messages WHERE conversation_id=c.conversation_id ORDER BY message_id DESC LIMIT 1) AS last_time,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.conversation_id AND m.sender_id<>?
        AND m.message_id > CASE WHEN c.reporter_id=? THEN c.reporter_last_read ELSE c.participant_last_read END) AS unread_count
       FROM conversations c JOIN items i ON i.item_id=c.item_id
       JOIN users reporter ON reporter.user_id=c.reporter_id
       JOIN users participant ON participant.user_id=c.participant_id
       WHERE c.reporter_id=? OR c.participant_id=?
       ORDER BY last_time DESC,c.conversation_id DESC LIMIT 21 OFFSET ?`, [uid,uid,uid,uid,uid,(page-1)*20]
    );
    res.render('messages', { title:'Messages', conversations: rows.slice(0,20), page, hasNext: rows.length>20 });
  } catch (error) {
    console.error('Could not load inbox:',error.code || 'database error');
    res.status(503).send('Could not load messages. Please try again.');
  }
});

router.post('/items/:id/messages', requireLogin, async (req,res) => {
  const itemId = id(req.params.id);
  if (!itemId) return res.sendStatus(404);
  if (!validFormToken(req)) return res.status(403).send('This form expired. Reload the item page and try again.');
  const message = bodyText(req);
  if (!message || message.length > 2000) return res.redirect(`/items/${itemId}?message=invalid`);
  if (rateLimited(`message:${req.session.user.user_id}`,30)) return res.redirect(`/items/${itemId}?message=limited`);
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [items] = await connection.query('SELECT reported_by FROM items WHERE item_id=?', [itemId]);
    if (!items.length || items[0].reported_by === req.session.user.user_id) {
      await connection.rollback();
      return res.status(400).send('Choose a report posted by another user.');
    }
    const [thread] = await connection.query(
      `INSERT INTO conversations (item_id,reporter_id,participant_id) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE conversation_id=LAST_INSERT_ID(conversation_id)`,
      [itemId,items[0].reported_by,req.session.user.user_id]
    );
    await connection.query('INSERT INTO messages (conversation_id,sender_id,body) VALUES (?,?,?)',[thread.insertId,req.session.user.user_id,message]);
    await connection.commit();
    res.redirect(`/messages/${thread.insertId}`);
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Could not start conversation:',error.code || 'database error');
    res.status(503).send('Could not send the message. Please try again.');
  } finally { if (connection) connection.release(); }
});

router.get('/messages/:id', requireLogin, async (req,res) => {
  const conversationId=id(req.params.id);
  if (!conversationId) return res.sendStatus(404);
  try {
    const conversation=await conversationFor(conversationId,req.session.user.user_id);
    if (!conversation) return res.sendStatus(404);
    await showThread(req,res,conversation);
  } catch (error) {
    console.error('Could not open conversation:',error.code || 'database error');
    res.status(503).send('Could not open this conversation. Please try again.');
  }
});

router.post('/messages/:id', requireLogin, async (req,res) => {
  const conversationId=id(req.params.id);
  if (!conversationId) return res.sendStatus(404);
  if (!validFormToken(req)) return res.status(403).send('This form expired. Reload the conversation and try again.');
  try {
    const conversation=await conversationFor(conversationId,req.session.user.user_id);
    if (!conversation) return res.sendStatus(404);
    const message=bodyText(req);
    if (!message || message.length>2000) return showThread(req,res.status(400),conversation,['Write a message between 1 and 2,000 characters.'],message.slice(0,2000));
    if (rateLimited(`message:${req.session.user.user_id}`,30)) return showThread(req,res.status(429),conversation,['Please wait a minute before sending more messages.'],message);
    await pool.query('INSERT INTO messages (conversation_id,sender_id,body) VALUES (?,?,?)',[conversationId,req.session.user.user_id,message]);
    res.redirect(`/messages/${conversationId}`);
  } catch (error) {
    console.error('Could not reply:',error.code || 'database error');
    res.status(503).send('Could not send your reply. Please try again.');
  }
});

module.exports=router;
