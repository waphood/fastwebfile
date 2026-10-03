const express = require('express');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const QRCode  = require('qrcode');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const zlib    = require('zlib');
const { startBot, stopBot, updateAppUrl, validateAdminToken, verifyTelegramWebAppData, getConfig } = require('./bot');

const app  = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CHUNKS_DIR  = path.join(__dirname, 'uploads', 'chunks');
const DB_FILE     = path.join(__dirname, 'files_db.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CHUNKS_DIR))  fs.mkdirSync(CHUNKS_DIR,  { recursive: true });

// ── In-memory P2P WebRTC rooms & SSE subscribers ──────────────────────────────
const p2pRooms = new Map();

// ── DB helpers ────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── Short ID: 5 alphanumeric chars ────────────────────────────────────────────
const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous 0/o/l/1/i
function makeId(db) {
  for (let tries = 0; tries < 500; tries++) {
    let id = '';
    for (let i = 0; i < 5; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
    const upper = id.toUpperCase();
    if (db[id] || db[upper] || p2pRooms.has(upper)) continue;
    return id;
  }
  return uuidv4().slice(0, 8); // fallback
}

// ── PIN: always exact uppercase of ID (e.g. link /f/ts5zm -> PIN TS5ZM) ───────
function makePin(idOrDb) {
  if (typeof idOrDb === 'string') return idOrDb.toUpperCase();
  return makeId(idOrDb).toUpperCase();
}

// ── Entry resolver: case-insensitive & PIN compatible ────────────────────────
function getEntry(db, rawId) {
  if (!rawId) return null;
  const key = String(rawId).trim();
  if (db[key]) return db[key];
  const lower = key.toLowerCase();
  if (db[lower]) return db[lower];
  const upper = key.toUpperCase();
  if (db[upper]) return db[upper];
  for (const [id, entry] of Object.entries(db)) {
    if (id.toLowerCase() === lower || id.toUpperCase() === upper) return entry;
    if (entry.pin && entry.pin.toUpperCase() === upper) return entry;
  }
  return null;
}

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Fix Multer latin1→utf8 encoding bug for Cyrillic
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auto-detect public HTTPS hostname (e.g. *.onrender.com or custom domain)
app.use((req, res, next) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  if (host && proto === 'https' && !host.includes('localhost') && !host.includes('127.0.0.1') && !host.includes('serveousercontent') && !host.includes('pinggy')) {
    updateAppUrl(`https://${host}`);
  }
  next();
});

// ── Shared: build expiry ──────────────────────────────────────────────────────
function buildExpiry(expiry) {
  if (expiry === '1day')  return Date.now() + 86400000;
  if (expiry === '3days') return Date.now() + 259200000;
  return null; // 'once'
}

// ── Password helpers ──────────────────────────────────────────────────────────
function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '').trim(), 'utf8').digest('hex');
}
function checkPassword(entry, pwd) {
  if (!entry.passwordHash) return true;        // not protected
  if (!pwd) return false;                      // protected but no password given
  return entry.passwordHash === hashPassword(pwd);
}

// ── Upload (separate links per file OR one bundle) ────────────────────────────
app.post('/api/upload', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || !req.files.length)
      return res.status(400).json({ error: 'No files uploaded' });

    const { expiry = 'once', bundle = 'false', password = '', note = '', description = '' } = req.body;
    const isBundle = bundle === 'true';
    const pwdRaw = typeof password === 'string' ? password.trim() : '';
    const passwordHash = pwdRaw.length > 0 ? hashPassword(pwdRaw) : null;
    const userNote = String(note || description || '').trim().slice(0, 500);

    const db       = loadDB();
    const host     = req.headers.host || `localhost:${PORT}`;
    const proto    = req.headers['x-forwarded-proto'] || 'http';
    const base     = `${proto}://${host}`;
    const expiresAt = buildExpiry(expiry);

    // ── BUNDLE MODE ──────────────────────────────────────────────────────────
    if (isBundle) {
      const bundleId = makeId(db);
      const bundlePin = bundleId.toUpperCase();
      const bundleFiles = req.files.map(f => ({
        id:           makeId(db),   // individual IDs for future single-dl
        filename:     f.filename,
        originalName: f.originalname,
        size:         f.size,
        mimetype:     f.mimetype,
      }));

      db[bundleId] = {
        id:          bundleId,
        pin:         bundlePin,
        type:        'bundle',
        description: userNote || null,
        files:       bundleFiles,
        expiry,
        expiresAt,
        passwordHash,
        uploadedAt:  Date.now(),
      };
      saveDB(db);

      const bundleUrl = `${base}/b/${bundleId}`;
      const qrDataUrl = await makeQR(bundleUrl);

      return res.json({
        mode: 'bundle',
        bundle: {
          id:          bundleId,
          pin:         bundlePin,
          description: userNote || null,
          url:         bundleUrl,
          qrCode:      qrDataUrl,
          expiry,
          hasPassword: !!passwordHash,
          fileCount:   bundleFiles.length,
          totalSize:   bundleFiles.reduce((s, f) => s + f.size, 0),
          files:       bundleFiles.map(f => ({ originalName: f.originalName, size: f.size })),
        }
      });
    }

    // ── SEPARATE MODE ────────────────────────────────────────────────────────
    const results = [];
    for (const f of req.files) {
      const id = makeId(db);
      const pin = id.toUpperCase();
      db[id] = {
        id,
        pin,
        type:         'file',
        description:  userNote || null,
        filename:     f.filename,
        originalName: f.originalname,
        size:         f.size,
        mimetype:     f.mimetype,
        expiry,
        expiresAt,
        passwordHash,
        uploadedAt:   Date.now(),
        downloaded:   false,
      };
      const url = `${base}/f/${id}`;
      results.push({ id, pin, downloadUrl: url, qrCode: await makeQR(url),
                     originalName: f.originalname, size: f.size, expiry,
                     hasPassword: !!passwordHash, description: userNote || null });
    }
    saveDB(db);
    res.json({ mode: 'separate', files: results, hasPassword: !!passwordHash, description: userNote || null });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function makeQR(url) {
  return QRCode.toDataURL(url, { width: 260, margin: 1,
    color: { dark: '#1a1a2e', light: '#ffffff' } });
}

