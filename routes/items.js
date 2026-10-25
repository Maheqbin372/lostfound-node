const express = require('express');
const pool = require('../db');

const router = express.Router();

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseItemId(value) {
  if (!/^\d+$/.test(value)) return null;
  const itemId = Number(value);
  return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null;
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

async function getFormOptions() {
  const [[categories], [locations]] = await Promise.all([
    pool.query('SELECT category_id, name FROM categories ORDER BY name'),
    pool.query('SELECT location_id, name FROM locations ORDER BY name')
  ]);
  return { categories, locations };
}

async function getItemDetails(itemId) {
  const [items] = await pool.query(
    `SELECT i.item_id, i.title, i.description, i.type, i.status, i.date_reported,
            i.category_id, i.location_id, i.reported_by,
            c.name AS category, l.name AS location, u.name AS reporter
     FROM items AS i
     LEFT JOIN categories AS c ON c.category_id = i.category_id
     LEFT JOIN locations AS l ON l.location_id = i.location_id
     LEFT JOIN users AS u ON u.user_id = i.reported_by
     WHERE i.item_id = ? LIMIT 1`,
    [itemId]
  );
  return items[0] || null;
}

router.get('/items/:id', async (req, res) => {
  const itemId = parseItemId(req.params.id);
  if (itemId === null) {
    return res.status(404).send('Item not found.');
  }

  try {
    const item = await getItemDetails(itemId);
    if (!item) return res.status(404).send('Item not found.');

    let hasClaim = false;
    let matches = [];
    if (req.session.user && item.type === 'found' && item.status === 'open') {
      const [claims] = await pool.query(
        'SELECT claim_id FROM claims WHERE item_id = ? AND claimed_by = ? LIMIT 1',
        [item.item_id, req.session.user.user_id]
      );
      hasClaim = claims.length > 0;
    }

    if (item.type === 'lost' && item.status === 'open') {
      [matches] = await pool.query(
        `SELECT found.item_id, found.title, found.description, found.date_reported,
                category.name AS category, location.name AS location
         FROM items AS found
         LEFT JOIN categories AS category ON category.category_id = found.category_id
         LEFT JOIN locations AS location ON location.location_id = found.location_id
         WHERE found.type = 'found'
           AND found.status = 'open'
           AND found.category_id = ?
           AND found.date_reported BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND DATE_ADD(?, INTERVAL 30 DAY)
         ORDER BY (found.location_id = ?) DESC,
                  ABS(DATEDIFF(found.date_reported, ?)) ASC,
                  found.item_id DESC
         LIMIT 5`,
        [item.category_id, item.date_reported, item.date_reported, item.location_id, item.date_reported]
      );
    }

    res.render('item-details', {
      title: item.title,
      item,
      errors: [],
      message: '',
      matches,
      hasClaim,
      success: req.query.claim === 'sent',
      duplicate: req.query.claim === 'duplicate'
    });
  } catch (err) {
    console.error('Could not load item details:', err.message);
    res.status(500).send('Could not load this item. Please try again.');
  }
});

router.post('/items/:id/claim', requireLogin, async (req, res) => {
  const itemId = parseItemId(req.params.id);
  if (itemId === null) {
    return res.status(404).send('Item not found.');
  }

  const message = (typeof req.body.message === 'string' ? req.body.message : '').trim();

  try {
    const item = await getItemDetails(itemId);
    if (!item) return res.status(404).send('Item not found.');
    if (item.type !== 'found' || item.status !== 'open') {
      return res.redirect(`/items/${itemId}`);
    }
    if (item.reported_by === req.session.user.user_id) {
      return res.redirect(`/items/${itemId}`);
    }

    const [existingClaims] = await pool.query(
      'SELECT claim_id FROM claims WHERE item_id = ? AND claimed_by = ? LIMIT 1',
      [itemId, req.session.user.user_id]
    );
    if (existingClaims.length) return res.redirect(`/items/${itemId}?claim=duplicate`);

    const errors = [];
    if (message.length < 10) errors.push('Please add at least 10 characters to explain how you can identify this item.');
    if (message.length > 1000) errors.push('Your message must be 1,000 characters or fewer.');

    if (errors.length) {
      return res.status(400).render('item-details', {
        title: item.title, item, errors, message, matches: [], hasClaim: false, success: false, duplicate: false
      });
    }

    await pool.query(
      'INSERT INTO claims (item_id, claimed_by, message) VALUES (?, ?, ?)',
      [itemId, req.session.user.user_id, message]
    );
    res.redirect(`/items/${itemId}?claim=sent`);
  } catch (err) {
    console.error('Could not submit item claim:', err.message);
    res.status(500).send('Could not submit your claim. Please try again.');
  }
});

router.get('/items', async (req, res) => {
  const filters = {
    keyword: (typeof req.query.keyword === 'string' ? req.query.keyword : '').trim().slice(0, 100),
    type: ['lost', 'found'].includes(req.query.type) ? req.query.type : '',
    category_id: /^\d+$/.test(req.query.category_id || '') ? req.query.category_id : '',
    location_id: /^\d+$/.test(req.query.location_id || '') ? req.query.location_id : '',
    date_from: typeof req.query.date_from === 'string' && isValidDate(req.query.date_from) ? req.query.date_from : '',
    date_to: typeof req.query.date_to === 'string' && isValidDate(req.query.date_to) ? req.query.date_to : ''
  };

  try {
    const options = await getFormOptions();
    const conditions = [];
    const values = [];

    if (filters.keyword) {
      conditions.push('(i.title LIKE ? OR i.description LIKE ?)');
      values.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
    }
    if (filters.type) {
      conditions.push('i.type = ?');
      values.push(filters.type);
    }
    if (filters.category_id) {
      conditions.push('i.category_id = ?');
      values.push(Number(filters.category_id));
    }
    if (filters.location_id) {
      conditions.push('i.location_id = ?');
      values.push(Number(filters.location_id));
    }
    if (filters.date_from) {
      conditions.push('i.date_reported >= ?');
      values.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push('i.date_reported <= ?');
      values.push(filters.date_to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [items] = await pool.query(
      `SELECT i.item_id, i.title, i.description, i.type, i.status, i.date_reported,
              c.name AS category, l.name AS location
       FROM items AS i
       LEFT JOIN categories AS c ON c.category_id = i.category_id
       LEFT JOIN locations AS l ON l.location_id = i.location_id
       ${where}
       ORDER BY i.date_reported DESC, i.item_id DESC`,
      values
    );

    res.render('items', { title: 'Browse items', items, filters, ...options });
  } catch (err) {
    console.error('Could not load item list:', err.message);
    res.status(500).send('Could not load items. Check that MySQL is running and the lostfound tables are available.');
  }
});

router.get('/report', requireLogin, async (req, res) => {
  try {
    const options = await getFormOptions();
    res.render('report', {
      title: 'Report an item',
      errors: [],
      form: { type: 'lost', date_reported: new Date().toISOString().slice(0, 10) },
      success: req.query.success === '1',
      ...options
    });
  } catch (err) {
    console.error('Could not load report form options:', err.message);
    res.status(500).send('Could not load the report form. Please try again.');
  }
});

router.post('/report', requireLogin, async (req, res) => {
  const title = (typeof req.body.title === 'string' ? req.body.title : '').trim();
  const description = (typeof req.body.description === 'string' ? req.body.description : '').trim();
  const type = req.body.type;
  const dateReported = typeof req.body.date_reported === 'string' ? req.body.date_reported : '';
  const categoryId = Number(req.body.category_id);
  const locationId = Number(req.body.location_id);
  const errors = [];

  if (!title || title.length > 100) errors.push('Item name is required and must be 100 characters or fewer.');
  if (description.length > 5000) errors.push('Description must be 5,000 characters or fewer.');
  if (!['lost', 'found'].includes(type)) errors.push('Choose whether the item was lost or found.');
  if (!isValidDate(dateReported)) {
    errors.push('Enter a valid date.');
  }
  if (!Number.isInteger(categoryId) || categoryId < 1) errors.push('Choose a category.');
  if (!Number.isInteger(locationId) || locationId < 1) errors.push('Choose a location.');

  try {
    const options = await getFormOptions();
    if (!options.categories.some((category) => category.category_id === categoryId)) errors.push('Choose a listed category.');
    if (!options.locations.some((location) => location.location_id === locationId)) errors.push('Choose a listed location.');

    if (errors.length) {
      return res.status(400).render('report', {
        title: 'Report an item', errors,
        form: { title, description, type, date_reported: dateReported, category_id: categoryId, location_id: locationId },
        success: false,
        ...options
      });
    }

    await pool.query(
      `INSERT INTO items (title, description, type, date_reported, category_id, location_id, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, description || null, type, dateReported, categoryId, locationId, req.session.user.user_id]
    );
    res.redirect('/report?success=1');
  } catch (err) {
    console.error('Could not save item report:', err.message);
    res.status(500).send('Could not save your report. Please try again.');
  }
});

module.exports = router;
