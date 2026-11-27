'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { startTestApp } = require('./helpers/harness');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const PAGES_DIR = path.join(FRONTEND_DIR, 'pages');

function extractPageScripts(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const dir = path.dirname(htmlFile);
  const out = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('//') || src.includes('motion')) continue;
    out.push(path.resolve(dir, src.split('?')[0]));
  }
  return out;
}

function makeEvent(type, init = {}, defaultTarget = null) {
  return {
    type,
    target: init.target || defaultTarget,
    currentTarget: init.currentTarget || defaultTarget,
    defaultPrevented: false,
    ...init,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}
  };
}

function createDom(bodyAuth = 'customer') {
  const els = new Map();
  class El {
    constructor(id = '', tag = 'DIV') {
      this.id = id;
      this.tagName = tag.toUpperCase();
      this._html = '';
      this._text = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this.src = '';
      this.alt = '';
      this.href = '';
      this.files = [];
      this.dataset = {};
      this.attributes = new Map();
      this._listeners = new Map();
      this.children = [];
      this.classList = {
        _s: new Set(),
        add: (...c) => c.forEach((x) => this.classList._s.add(x)),
        remove: (...c) => c.forEach((x) => this.classList._s.delete(x)),
        toggle: (c, f) => (f === undefined ? (this.classList._s.has(c) ? (this.classList._s.delete(c), false) : (this.classList._s.add(c), true)) : (f ? this.classList._s.add(c) : this.classList._s.delete(c), !!f)),
        contains: (c) => this.classList._s.has(c)
      };
    }
    set innerHTML(v) { this._html = String(v ?? ''); }
    get innerHTML() { return this._html; }
    set textContent(v) { this._text = String(v ?? ''); this._html = this._text; }
    get textContent() { return this._text; }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    hasAttribute(k) { return this.attributes.has(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    appendChild(c) { this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    remove() {}
    focus() {}
    blur() {}
    click() {}
    closest(sel) {
      if (sel === '.pet-avatar' && (this.id === 'previewAvatar' || this.classList.contains('pet-avatar'))) return this;
      return null;
    }
    addEventListener(t, fn) {
      if (!this._listeners.has(t)) this._listeners.set(t, []);
      this._listeners.get(t).push(fn);
    }
    async dispatchEvent(ev) {
      const e = typeof ev === 'string' ? makeEvent(ev, {}, this) : makeEvent(ev.type, ev, this);
      for (const fn of this._listeners.get(e.type) || []) await fn(e);
      return !e.defaultPrevented;
    }
    async dispatch(t, ev = {}) {
      return this.dispatchEvent(makeEvent(t, ev, this));
    }
    querySelectorAll(sel) {
      if (sel === '.field-error') return ['name-error', 'species-error', 'sex-error', 'birthDate-error', 'weightKg-error', 'conditions-error', 'microchip-error'].map((id) => getOrCreate(id, 'P'));
      if (sel === '[aria-invalid]') return [];
      if (sel === 'input[name="species"]') return [];
      return [];
    }
  }

  function getOrCreate(id, tag = 'DIV') {
    if (!els.has(id)) els.set(id, new El(id, tag));
    return els.get(id);
  }

  const form = getOrCreate('petForm', 'FORM');
  form.elements = {
    name: getOrCreate('name', 'INPUT'),
    species: getOrCreate('species', 'INPUT'),
    breed: getOrCreate('breed', 'INPUT'),
    sex: getOrCreate('sex', 'INPUT'),
    birthDate: getOrCreate('birthDate', 'INPUT'),
    weightKg: getOrCreate('weightKg', 'INPUT'),
    color: getOrCreate('color', 'INPUT'),
    neutered: getOrCreate('neutered', 'SELECT'),
    conditions: getOrCreate('conditions', 'TEXTAREA'),
    microchip: getOrCreate('microchip', 'INPUT')
  };
  form.breed = form.elements.breed;
  form.birthDate = form.elements.birthDate;
  form.weightKg = form.elements.weightKg;
  form.color = form.elements.color;
  form.neutered = form.elements.neutered;
  form.conditions = form.elements.conditions;
  form.microchip = form.elements.microchip;

  const docListeners = new Map();
  const body = new El('body', 'BODY');
  body.dataset = { pageAuth: bodyAuth };

  const document = {
    title: '',
    body,
    documentElement: new El('html', 'HTML'),
    getElementById: (id) => getOrCreate(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => new El('', tag),
    addEventListener: (t, fn) => {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t).push(fn);
    },
    dispatchEvent: async (ev) => {
      const e = typeof ev === 'string' ? makeEvent(ev, {}, document) : ev;
      for (const fn of docListeners.get(e.type) || []) await fn(e);
    }
  };

  return { document, els, getOrCreate, form };
}

function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

class FakeFormData {
  constructor() { this.fields = []; }
  append(name, value, filename) { this.fields.push({ name, value, filename }); }
}

function loadPageIntoVm({ htmlPath, url, sessionJson, fetchImpl }) {
  const { document, els, getOrCreate, form } = createDom('customer');
  const sessionStorage = makeStorage(sessionJson ? { petcare_session: sessionJson } : {});
  const localStorage = makeStorage();

  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    FormData: FakeFormData,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    document,
    sessionStorage,
    localStorage,
    fetch: fetchImpl,
    location: { protocol: 'http:', hostname: 'localhost', port: '3000', pathname: '/pages/' + path.basename(htmlPath), search: new URL(url).search, href: url, replace(u) { this.href = u; }, reload() {} },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false })
  };
  ctx.window = ctx;
  ctx.window.URL = Object.assign(function (u, b) { return new URL(u, b); }, {
    createObjectURL: () => 'blob:http://localhost:3000/fake-preview',
    revokeObjectURL: () => {}
  });
  ctx.URL = ctx.window.URL;

  vm.createContext(ctx);
  for (const scriptPath of extractPageScripts(htmlPath)) {
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx, { filename: scriptPath });
  }
  return { ctx, document, els, getOrCreate, form };
}