// ── Verify password ───────────────────────────────────────────────────────────
app.post('/api/verify-password/:id', express.json(), (req, res) => {
  const db    = loadDB();
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const ok = checkPassword(entry, req.body.password);
  res.json({ ok });
});

// ── PIN lookup (QuickShare 5-character alphanumeric code) ─────────────────────
app.get('/api/pin/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Код должен состоять из 5 символов (буквы и цифры)' });
  }

  // Check active P2P room
  if (p2pRooms.has(code)) {
    return res.json({
      ok: true,
      id: code,
      type: 'p2p',
      url: `/p2p/${code}`
    });
  }

  const db = loadDB();
  const entry = getEntry(db, code);
  if (entry) {
    const entryId = entry.id;
    if (isExpired(entry)) {
      deleteEntry(entryId, db);
      return res.status(410).json({ error: 'Срок действия файла истёк' });
    }
    if (entry.type === 'file' && entry.expiry === 'once' && entry.downloaded) {
      return res.status(410).json({ error: 'Файл уже был скачан' });
    }
    let targetUrl = `/f/${entry.id}`;
    if (entry.type === 'bundle') targetUrl = `/b/${entry.id}`;
    else if (entry.type === 'drop') targetUrl = `/drop/${entry.id}`;

    return res.json({
      ok: true,
      id: entry.id,
      pin: (entry.pin || entry.id).toUpperCase(),
      type: entry.type,
      url: targetUrl
    });
  }
  res.status(404).json({ error: 'Код не найден или истёк' });
});

// ── Direct PIN redirect (/p/ABC12) ───────────────────────────────────────────
app.get('/p/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (p2pRooms.has(code)) {
    return res.redirect(`/p2p/${code}`);
  }
  const db = loadDB();
  const entry = getEntry(db, code);
  if (entry) {
    const entryId = entry.id;
    if (isExpiredSend(entry, entryId, db)) {
      return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
    }
    if (entry.type === 'file' && entry.expiry === 'once' && entry.downloaded) {
      return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
    }
    let targetUrl = `/f/${entry.id}`;
    if (entry.type === 'bundle') targetUrl = `/b/${entry.id}`;
    else if (entry.type === 'drop') targetUrl = `/drop/${entry.id}`;
    return res.redirect(targetUrl);
  }
  res.redirect('/?pin_err=1');
});

// ── File info ─────────────────────────────────────────────────────────────────
app.get('/api/file/:id', (req, res) => {
  const db   = loadDB();
  const file = getEntry(db, req.params.id);
  if (!file || file.type !== 'file') return res.status(404).json({ error: 'Not found' });
  if (isExpired(file)) { deleteEntry(file.id, db); return res.status(410).json({ error: 'Expired' }); }
  if (file.expiry === 'once' && file.downloaded) return res.status(410).json({ error: 'Already downloaded' });
  res.json({ id: file.id, pin: (file.pin || file.id).toUpperCase(), description: file.description || null,
             originalName: file.originalName, size: file.size,
             mimetype: file.mimetype, expiry: file.expiry, expiresAt: file.expiresAt,
             hasPassword: !!file.passwordHash });
});

// ── Bundle info ───────────────────────────────────────────────────────────────
app.get('/api/bundle/:id', (req, res) => {
  const db     = loadDB();
  const bundle = getEntry(db, req.params.id);
  if (!bundle || bundle.type !== 'bundle') return res.status(404).json({ error: 'Not found' });
  if (isExpired(bundle)) { deleteEntry(bundle.id, db); return res.status(410).json({ error: 'Expired' }); }
  res.json({
    id:          bundle.id,
    pin:         (bundle.pin || bundle.id).toUpperCase(),
    description: bundle.description || null,
    expiry:      bundle.expiry,
    expiresAt:   bundle.expiresAt,
    uploadedAt:  bundle.uploadedAt,
    hasPassword: !!bundle.passwordHash,
    files: bundle.files.map(f => ({
      id: f.id, originalName: f.originalName, size: f.size, mimetype: f.mimetype
    }))
  });
});

// ── Single file download page ─────────────────────────────────────────────────
app.get('/f/:id', (req, res) => {
  const db   = loadDB();
  const file = getEntry(db, req.params.id);
  if (!file || file.type !== 'file' || isExpiredSend(file, file.id, db))
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  if (file.expiry === 'once' && file.downloaded)
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// ── Bundle page ───────────────────────────────────────────────────────────────
app.get('/b/:id', (req, res) => {
  const db     = loadDB();
  const bundle = getEntry(db, req.params.id);
  if (!bundle || bundle.type !== 'bundle' || isExpiredSend(bundle, bundle.id, db))
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'bundle.html'));
});

