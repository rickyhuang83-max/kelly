// KELLY LIN — site + admin panel
// All data lives in DATA_DIR (mount a Railway Volume there):
//   DATA_DIR/outfits.json   — outfit records
//   DATA_DIR/photos/*.jpg   — uploaded photos
//
// On first boot, DATA_DIR is seeded from ./seed/ (the repo bundle).
// After that, seed is never re-read — everything is persisted in the volume.

const express      = require('express');
const session      = require('express-session');
const multer       = require('multer');
const fs           = require('fs');
const fsp          = require('fs/promises');
const path         = require('path');
const crypto       = require('crypto');

const PORT         = process.env.PORT || 3000;
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR    = path.join(DATA_DIR, 'photos');
const DATA_FILE    = path.join(DATA_DIR, 'outfits.json');
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'kelly2026';
const SESSION_SEC  = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ---------- seed on first boot ----------
function seedIfNeeded() {
  fs.mkdirSync(DATA_DIR,  { recursive: true });
  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    const seedJson = path.join(__dirname, 'seed', 'outfits.json');
    if (fs.existsSync(seedJson)) {
      fs.copyFileSync(seedJson, DATA_FILE);
      console.log('[seed] outfits.json -> volume');
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, outfits: [] }, null, 2));
    }
  }

  const seedPhotos = path.join(__dirname, 'seed', 'photos');
  if (fs.existsSync(seedPhotos)) {
    for (const f of fs.readdirSync(seedPhotos)) {
      const dst = path.join(PHOTO_DIR, f);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(path.join(seedPhotos, f), dst);
      }
    }
    console.log('[seed] photos synced into volume');
  }
}
seedIfNeeded();

// ---------- data access (atomic writes) ----------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { version: 1, outfits: [] };
  }
}
async function saveData(data) {
  const tmp = DATA_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

// ---------- app ----------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Railway / Render / Heroku put us behind an HTTPS proxy — we must trust it
// so that secure cookies work and req.secure reflects the real scheme.
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SEC,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    secure: process.env.NODE_ENV === 'production',
  },
}));

// locals available in every template
app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.admin;
  next();
});

// ---------- public routes ----------
app.get('/', (req, res) => {
  const { outfits } = loadData();
  const visible = outfits.filter(o => o.visible).sort((a, b) => a.order - b.order);
  res.render('home', { outfits: visible });
});

app.get('/lookbook', (req, res) => {
  const { outfits } = loadData();
  const visible = outfits.filter(o => o.visible).sort((a, b) => a.order - b.order);
  res.render('lookbook', { outfits: visible });
});

app.get('/outfit/:id', (req, res) => {
  const { outfits } = loadData();
  const visible = outfits.filter(o => o.visible).sort((a, b) => a.order - b.order);
  const idx = visible.findIndex(o => o.id === req.params.id);
  if (idx < 0) return res.status(404).send('Not found');
  const prev = visible[(idx - 1 + visible.length) % visible.length];
  const next = visible[(idx + 1) % visible.length];
  res.render('outfit', { outfit: visible[idx], prev, next });
});

// serve photos from the volume
app.get('/photos/:file', (req, res) => {
  const name = path.basename(req.params.file);      // strip any ../
  const file = path.join(PHOTO_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});

// ---------- auth ----------
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  return res.redirect('/admin/login');
}

app.get('/admin', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  return res.redirect('/admin/login');
});