async function seedCustomer(app) {
  const id = 'cust_' + crypto.randomBytes(4).toString('hex');
  await app.models.user.create({
    id,
    name: 'Khách S22',
    email: `${id}@example.com`,
    passwordHash: bcrypt.hashSync('Pass123!', 4),
    role: 'customer',
    status: 'active'
  });
  const token = app.jwt.sign({ sub: id, role: 'customer', tv: 0 });
  return { id, token, user: { id, name: 'Khách S22', email: `${id}@example.com`, role: 'customer', status: 'active' } };
}

function makeBridgeFetch(app, calls, overrideUpload) {
  return async (url, init = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const apiPath = u.pathname.replace(/^\/api\/v1/, '') + u.search;
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};

    if (init.body instanceof FakeFormData) {
      calls.push({ method, path: apiPath, isFormData: true });
      if (overrideUpload) {
        const res = await overrideUpload(method, apiPath, init.body, headers);
        return { ok: res.status >= 200 && res.status < 300, status: res.status, async json() { return res.body; } };
      }
      const field = init.body.fields.find((f) => f.name === 'photo');
      const buf = field && field.value && field.value._buf ? field.value._buf : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const res = await app.request
        .post('/api/v1' + apiPath)
        .set('Authorization', headers.Authorization || '')
        .attach('photo', buf, (field && field.filename) || 'pet.png');
      return { ok: res.status >= 200 && res.status < 300, status: res.status, async json() { return res.body; } };
    }

    const parsedBody = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: apiPath, body: parsedBody });
    let req = app.request[method.toLowerCase()]('/api/v1' + apiPath);
    if (headers.Authorization) req = req.set('Authorization', headers.Authorization);
    if (parsedBody !== undefined) req = req.send(parsedBody);
    const res = await req;
    return { ok: res.status >= 200 && res.status < 300, status: res.status, async json() { return res.body; } };
  };
}