// ── Pure JS Zip Archive Generator ─────────────────────────────────────────────
function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function buildZip(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf8');
    const rawData = entry.data;
    const uncompressedSize = rawData.length;
    const fileCrc = crc32(rawData);
    const compressedData = zlib.deflateRawSync(rawData);
    const compressedSize = compressedData.length;

    // Local Header
    const lh = Buffer.alloc(30 + filenameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);         // version needed
    lh.writeUInt16LE(0x0800, 6);     // flags: UTF-8
    lh.writeUInt16LE(8, 8);          // compression: Deflate
    lh.writeUInt16LE(0, 10);         // mod time
    lh.writeUInt16LE(0, 12);         // mod date
    lh.writeUInt32LE(fileCrc, 14);   // crc32
    lh.writeUInt32LE(compressedSize, 18);
    lh.writeUInt32LE(uncompressedSize, 22);
    lh.writeUInt16LE(filenameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    filenameBuf.copy(lh, 30);

    localHeaders.push(lh, compressedData);

    // Central Directory Header
    const ch = Buffer.alloc(46 + filenameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(20, 4);         // version made by
    ch.writeUInt16LE(20, 6);         // version needed
    ch.writeUInt16LE(0x0800, 8);     // flags: UTF-8
    ch.writeUInt16LE(8, 10);         // compression: Deflate
    ch.writeUInt16LE(0, 12);         // mod time
    ch.writeUInt16LE(0, 14);         // mod date
    ch.writeUInt32LE(fileCrc, 16);
    ch.writeUInt32LE(compressedSize, 20);
    ch.writeUInt32LE(uncompressedSize, 24);
    ch.writeUInt16LE(filenameBuf.length, 28);
    ch.writeUInt16LE(0, 30);         // extra len
    ch.writeUInt16LE(0, 32);         // comment len
    ch.writeUInt16LE(0, 34);         // disk start
    ch.writeUInt16LE(0, 36);         // internal attr
    ch.writeUInt32LE(0, 38);         // external attr
    ch.writeUInt32LE(offset, 42);    // local header offset
    filenameBuf.copy(ch, 46);

    centralHeaders.push(ch);
    offset += lh.length + compressedData.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);

  // End of Central Directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // start disk
  eocd.writeUInt16LE(entries.length, 8);  // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20);         // comment len

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// ── Range & Streaming Helper (HTTP 206 Partial Content) ──────────────────────
function sendFileWithRange(req, res, fp, entry, isDownload = false) {
  const stat = fs.statSync(fp);
  const fileSize = stat.size;
  const range = req.headers.range;
  const enc = encodeURIComponent(entry.originalName).replace(/'/g, '%27');
  const disposition = isDownload ? 'attachment' : 'inline';

  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${enc}`);
  res.setHeader('Accept-Ranges', 'bytes');

  let mime = entry.mimetype || 'application/octet-stream';
  const lower = (entry.originalName || '').toLowerCase();
  if (lower.endsWith('.pdf')) mime = 'application/pdf';
  else if (lower.endsWith('.mp4')) mime = 'video/mp4';
  else if (lower.endsWith('.webm')) mime = 'video/webm';
  else if (lower.endsWith('.mp3')) mime = 'audio/mpeg';
  else if (lower.endsWith('.wav')) mime = 'audio/wav';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunksize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunksize,
      'Content-Type': mime
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime
    });
    fs.createReadStream(fp).pipe(res);
  }
}

// ── Actual file download ──────────────────────────────────────────────────────
app.get('/api/download/:id', (req, res) => {
  const db   = loadDB();
  const file = getEntry(db, req.params.id);

  let entry    = file;
  let parentId = file ? file.id : req.params.id;
  if (!entry) {
    // search inside bundles
    const searchId = String(req.params.id || '').toUpperCase();
    for (const [bid, rec] of Object.entries(db)) {
      if (rec.type === 'bundle') {
        const bf = rec.files.find(f => f.id === req.params.id || f.id.toUpperCase() === searchId);
        if (bf) {
          entry    = { ...bf, expiry: rec.expiry, expiresAt: rec.expiresAt,
                       passwordHash: rec.passwordHash, downloaded: false };
          parentId = bid;
          break;
        }
      }
    }
  }
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (isExpired(entry)) return res.status(410).json({ error: 'Expired' });
  if (entry.expiry === 'once' && entry.downloaded) return res.status(410).json({ error: 'Already downloaded' });

  if (!checkPassword(entry, req.query.pwd || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const fp = path.join(UPLOADS_DIR, entry.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File missing on disk' });

  if (entry.expiry === 'once' && file) { file.downloaded = true; saveDB(db); }

  sendFileWithRange(req, res, fp, entry, true);
});

// ── Inline file preview / stream / view ───────────────────────────────────────
app.get('/api/view/:id', (req, res) => {
  const db   = loadDB();
  const file = getEntry(db, req.params.id);

  let entry = file;
  if (!entry) {
    const searchId = String(req.params.id || '').toUpperCase();
    for (const [bid, rec] of Object.entries(db)) {
      if (rec.type === 'bundle') {
        const bf = rec.files.find(f => f.id === req.params.id || f.id.toUpperCase() === searchId);
        if (bf) {
          entry = { ...bf, expiry: rec.expiry, expiresAt: rec.expiresAt,
                    passwordHash: rec.passwordHash, downloaded: false };
          break;
        }
      }
    }
  }
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (isExpired(entry)) return res.status(410).json({ error: 'Expired' });

  if (!checkPassword(entry, req.query.pwd || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const fp = path.join(UPLOADS_DIR, entry.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File missing on disk' });

  sendFileWithRange(req, res, fp, entry, false);
});

// ── Bundle ZIP download ───────────────────────────────────────────────────────
app.get('/api/bundle/:id/zip', (req, res) => {
  const db     = loadDB();
  const bundle = getEntry(db, req.params.id);
  if (!bundle || bundle.type !== 'bundle') return res.status(404).json({ error: 'Not found' });
  if (isExpired(bundle)) return res.status(410).json({ error: 'Expired' });

  if (!checkPassword(bundle, req.query.pwd || '')) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const entries = [];
  for (const f of bundle.files) {
    const fp = path.join(UPLOADS_DIR, f.filename);
    if (fs.existsSync(fp)) {
      entries.push({
        name: f.originalName,
        data: fs.readFileSync(fp)
      });
    }
  }

  const zipBuf = buildZip(entries);
  const zipName = `bundle-${bundle.id}.zip`;
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', zipBuf.length);
  res.send(zipBuf);
});

// ── SMART RESUME / CHUNKED UPLOADS ────────────────────────────────────────────
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    const targetDir = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'chunk_' + String(req.body.chunkIndex));
  }
});
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/upload/chunk-init', (req, res) => {
  try {
    const { filename, totalChunks, totalSize, expiry = 'once', password = '', note = '' } = req.body;
    const uploadId = makeId(loadDB()) + '_' + Date.now();
    const sessionDir = path.join(CHUNKS_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const meta = {
      uploadId,
      filename: Buffer.from(filename || 'file', 'latin1').toString('utf8'),
      totalChunks: parseInt(totalChunks, 10),
      totalSize: parseInt(totalSize, 10),
      expiry,
      password: String(password || '').trim(),
      note: String(note || '').trim().slice(0, 500),
      createdAt: Date.now()
    };
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta));
    res.json({ ok: true, uploadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/chunk', chunkUpload.single('chunk'), (req, res) => {
  const { uploadId, chunkIndex } = req.body;
  res.json({ ok: true, uploadId, chunkIndex: parseInt(chunkIndex, 10) });
});

app.get('/api/upload/chunk-status/:uploadId', (req, res) => {
  const sessionDir = path.join(CHUNKS_DIR, req.params.uploadId);
  if (!fs.existsSync(sessionDir)) return res.status(404).json({ error: 'Session not found' });

  const files = fs.readdirSync(sessionDir);
  const uploaded = files
    .filter(f => f.startsWith('chunk_'))
    .map(f => parseInt(f.replace('chunk_', ''), 10))
    .sort((a, b) => a - b);

  res.json({ uploadedChunks: uploaded });
});

app.post('/api/upload/chunk-complete', async (req, res) => {
  try {
    const { uploadId } = req.body;
    const sessionDir = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(sessionDir)) return res.status(404).json({ error: 'Session not found' });

    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf8'));
    const finalExt = path.extname(meta.filename);
    const finalFilename = uuidv4() + finalExt;
    const finalPath = path.join(UPLOADS_DIR, finalFilename);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkPath = path.join(sessionDir, 'chunk_' + i);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        try { fs.unlinkSync(finalPath); } catch {}
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
    }
    writeStream.end();

    // Remove chunk session folder
    fs.rmSync(sessionDir, { recursive: true, force: true });

    // Store in DB
    const db = loadDB();
    const id = makeId(db);
    const pin = id.toUpperCase();
    const passwordHash = meta.password ? hashPassword(meta.password) : null;
    const expiresAt = buildExpiry(meta.expiry);

    db[id] = {
      id,
      pin,
      type:         'file',
      description:  meta.note || null,
      filename:     finalFilename,
      originalName: meta.filename,
      size:         meta.totalSize,
      mimetype:     'application/octet-stream',
      expiry:       meta.expiry,
      expiresAt,
      passwordHash,
      uploadedAt:   Date.now(),
      downloaded:   false,
    };
    saveDB(db);

    const host  = req.headers.host || `localhost:${PORT}`;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = `${proto}://${host}`;
    const url   = `${base}/f/${id}`;
    const qrCode = await makeQR(url);

    res.json({
      mode: 'separate',
      files: [{
        id, pin, downloadUrl: url, qrCode,
        originalName: meta.filename, size: meta.totalSize,
        expiry: meta.expiry, hasPassword: !!passwordHash,
        description: meta.note || null
      }],
      hasPassword: !!passwordHash,
      description: meta.note || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── DROP-ПАПКА (FILE REQUEST / СБОР ФАЙЛОВ) ──────────────────────────────────
app.get('/drop/:id', (req, res) => {
  const db = loadDB();
  const drop = getEntry(db, req.params.id);
  if (!drop || drop.type !== 'drop' || isExpiredSend(drop, drop.id, db)) {
    return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'drop.html'));
});

app.post('/api/drop/create', async (req, res) => {
  try {
    const { title = 'Drop-папка', expiry = '3days', password = '' } = req.body;
    const db = loadDB();
    const dropId = makeId(db);
    const pin = dropId.toUpperCase();
    const ownerKey = crypto.randomBytes(16).toString('hex');
    const pwdRaw = String(password || '').trim();
    const passwordHash = pwdRaw ? hashPassword(pwdRaw) : null;
    const expiresAt = buildExpiry(expiry);

    db[dropId] = {
      id: dropId,
      pin,
      type: 'drop',
      title: String(title).trim().slice(0, 100) || 'Drop-папка',
      ownerKey,
      files: [],
      expiry,
      expiresAt,
      passwordHash,
      uploadedAt: Date.now()
    };
    saveDB(db);

    const host  = req.headers.host || `localhost:${PORT}`;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base  = `${proto}://${host}`;
    const dropUrl = `${base}/drop/${dropId}`;
    const qrCode = await makeQR(dropUrl);

    res.json({
      ok: true,
      drop: {
        id: dropId,
        pin,
        title: db[dropId].title,
        ownerKey,
        url: dropUrl,
        manageUrl: `${dropUrl}?key=${ownerKey}`,
        qrCode,
        expiry
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drop/:id', (req, res) => {
  const db = loadDB();
  const drop = getEntry(db, req.params.id);
  if (!drop || drop.type !== 'drop') return res.status(404).json({ error: 'Drop folder not found' });
  if (isExpired(drop)) { deleteEntry(drop.id, db); return res.status(410).json({ error: 'Expired' }); }

  const isOwner = req.query.key && req.query.key === drop.ownerKey;
  res.json({
    id: drop.id,
    pin: (drop.pin || drop.id).toUpperCase(),
    title: drop.title,
    expiry: drop.expiry,
    expiresAt: drop.expiresAt,
    uploadedAt: drop.uploadedAt,
    hasPassword: !!drop.passwordHash,
    isOwner: !!isOwner,
    files: drop.files.map(f => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      mimetype: f.mimetype,
      senderName: f.senderName,
      uploadedAt: f.uploadedAt
    }))
  });
});

app.post('/api/drop/:id/upload', upload.array('files', 20), (req, res) => {
  const db = loadDB();
  const drop = getEntry(db, req.params.id);
  if (!drop || drop.type !== 'drop') return res.status(404).json({ error: 'Drop folder not found' });
  if (isExpired(drop)) return res.status(410).json({ error: 'Expired' });

  if (drop.passwordHash && !checkPassword(drop, req.body.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const senderName = String(req.body.senderName || 'Аноним').trim().slice(0, 50);
  const added = [];

  for (const f of req.files) {
    const fileId = makeId(db);
    const rec = {
      id:           fileId,
      filename:     f.filename,
      originalName: f.originalname,
      size:         f.size,
      mimetype:     f.mimetype,
      senderName,
      uploadedAt:   Date.now()
    };
    drop.files.push(rec);
    added.push({ id: fileId, originalName: f.originalname, size: f.size, senderName });
  }
  saveDB(db);

  res.json({ ok: true, count: added.length, files: added });
});

app.get('/api/drop/:id/zip', (req, res) => {
  const db = loadDB();
  const drop = getEntry(db, req.params.id);
  if (!drop || drop.type !== 'drop') return res.status(404).json({ error: 'Not found' });
  if (isExpired(drop)) return res.status(410).json({ error: 'Expired' });

  if (drop.passwordHash && !checkPassword(drop, req.query.pwd)) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const entries = [];
  for (const f of drop.files) {
    const fp = path.join(UPLOADS_DIR, f.filename);
    if (fs.existsSync(fp)) {
      entries.push({
        name: `${f.senderName ? f.senderName + '_' : ''}${f.originalName}`,
        data: fs.readFileSync(fp)
      });
    }
  }

  const zipBuf = buildZip(entries);
  const zipName = `drop-${drop.id}.zip`;
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', zipBuf.length);
  res.send(zipBuf);
});

// ── P2P WEBRTC SIGNALING (UNLIMITED FILE STREAMING) ───────────────────────────
app.get('/p2p', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'p2p.html'));
});
app.get('/p2p/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'p2p.html'));
});

app.post('/api/p2p/room', (req, res) => {
  const db = loadDB();
  const code = makePin(db);
  p2pRooms.set(code, {
    code,
    createdAt: Date.now(),
    clients: new Map() // role -> sse res
  });
  res.json({ ok: true, code });
});

// Server-Sent Events stream for real-time signaling
app.get('/api/p2p/events/:code/:role', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const role = req.params.role;
  let room = p2pRooms.get(code);
  if (!room) {
    room = { code, createdAt: Date.now(), clients: new Map() };
    p2pRooms.set(code, room);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  room.clients.set(role, res);

  // Notify opposite peer that this role connected
  const peerRole = role === 'sender' ? 'receiver' : 'sender';
  const peerRes = room.clients.get(peerRole);
  if (peerRes) {
    peerRes.write(`data: ${JSON.stringify({ type: 'peer_joined', role })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'peer_ready', role: peerRole })}\n\n`);
  }

  req.on('close', () => {
    if (room.clients.get(role) === res) {
      room.clients.delete(role);
      const other = room.clients.get(peerRole);
      if (other) {
        other.write(`data: ${JSON.stringify({ type: 'peer_left', role })}\n\n`);
      }
    }
  });
});

app.post('/api/p2p/signal/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const { role, signal } = req.body;
  const room = p2pRooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const targetRole = role === 'sender' ? 'receiver' : 'sender';
  const targetRes = room.clients.get(targetRole);

  if (targetRes) {
    targetRes.write(`data: ${JSON.stringify(signal)}\n\n`);
    res.json({ ok: true, delivered: true });
  } else {
    res.json({ ok: true, delivered: false, waitingForPeer: true });
  }
});
// ── AIR (LOCAL WI-FI / SAME NETWORK AIRDROP DISCOVERY) ────────────────────────
const airNetworks = new Map(); // networkKey -> Map of peerId -> peerInfo
const airRelays = new Map();   // relayId -> { fileMeta, buffer, targetPeerId, senderPeerId, createdAt }

function getClientNetworkKey(req, customRoom) {
  if (customRoom && typeof customRoom === 'string' && customRoom.trim().length > 0) {
    return 'room_' + customRoom.trim().toLowerCase().slice(0, 32);
  }
  const rawIp = req.headers['cf-connecting-ip'] ||
                (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
                req.ip ||
                req.socket?.remoteAddress ||
                '127.0.0.1';
  return 'wifi_' + crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
}

app.get('/air', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'air.html'));
});

// SSE discovery & presence stream for devices on the same Wi-Fi
app.get('/api/air/stream', (req, res) => {
  const peerId = String(req.query.peerId || uuidv4().slice(0, 8));
  const customRoom = req.query.room || '';
  const networkKey = getClientNetworkKey(req, customRoom);
  const name = String(req.query.name || 'Устройство').trim().slice(0, 32);
  const deviceType = String(req.query.deviceType || 'phone').slice(0, 16);
  const os = String(req.query.os || 'Unknown').slice(0, 16);
  const icon = String(req.query.icon || '📱').slice(0, 8);
  const color = String(req.query.color || '#5b6af0').slice(0, 16);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  if (!airNetworks.has(networkKey)) {
    airNetworks.set(networkKey, new Map());
  }
  const network = airNetworks.get(networkKey);

  const peerData = {
    peerId,
    name,
    deviceType,
    os,
    icon,
    color,
    networkKey,
    res,
    joinedAt: Date.now()
  };

  network.set(peerId, peerData);

  // Send current peers list to newly connected peer (excluding self)
  const peerList = [];
  for (const [id, p] of network.entries()) {
    if (id !== peerId) {
      peerList.push({
        peerId: p.peerId,
        name: p.name,
        deviceType: p.deviceType,
        os: p.os,
        icon: p.icon,
        color: p.color
      });
    }
  }

  // 1. Initial event to self
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    myPeerId: peerId,
    networkKey,
    isWifi: !customRoom,
    peers: peerList
  })}\n\n`);

  // 2. Broadcast peer_joined to all other peers in the same network
  const joinMsg = JSON.stringify({
    type: 'peer_joined',
    peer: {
      peerId,
      name,
      deviceType,
      os,
      icon,
      color
    }
  });

  for (const [id, p] of network.entries()) {
    if (id !== peerId) {
      try { p.res.write(`data: ${joinMsg}\n\n`); } catch {}
    }
  }

  // Keep-alive heartbeat ping every 15s
  const pingInterval = setInterval(() => {
    try { res.write(':ping\n\n'); } catch {}
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    if (network.get(peerId)?.res === res) {
      network.delete(peerId);
      if (network.size === 0) {
        airNetworks.delete(networkKey);
      } else {
        const leaveMsg = JSON.stringify({ type: 'peer_left', peerId });
        for (const [id, p] of network.entries()) {
          try { p.res.write(`data: ${leaveMsg}\n\n`); } catch {}
        }
      }
    }
  });
});

// Signal exchange (AirDrop request/accept/reject, WebRTC offer/answer/ICE)
app.post('/api/air/signal', (req, res) => {
  const { from, to, room, data } = req.body;
  if (!to || !data) return res.status(400).json({ error: 'Missing to or data' });

  const networkKey = getClientNetworkKey(req, room);
  const network = airNetworks.get(networkKey);
  if (!network) return res.status(404).json({ error: 'Network not found' });

  const target = network.get(to);
  if (!target) return res.status(404).json({ error: 'Peer not found or offline' });

  try {
    target.res.write(`data: ${JSON.stringify({
      type: 'signal',
      from,
      data
    })}\n\n`);
    res.json({ ok: true, delivered: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback high-speed relay upload/download if WebRTC direct channel is blocked
const airUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/air/relay-upload', airUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const relayId = uuidv4().slice(0, 10);
  const { targetPeerId, senderPeerId, fileName } = req.body;

  airRelays.set(relayId, {
    relayId,
    targetPeerId,
    senderPeerId,
    fileName: fileName || req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype || 'application/octet-stream',
    buffer: req.file.buffer,
    createdAt: Date.now()
  });

  // Auto clean relay after 5 minutes
  setTimeout(() => {
    airRelays.delete(relayId);
  }, 300000);

  res.json({ ok: true, relayId, size: req.file.size });
});

app.get('/api/air/relay-download/:id', (req, res) => {
  const item = airRelays.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Relay expired or not found' });

  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Length', item.fileSize);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.fileName)}"`);
  res.send(item.buffer);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function isExpired(entry) {
  return entry.expiresAt && Date.now() > entry.expiresAt;
}
function isExpiredSend(entry, id, db) {
  if (isExpired(entry)) { deleteEntry(id, db); return true; }
  return false;
}
function deleteEntry(id, db) {
  const entry = db[id];
  if (!entry) return;
  if (entry.type === 'bundle') {
    entry.files.forEach(f => {
      const fp = path.join(UPLOADS_DIR, f.filename);
      if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    });
  } else if (entry.type === 'drop') {
    entry.files.forEach(f => {
      const fp = path.join(UPLOADS_DIR, f.filename);
      if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    });
  } else {
    const fp = path.join(UPLOADS_DIR, entry.filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  }
  delete db[id];
  saveDB(db);
}

// ── Admin stats & cleanup helpers ──────────────────────────────────────────
function getDbStats() {
  const db = loadDB();
  const keys = Object.keys(db);
  let totalFiles = 0;
  let totalBytes = 0;
  let dropCount = 0;

  for (const k of keys) {
    const e = db[k];
    if (e.type === 'bundle') {
      totalFiles += (e.files || []).length;
      totalBytes += (e.files || []).reduce((acc, f) => acc + (f.size || 0), 0);
    } else if (e.type === 'drop') {
      dropCount++;
      totalFiles += (e.files || []).length;
      totalBytes += (e.files || []).reduce((acc, f) => acc + (f.size || 0), 0);
    } else {
      totalFiles += 1;
      totalBytes += (e.size || 0);
    }
  }

  return {
    totalEntries: keys.length,
    totalFiles,
    totalSizeMb: (totalBytes / 1024 / 1024).toFixed(1),
    dropCount
  };
}

function cleanExpiredFiles() {
  const db = loadDB();
  let count = 0;
  for (const id of Object.keys(db)) {
    if (isExpired(db[id])) {
      deleteEntry(id, db);
      count++;
    }
  }
  return count;
}

// ── Telegram Bot Integration ───────────────────────────────────────────────
// (bot helpers imported at top of file)

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const initData = req.headers['x-telegram-init-data'];

  if (validateAdminToken(token)) return next();

  if (initData) {
    const tgUser = verifyTelegramWebAppData(initData);
    if (tgUser && Number(tgUser.id) === 7936378054) return next();
  }

  return res.status(403).json({ ok: false, error: 'Доступ запрещен. Требуются права администратора.' });
}

