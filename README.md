# Lost & Found

A course project website for reporting lost or found items. It uses Node.js, Express, EJS, and MySQL.

## Current features

- Home page with the latest reports
- Browse reports with keyword, lost/found, category, location, and date range filters
- Item detail pages and logged-in ownership claims for open found items
- Admin claim review: approve or reject pending claims
- Matching suggestions for open lost items using category, location, and nearby report dates
- Account registration, login, and logout
- Password recovery with expiring, single-use links and invalidation of existing sessions
- Lost/found report form with category and location choices
- Report validation and database saving for the signed-in user
- Responsive layout using Times New Roman

## Run locally

1. Install Node.js and start MySQL through MAMP.
2. Create the `lostfound` database and import `database/schema.sql`.
3. Copy `db.local.example.js` to `db.local.js`, then enter your local MySQL connection details in `db.local.js`.
4. In this folder, run `npm install` and then `npm start`.
5. Open `http://localhost:3000` and create an account to submit a report.

The local connection file `db.local.js` is ignored by Git. Do not upload private database credentials, account data, or exported database backups to a public repository.

See [database/ER-diagram.md](database/ER-diagram.md) for the database relationships.

## Admin access

New accounts are ordinary users. To give an existing trusted account admin access, run this in MySQL Workbench after replacing the example email with that account's email:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

Then log out and back in so the website refreshes the account's role in the session. Do not expose admin access to accounts you do not trust.

## Password recovery

For an existing database, run `node database/migrations/001-password-reset.js` once before starting the updated server. The migration can be rerun safely. Fresh databases include the recovery table in `database/schema.sql`.

The login page links to **Forgot password?**. Recovery links expire after 15 minutes, work once, and are stored in the database only as SHA-256 hashes. A successful reset invalidates older sessions and other reset links. Recovery requests have rate limits and do not reveal whether an email is registered.

This local version writes recovery messages to a private temporary folder outside the project; it does not send email or show reset links on public pages. The local folder is available through `require('./services/recovery-mail').outboxDirectory`. Only the host laptop user should access it. `APP_BASE_URL` controls the fixed link origin (default `http://localhost:3000`); it is never taken from a request header.

Outgoing email has not been configured. Recovery requests are disabled when `NODE_ENV=production` until an email delivery service is implemented.
