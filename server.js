const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  // Set SESSION_SECRET to a private value before deploying this project.
  secret: process.env.SESSION_SECRET || 'lost-found-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 2 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get('/test', async (req, res) => {
  try {
    const [categories] = await pool.query(
      'SELECT category_id, name FROM categories ORDER BY category_id'
    );
    res.render('test', { title: 'Database test', categories });
  } catch (error) {
    console.error('Could not load categories:', error.message);
    res.status(500).send('Could not connect to the lostfound database. Check that MySQL is running.');
  }
});

app.get('/', async (req, res) => {
  try {
    const [latest] = await pool.query(
      `SELECT i.item_id, i.title, i.type, i.status,
              c.name AS category, l.name AS location, i.date_reported
       FROM items AS i
       LEFT JOIN categories AS c ON c.category_id = i.category_id
       LEFT JOIN locations AS l ON l.location_id = i.location_id
       ORDER BY i.date_reported DESC
       LIMIT 6`
    );
    res.render('index', { title: 'Home', latest });
  } catch (error) {
    console.error('Could not load latest reports:', error.message);
    res.status(500).send('Could not load reports. Check that MySQL is running and the lostfound tables are available.');
  }
});

app.use(itemRoutes);
app.use(authRoutes);
app.use(adminRoutes);

app.listen(PORT, () => {
  console.log(`Lost & Found is running at http://localhost:${PORT}`);
});