// ── Admin API Endpoints ──────────────────────────────────────────────
const adminAuditLogs = [];
function logAdminAction(action, details) {
  adminAuditLogs.unshift({
    id: uuidv4().slice(0, 8),
    time: Date.now(),
    action,
    details
  });
  if (adminAuditLogs.length > 100) adminAuditLogs.pop();
}

app.get('/api/admin/files', requireAdmin, (req, res) => {
  const db = loadDB();
  const stats = getDbStats();
  const files = Object.keys(db).map(k => {
    const e = db[k];
    return {
      id: k,
      type: e.type || 'file',
      title: e.title || e.originalName || k,
      originalName: e.originalName,
      size: e.size,
      pin: e.pin || k.toUpperCase(),
      createdAt: e.createdAt || e.uploadedAt,
      expiresAt: e.expiresAt,
      downloads: e.downloads || 0,
      maxDownloads: e.maxDownloads,
      hasPassword: !!e.passwordHash,
      shredded: !!e.shredded,
      description: e.description,
      files: e.files || []
    };
  }).reverse();

  res.json({ ok: true, stats, files });
});

app.delete('/api/admin/files/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const db = loadDB();
  const entry = getEntry(db, id);
  if (!entry) return res.status(404).json({ ok: false, error: 'Файл не найден' });
  const realId = Object.keys(db).find(k => db[k] === entry) || id;
  const title = entry.title || entry.originalName || realId;
  deleteEntry(realId, db);
  logAdminAction('Удаление файла', `Удален "${title}" (ID: ${realId})`);
  res.json({ ok: true, deleted: realId });
});

