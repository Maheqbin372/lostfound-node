const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

// Outside the project and public directory, so Live Share guests and web visitors
// cannot retrieve password-reset messages through the website.
const outboxDirectory = path.join(os.tmpdir(), `lostfound-recovery-${process.getuid?.() ?? 'local'}`);

function recoveryAvailable() {
  return process.env.NODE_ENV !== 'production';
}

async function sendRecoveryMessage(email, resetUrl) {
  if (!recoveryAvailable()) throw new Error('Email recovery is not configured.');
  await fs.mkdir(outboxDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(outboxDirectory, 0o700);
  // Remove only expired recovery-message files owned by this local outbox.
  for (const name of await fs.readdir(outboxDirectory)) {
    if (!/^recovery-[a-f0-9-]+\.txt$/.test(name)) continue;
    const file = path.join(outboxDirectory, name);
    const stat = await fs.lstat(file);
    if (stat.isFile() && Date.now() - stat.mtimeMs > 15 * 60 * 1000) await fs.unlink(file);
  }
  const destination = path.join(outboxDirectory, `recovery-${randomUUID()}.txt`);
  await fs.writeFile(destination, [
    'Lost & Found - password recovery',
    `To: ${email}`,
    '',
    'Open this link on the host laptop to choose a new password:',
    resetUrl,
    '',
    'This link expires in 15 minutes and works only once.',
    'Only the most recently requested link for this account will work.',
    'If you did not request this, leave your password unchanged.'
  ].join('\n'), { mode: 0o600, flag: 'wx' });
}

module.exports = { sendRecoveryMessage, recoveryAvailable, outboxDirectory };