app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const pw = String(req.body.password || '');
  // constant-time compare to resist timing attacks
  const a = Buffer.from(pw.padEnd(64, '\0'));
  const b = Buffer.from(ADMIN_PASS.padEnd(64, '\0'));
  if (a.length === b.length && crypto.timingSafeEqual(a, b) && pw === ADMIN_PASS) {
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { error: '密碼不正確' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---------- admin: dashboard ----------
app.get('/admin/dashboard', requireAuth, (req, res) => {
  const { outfits } = loadData();
  outfits.sort((a, b) => a.order - b.order);
  res.render('admin/dashboard', { outfits, flash: req.session.flash || null });
  req.session.flash = null;
});

// ---------- admin: outfit CRUD ----------
app.get('/admin/outfit/new', requireAuth, (req, res) => {
  const { outfits } = loadData();
  const nextOrder = outfits.length ? Math.max(...outfits.map(o => o.order)) + 1 : 1;
  const nextNum = String(nextOrder).padStart(2, '0');
  res.render('admin/edit', {
    outfit: {
      id: '', order: nextOrder, visible: true,
      numLabel: nextNum, titleEn: '', titleZh: '',
      style: '', itemNo: `KL-2026-${nextNum}`,
      size: '', fabric: '', price: '', description: '',
      photos: [],
    },
    isNew: true,
    allPhotos: listAllPhotos(),
  });
});

app.post('/admin/outfit/new', requireAuth, async (req, res) => {
  const data = loadData();
  const id = String(req.body.id || '').trim();
  if (!id) { req.session.flash = { error: '需要編號 (id)' }; return res.redirect('/admin/outfit/new'); }
  if (data.outfits.some(o => o.id === id)) {
    req.session.flash = { error: `編號 ${id} 已存在` };
    return res.redirect('/admin/outfit/new');
  }
  const outfit = outfitFromForm(req.body, { id });
  if (!outfit.order) outfit.order = (data.outfits.length ? Math.max(...data.outfits.map(o => o.order)) + 1 : 1);
  data.outfits.push(outfit);
  await saveData(data);
  req.session.flash = { success: `已新增 ${outfit.titleEn || outfit.id}` };
  res.redirect('/admin/dashboard');
});

app.get('/admin/outfit/:id/edit', requireAuth, (req, res) => {
  const { outfits } = loadData();
  const outfit = outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).send('Not found');
  res.render('admin/edit', { outfit, isNew: false, allPhotos: listAllPhotos() });
});

app.post('/admin/outfit/:id', requireAuth, async (req, res) => {
  const data = loadData();
  const i = data.outfits.findIndex(o => o.id === req.params.id);
  if (i < 0) return res.status(404).send('Not found');
  data.outfits[i] = outfitFromForm(req.body, { id: req.params.id, base: data.outfits[i] });
  await saveData(data);
  req.session.flash = { success: `已更新` };
  res.redirect('/admin/dashboard');
});

app.post('/admin/outfit/:id/delete', requireAuth, async (req, res) => {
  const data = loadData();
  const before = data.outfits.length;
  data.outfits = data.outfits.filter(o => o.id !== req.params.id);
  if (data.outfits.length !== before) await saveData(data);
  req.session.flash = { success: '已刪除' };
  res.redirect('/admin/dashboard');
});

app.post('/admin/outfit/:id/toggle', requireAuth, async (req, res) => {
  const data = loadData();
  const o = data.outfits.find(o => o.id === req.params.id);
  if (o) { o.visible = !o.visible; await saveData(data); }
  res.redirect('/admin/dashboard');
});

// ---------- admin: reorder (drag & drop) ----------
app.post('/admin/reorder', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body.order) ? req.body.order : [];
  const data = loadData();
  const byId = Object.fromEntries(data.outfits.map(o => [o.id, o]));
  ids.forEach((id, idx) => { if (byId[id]) byId[id].order = idx + 1; });
  await saveData(data);
  res.json({ ok: true });
});

// ---------- admin: photo upload ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PHOTO_DIR),
    filename: (req, file, cb) => {
      // keep original name if no conflict; otherwise suffix a short hash
      const orig = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dst = path.join(PHOTO_DIR, orig);
      if (!fs.existsSync(dst)) return cb(null, orig);
      const ext = path.extname(orig);
      const base = path.basename(orig, ext);
      const suffix = crypto.randomBytes(3).toString('hex');
      cb(null, `${base}-${suffix}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('只接受 JPEG / PNG / WebP 圖片'));
  },
});

app.post('/admin/outfit/:id/photos', requireAuth, upload.array('photos', 20), async (req, res) => {
  const data = loadData();
  const outfit = data.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).send('Not found');
  const names = (req.files || []).map(f => f.filename);
  outfit.photos = [...(outfit.photos || []), ...names];
  await saveData(data);
  res.redirect(`/admin/outfit/${outfit.id}/edit`);
});

app.post('/admin/outfit/:id/photos/remove', requireAuth, async (req, res) => {
  const data = loadData();
  const outfit = data.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).send('Not found');
  const name = String(req.body.name || '');
  outfit.photos = (outfit.photos || []).filter(p => p !== name);
  await saveData(data);
  // note: we do NOT delete the file from disk — another outfit may reference it
  res.redirect(`/admin/outfit/${outfit.id}/edit`);
});

app.post('/admin/outfit/:id/photos/reorder', requireAuth, async (req, res) => {
  const data = loadData();
  const outfit = data.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).send('Not found');
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const have = new Set(outfit.photos);
  outfit.photos = order.filter(p => have.has(p));
  await saveData(data);
  res.json({ ok: true });
});

// attach an already-existing photo (from library) to outfit
app.post('/admin/outfit/:id/photos/attach', requireAuth, async (req, res) => {
  const data = loadData();
  const outfit = data.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).send('Not found');
  const name = String(req.body.name || '');
  if (name && !(outfit.photos || []).includes(name) && fs.existsSync(path.join(PHOTO_DIR, name))) {
    outfit.photos = [...(outfit.photos || []), name];
    await saveData(data);
  }
  res.redirect(`/admin/outfit/${outfit.id}/edit`);
});

// ---------- helpers ----------
function outfitFromForm(body, { id, base = {} }) {
  return {
    id,
    order:       Number(body.order)       || base.order || 0,
    visible:     body.visible === 'on'    || body.visible === 'true',
    numLabel:    String(body.numLabel    ?? base.numLabel    ?? id),
    titleEn:     String(body.titleEn     ?? base.titleEn     ?? ''),
    titleZh:     String(body.titleZh     ?? base.titleZh     ?? ''),
    style:       String(body.style       ?? base.style       ?? ''),
    itemNo:      String(body.itemNo      ?? base.itemNo      ?? ''),
    size:        String(body.size        ?? base.size        ?? ''),
    fabric:      String(body.fabric      ?? base.fabric      ?? ''),
    price:       String(body.price       ?? base.price       ?? ''),
    description: String(body.description ?? base.description ?? ''),
    photos:      Array.isArray(base.photos) ? base.photos : [],
  };
}

function listAllPhotos() {
  try {
    return fs.readdirSync(PHOTO_DIR)
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();
  } catch { return []; }
}

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`KELLY LIN running on :${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
});