app.post('/api/admin/files/bulk-delete', requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ ok: false, error: 'Не указаны файлы для удаления' });
  }
  const db = loadDB();
  let deletedCount = 0;
  for (const id of ids) {
    const entry = getEntry(db, id);
    if (entry) {
      const realId = Object.keys(db).find(k => db[k] === entry) || id;
      deleteEntry(realId, db);
      deletedCount++;
    }
  }
  logAdminAction('Массовое удаление', `Удалено ${deletedCount} файлов`);
  res.json({ ok: true, deletedCount });
});

// Extend file expiry (+hours or -1 for permanent)
app.post('/api/admin/files/:id/extend', requireAdmin, (req, res) => {
  const { hours = 24 } = req.body;
  const db = loadDB();
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'Файл не найден' });

  if (hours === -1) {
    entry.expiresAt = null;
    entry.expiry = 'never';
  } else {
    const baseTime = (entry.expiresAt && entry.expiresAt > Date.now()) ? entry.expiresAt : Date.now();
    entry.expiresAt = baseTime + Number(hours) * 3600 * 1000;
  }
  saveDB(db);
  const title = entry.title || entry.originalName || req.params.id;
  logAdminAction('Продление срока', `Продлен "${title}" (+${hours === -1 ? 'бессрочно' : hours + ' ч.'})`);
  res.json({ ok: true, expiresAt: entry.expiresAt });
});