test('S22 pet-profile contract: create with photo, client validation, 413/422 recovery, delete photo, no Base64', async () => {
  const app = await startTestApp();
  const cust = await seedCustomer(app);
  const sessionJson = JSON.stringify({ token: cust.token, user: cust.user });
  const calls = [];
  let uploadOverride = null;

  const { document, getOrCreate, form } = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'pet-profile.html'),
    url: 'http://localhost:3000/pages/pet-profile.html',
    sessionJson,
    fetchImpl: makeBridgeFetch(app, calls, (...args) => uploadOverride && uploadOverride(...args))
  });

  await document.dispatchEvent({ type: 'DOMContentLoaded' });
  await new Promise((r) => setTimeout(r, 20));

  // (b) Ảnh > 5 MB hoặc GIF bị chặn ở client và KHÔNG gọi API
  const callsBefore = calls.length;
  const photoInput = getOrCreate('photoInput');
  const photoError = getOrCreate('photo-error');

  photoInput.files = [{ name: 'anim.gif', type: 'image/gif', size: 1024 }];
  await photoInput.dispatch('change');
  assert.equal(photoError.hidden, false);
  assert.match(photoError.textContent, /PNG, JPEG hoặc WebP/);
  assert.equal(calls.length, callsBefore);

  photoInput.files = [{ name: 'huge.png', type: 'image/png', size: 6 * 1024 * 1024 }];
  await photoInput.dispatch('change');
  assert.equal(photoError.hidden, false);
  assert.match(photoError.textContent, /5 MB/);
  assert.equal(calls.length, callsBefore);

  // (c) Tạo thú cưng mới + ảnh nhưng server trả 413 -> giữ chế độ sửa, không tạo thú cưng thứ hai
  form.elements.name.value = 'Milo';
  form.elements.species.value = 'dog';
  form.elements.sex.value = 'male';
  form.elements.birthDate.value = '2023-01-10';

  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  photoInput.files = [{ name: 'milo.png', type: 'image/png', size: pngBuf.length, _buf: pngBuf }];
  await photoInput.dispatch('change');
  assert.equal(photoError.hidden, true);

  uploadOverride = async () => ({ status: 413, body: { success: false, code: 'file_too_large', message: 'Ảnh vượt quá 5 MB.' } });
  await form.dispatch('submit');
  assert.equal(photoError.hidden, false);
  assert.equal(photoError.textContent, 'Ảnh vượt quá 5 MB.');
  assert.match(getOrCreate('pageTitle').textContent, /Sửa hồ sơ Milo/);

  // (e) Không có yêu cầu nào mang photo Base64
  const postPet = calls.find((c) => c.method === 'POST' && c.path === '/pets');
  assert.ok(postPet, 'POST /pets must be called');
  assert.equal('photo' in postPet.body, false, 'POST /pets must not send photo');

  // (a) Thử lại submit ở chế độ sửa -> upload thành công, DOM hiện URL trả về
  uploadOverride = null;
  await form.dispatch('submit');
  const uploadCall = calls.find((c) => c.method === 'POST' && /^\/pets\/[^/]+\/photo$/.test(c.path));
  assert.ok(uploadCall && uploadCall.isFormData);

  const previewAvatar = getOrCreate('previewAvatar');
  const previewImg = previewAvatar.children.find((c) => c.tagName === 'IMG');
  assert.ok(previewImg && /^\/uploads\/pets\/.+\.png$/.test(previewImg.src), 'previewAvatar should show uploaded URL');

  // (d) "Xóa ảnh" gọi DELETE và DOM về chữ cái đầu
  await getOrCreate('photoRemove').dispatch('click');
  const delCall = calls.find((c) => c.method === 'DELETE' && /^\/pets\/[^/]+\/photo$/.test(c.path));
  assert.ok(delCall);
  assert.equal(previewAvatar.textContent, 'M');
});

test('S22 dashboard-customer and booking-flow: render pet.photo URL and fallback to initial on error', async () => {
  const app = await startTestApp();
  const cust = await seedCustomer(app);
  await app.models.pet.create({
    id: 'pet_s22_1',
    ownerId: cust.id,
    name: 'Bông',
    species: 'cat',
    sex: 'female',
    birthDate: '2022-05-01',
    photoUrl: '/uploads/pets/bong.png'
  });
  const sessionJson = JSON.stringify({ token: cust.token, user: cust.user });
  const calls = [];

  // dashboard-customer
  const dash = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'customer-dashboard.html'),
    url: 'http://localhost:3000/pages/customer-dashboard.html',
    sessionJson,
    fetchImpl: makeBridgeFetch(app, calls)
  });
  await dash.document.dispatchEvent({ type: 'DOMContentLoaded' });
  await new Promise((r) => setTimeout(r, 30));
  const petsList = dash.getOrCreate('petsList');
  assert.match(petsList.innerHTML, /<img src="\/uploads\/pets\/bong\.png" alt="">/);
  const fakeBox = dash.document.createElement('DIV');
  fakeBox.classList.add('pet-avatar');
  fakeBox.setAttribute('data-pet-initial', 'B');
  const fakeImg = dash.document.createElement('IMG');
  fakeImg.closest = () => fakeBox;
  await petsList.dispatchEvent({ type: 'error', target: fakeImg });
  assert.equal(fakeBox.textContent, 'B');

  // booking-flow
  const book = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'booking.html'),
    url: 'http://localhost:3000/pages/booking.html',
    sessionJson,
    fetchImpl: makeBridgeFetch(app, calls)
  });
  await book.document.dispatchEvent({ type: 'DOMContentLoaded' });
  await new Promise((r) => setTimeout(r, 30));
  const stepContent = book.getOrCreate('stepContent');
  assert.match(stepContent.innerHTML, /<img src="\/uploads\/pets\/bong\.png" alt="">/);
  const fakeBox2 = book.document.createElement('SPAN');
  fakeBox2.classList.add('pet-avatar');
  fakeBox2.setAttribute('data-pet-initial', 'B');
  const fakeImg2 = book.document.createElement('IMG');
  fakeImg2.closest = () => fakeBox2;
  await stepContent.dispatchEvent({ type: 'error', target: fakeImg2 });
  assert.equal(fakeBox2.textContent, 'B');
});
