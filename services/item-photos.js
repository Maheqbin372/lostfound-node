const multer = require('multer');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const photoDirectory = path.join(__dirname, '..', 'storage', 'item-photos');
const photoNameValid = name => typeof name === 'string' && /^[a-f0-9-]{36}\.webp$/.test(name);
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, parts: 12, fieldSize: 24000 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Choose a JPG, PNG or WebP photo.'));
    }
    callback(null, true);
  }
}).single('photo');

function receivePhoto(req, res, next) {
  parser(req, res, error => {
    if (error) req.photoError = error.code === 'LIMIT_FILE_SIZE'
      ? 'Photo must be 5 MB or smaller.'
      : error instanceof multer.MulterError ? 'Upload one photo, 5 MB or smaller.' : error.message;
    next();
  });
}

async function savePhoto(file) {
  if (!file) return null;
  let data;
  try {
    const image = sharp(file.buffer, { limitInputPixels: 20_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('unsupported');
    // Decode and re-encode instead of trusting names, MIME headers or metadata.
    data = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    const error = new Error('Choose a readable, non-animated JPG, PNG or WebP photo under 20 megapixels.');
    error.invalidPhoto = true;
    throw error;
  }
  await fs.mkdir(photoDirectory, { recursive: true, mode: 0o700 });
  const filename = `${randomUUID()}.webp`;
  try {
    await fs.writeFile(path.join(photoDirectory, filename), data, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await fs.unlink(path.join(photoDirectory, filename)).catch(() => {});
    throw error;
  }
  return filename;
}

async function removePhoto(filename) {
  if (photoNameValid(filename)) await fs.unlink(path.join(photoDirectory, filename)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { receivePhoto, savePhoto, removePhoto, photoDirectory, photoNameValid };