// Force expire / lock file
app.post('/api/admin/files/:id/expire', requireAdmin, (req, res) => {
  const db = loadDB();
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'Файл не найден' });

  entry.expiresAt = Date.now() - 1000;
  saveDB(db);
  const title = entry.title || entry.originalName || req.params.id;
  logAdminAction('Принудительное закрытие', `Срок действия "${title}" истек`);
  res.json({ ok: true, expired: true });
});

// Reset download counter or change download limit
app.post('/api/admin/files/:id/reset-downloads', requireAdmin, (req, res) => {
  const { maxDownloads } = req.body;
  const db = loadDB();
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'Файл не найден' });

  entry.downloads = 0;
  if (maxDownloads !== undefined) {
    entry.maxDownloads = maxDownloads === null || maxDownloads === 0 ? null : Number(maxDownloads);
  }
  saveDB(db);
  const title = entry.title || entry.originalName || req.params.id;
  logAdminAction('Сброс скачиваний', `Счетчик "${title}" обнулен`);
  res.json({ ok: true, downloads: entry.downloads, maxDownloads: entry.maxDownloads });
});

// Remove password protection
app.post('/api/admin/files/:id/remove-password', requireAdmin, (req, res) => {
  const db = loadDB();
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: 'Файл не найден' });

  entry.passwordHash = null;
  saveDB(db);
  const title = entry.title || entry.originalName || req.params.id;
  logAdminAction('Снятие пароля', `Пароль снят с "${title}"`);
  res.json({ ok: true, hasPassword: false });
});

