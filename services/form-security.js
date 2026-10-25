const { randomBytes, timingSafeEqual } = require('node:crypto');
const buckets = new Map();

function formToken(req) {
  if (!req.session.formCsrf) req.session.formCsrf = randomBytes(32).toString('hex');
  return req.session.formCsrf;
}

function validFormToken(req) {
  const supplied = req.body?.csrf;
  const expected = req.session?.formCsrf;
  return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied)
    && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected)
    && timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}

function rateLimited(key, maximum, windowMs = 60000) {
  const now = Date.now();
  for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { count: 0, until: now + windowMs };
    buckets.set(key, bucket);
  }
  return ++bucket.count > maximum;
}

module.exports = { formToken, validFormToken, rateLimited };