// Clean expired files
app.post('/api/admin/clean-expired', requireAdmin, (req, res) => {
  const cleaned = cleanExpiredFiles();
  logAdminAction('Очистка истекших', `Очищено ${cleaned} истекших файлов`);
  res.json({ ok: true, cleaned });
});

// Clean stale chunks
app.post('/api/admin/clean-chunks', requireAdmin, (req, res) => {
  let cleaned = 0;
  if (fs.existsSync(CHUNKS_DIR)) {
    const sessions = fs.readdirSync(CHUNKS_DIR);
    for (const s of sessions) {
      const sp = path.join(CHUNKS_DIR, s);
      try {
        fs.rmSync(sp, { recursive: true, force: true });
        cleaned++;
      } catch {}
    }
  }
  logAdminAction('Очистка чанков', `Удалено ${cleaned} сессий временных чанков`);
  res.json({ ok: true, cleaned });
});

// System & live metrics
app.get('/api/admin/system', requireAdmin, (req, res) => {
  const mem = process.memoryUsage();
  const stats = getDbStats();

  let chunkSessionsCount = 0;
  let chunkTotalBytes = 0;
  if (fs.existsSync(CHUNKS_DIR)) {
    const sessions = fs.readdirSync(CHUNKS_DIR);
    chunkSessionsCount = sessions.length;
    for (const s of sessions) {
      const sp = path.join(CHUNKS_DIR, s);
      try {
        const files = fs.readdirSync(sp);
        for (const f of files) {
          const stat = fs.statSync(path.join(sp, f));
          chunkTotalBytes += stat.size;
        }
      } catch {}
    }
  }

  const p2pList = Array.from(p2pRooms.entries()).map(([code, room]) => ({
    code,
    createdAt: room.createdAt,
    ageMin: Math.round((Date.now() - room.createdAt) / 60000),
    hasHost: !!room.hostPeer,
    hasClient: !!room.clientPeer
  }));

  const cfg = typeof getConfig === 'function' ? getConfig() : {};

  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rssMb: (mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
      heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(1)
    },
    stats,
    chunks: {
      sessions: chunkSessionsCount,
      sizeMb: (chunkTotalBytes / 1024 / 1024).toFixed(2)
    },
    p2pRooms: p2pList,
    appUrl: cfg.appUrl || ''
  });
});

// Close P2P room
app.delete('/api/admin/p2p/:code', requireAdmin, (req, res) => {
  const code = req.params.code.toUpperCase();
  if (p2pRooms.has(code)) {
    p2pRooms.delete(code);
    logAdminAction('Закрытие P2P', `Закрыта комната ${code}`);
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false, error: 'Комната не найдена' });
});

// Get Audit Logs
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  res.json({ ok: true, logs: adminAuditLogs });
});

// Backup DB
app.get('/api/admin/backup-db', requireAdmin, (req, res) => {
  if (fs.existsSync(DB_FILE)) {
    logAdminAction('Резервная копия', 'Скачан файл files_db.json');
    res.download(DB_FILE, `fastwebfile_backup_${Date.now()}.json`);
  } else {
    res.json({});
  }
});

// Update WebApp URL from Admin
app.post('/api/admin/set-url', requireAdmin, (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ ok: false, error: 'URL должен начинаться с https://' });
  }
  updateAppUrl(url);
  logAdminAction('Смена URL', `Установлен новый URL: ${url}`);
  res.json({ ok: true, url });
});

// Hourly cleanup
setInterval(() => {
  const db = loadDB();
  for (const id of Object.keys(db))
    if (isExpired(db[id])) deleteEntry(id, db);

  // Clean stale chunk sessions older than 24h
  if (fs.existsSync(CHUNKS_DIR)) {
    const sessions = fs.readdirSync(CHUNKS_DIR);
    const now = Date.now();
    for (const s of sessions) {
      const sp = path.join(CHUNKS_DIR, s);
      try {
        const stat = fs.statSync(sp);
        if (now - stat.mtimeMs > 86400000) fs.rmSync(sp, { recursive: true, force: true });
      } catch {}
    }
  }

  // Clean stale P2P rooms older than 2h
  const now = Date.now();
  for (const [code, room] of p2pRooms.entries()) {
    if (now - room.createdAt > 7200000) p2pRooms.delete(code);
  }
}, 3600000);

const server = app.listen(PORT, () => {
  console.log(`\n⚡ FastWebFile → http://localhost:${PORT}\n`);
  startBot(getDbStats, cleanExpiredFiles).catch(e => console.error('[Bot Error]', e));
});

function handleShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  stopBot();
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

