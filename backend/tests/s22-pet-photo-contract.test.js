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
    set innerHTML(v) { this._html = String(v ?? ''); this.children = []; }
    get innerHTML() { return this._html; }
    set textContent(v) { this._text = String(v ?? ''); this._html = this._text; this.children = []; }
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
    querySelector() { return new El('', 'BUTTON'); }
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
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
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

const jwt = require('jsonwebtoken');

async function seedCustomer(tApp) {
  const id = 'cust_' + crypto.randomBytes(4).toString('hex');
  const email = `${id}@example.com`;
  const user = {
    id,
    name: 'Khách S22',
    email,
    phone: '0901234567',
    passwordHash: bcrypt.hashSync('Password123!', 4),
    role: 'customer',
    status: 'active',
    tokenVersion: 0,
    mustChangePassword: false
  };
  await tApp.models.users.create(user);
  const token = jwt.sign({ sub: id, role: 'customer', tv: 0 }, tApp.config.jwtSecret, { expiresIn: '1h' });
  return { id, token, user: { id, name: user.name, email, role: 'customer', status: 'active' } };
}

async function waitFor(cond, timeoutMs = 2000, step = 10) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('waitFor timeout after ' + timeoutMs + 'ms');
}

function makeBridgeFetch(tApp, calls, overrideUpload) {
  return async (url, init = {}) => {
    const u = new URL(url, tApp.baseUrl);
    const apiPath = u.pathname.replace(/^\/api\/v1/, '') + u.search;
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};

    if (init.body instanceof FakeFormData) {
      const override = overrideUpload ? await overrideUpload(method, apiPath, init.body, headers) : null;
      if (override) {
        const res = override;
        calls.push({ method, path: apiPath, isFormData: true, status: res.status, resBody: res.body });
        return { ok: res.status >= 200 && res.status < 300, status: res.status, async json() { return res.body; } };
      }
      const field = init.body.fields.find((f) => f.name === 'photo');
      const buf = field && field.value && field.value._buf ? field.value._buf : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const realForm = new FormData();
      realForm.append('photo', new Blob([buf], { type: 'image/png' }), (field && field.filename) || 'pet.png');
      const res = await fetch(tApp.baseUrl + apiPath, {
        method,
        headers: headers.Authorization ? { Authorization: headers.Authorization } : {},
        body: realForm
      });
      const resBody = await res.json().catch(() => null);
      calls.push({ method, path: apiPath, isFormData: true, status: res.status, resBody });
      return { ok: res.ok, status: res.status, async json() { return resBody; } };
    }

    const parsedBody = init.body ? JSON.parse(init.body) : undefined;
    const res = await fetch(tApp.baseUrl + apiPath, { method, headers, body: init.body });
    const resBody = await res.json().catch(() => null);
    calls.push({ method, path: apiPath, body: parsedBody, status: res.status, resBody });
    return { ok: res.ok, status: res.status, async json() { return resBody; } };
  };
}

test('S22 pet-profile contract: create with photo, client validation, 413/422 recovery, delete photo, no Base64', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
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
  await waitFor(() => calls.some((c) => c.method === 'GET' && c.path === '/pets') && !form.hasAttribute('aria-busy'));

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
  assert.ok(calls.some((c) => c.isFormData), 'uploadPhoto not called; calls=' + JSON.stringify(calls));
  assert.equal(getOrCreate('formAlert').hidden, true, getOrCreate('formAlert').textContent);
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/pets'), 'POST /pets not called; calls=' + JSON.stringify(calls));
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
  const uploadCall = calls.find((c) => c.method === 'POST' && /^\/pets\/[^/]+\/photo$/.test(c.path) && c.status === 200);
  assert.ok(uploadCall && uploadCall.isFormData, 'successful photo upload not called; calls=' + JSON.stringify(calls));

  const previewAvatar = getOrCreate('previewAvatar');
  const previewImg = previewAvatar.children.find((c) => c.tagName === 'IMG');
  assert.equal(previewAvatar.children.length, 1, 'previewAvatar must hold exactly one <img>');
  assert.ok(previewImg && /^\/uploads\/pets\/.+\.png$/.test(previewImg.src), 'previewAvatar should show uploaded URL');

  // (d) "Xóa ảnh" gọi DELETE và DOM về chữ cái đầu
  await getOrCreate('photoRemove').dispatch('click');
  const delCall = calls.find((c) => c.method === 'DELETE' && /^\/pets\/[^/]+\/photo$/.test(c.path));
  assert.ok(delCall);
  assert.equal(previewAvatar.textContent, 'M');
});

test('S22 dashboard-customer and booking-flow: render pet.photo URL and fallback to initial on error', async (t) => {
  const tApp = await startTestApp();
  t.after(() => tApp.close());
  const cust = await seedCustomer(tApp);
  const photoUrl = '/uploads/pets/bong.png';
  const createRes = await fetch(tApp.baseUrl + '/pets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cust.token },
    body: JSON.stringify({ name: 'Bông', species: 'cat', sex: 'female', birthDate: '2022-05-01' })
  });
  const createJson = await createRes.json();
  assert.equal(createRes.status, 201, JSON.stringify(createJson));
  await tApp.models.pets.setPhoto(null, createJson.data.id, cust.id, { url: photoUrl, publicId: 'pets/bong' });
  const sessionJson = JSON.stringify({ token: cust.token, user: cust.user });
  const calls = [];

  // dashboard-customer
  const dash = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'customer-dashboard.html'),
    url: 'http://localhost:3000/pages/customer-dashboard.html',
    sessionJson,
    fetchImpl: makeBridgeFetch(tApp, calls)
  });
  await dash.document.dispatchEvent({ type: 'DOMContentLoaded' });
  const petsList = dash.getOrCreate('petList');
  await waitFor(() => petsList.innerHTML.includes('<img'));
  assert.ok(petsList.innerHTML.includes(`<img src="${photoUrl}" alt="">`), `petList.innerHTML=${petsList.innerHTML}; calls=${JSON.stringify(calls)}`);
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
    fetchImpl: makeBridgeFetch(tApp, calls)
  });
  await book.document.dispatchEvent({ type: 'DOMContentLoaded' });
  const stepContent = book.getOrCreate('petChoices');
  await waitFor(() => stepContent.innerHTML.includes('<img'));
  assert.ok(stepContent.innerHTML.includes(`<img src="${photoUrl}" alt="">`), `petChoices.innerHTML=${stepContent.innerHTML}; calls=${JSON.stringify(calls)}`);
  const fakeBox2 = book.document.createElement('SPAN');
  fakeBox2.classList.add('pet-avatar');
  fakeBox2.setAttribute('data-pet-initial', 'B');
  const fakeImg2 = book.document.createElement('IMG');
  fakeImg2.closest = () => fakeBox2;
  await stepContent.dispatchEvent({ type: 'error', target: fakeImg2 });
  assert.equal(fakeBox2.textContent, 'B');
});

test('S22 Toast helper methods forward to Toast.show with expected types', () => {
  const calls = [];
  const ctx = { window: {}, document: { createElement: () => ({}), body: { appendChild: () => {} } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(FRONTEND_DIR, 'js/components/toast.js'), 'utf8'), ctx);
  ctx.Toast.show = (opts) => calls.push(opts);

  ctx.Toast.success('OK', 'Done');
  ctx.Toast.error('Err', 'Fail');
  ctx.Toast.info('Info', 'Note');
  ctx.Toast.warning('Warn', 'Careful');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [
    { title: 'OK', message: 'Done', type: 'success' },
    { title: 'Err', message: 'Fail', type: 'danger' },
    { title: 'Info', message: 'Note', type: 'info' },
    { title: 'Warn', message: 'Careful', type: 'warning' }
  ]);
});

test('S22.1 edit mode: selecting valid file uploads immediately without submit, 413 keeps old photo, CSS .visually-hidden defined', async (t) => {
  const styleCss = fs.readFileSync(path.join(FRONTEND_DIR, 'css/style.css'), 'utf8');
  assert.ok(/\.visually-hidden\s*\{/.test(styleCss), 'style.css must define .visually-hidden');

  const tApp = await startTestApp();
  t.after(() => tApp.close());
  const cust = await seedCustomer(tApp);
  const oldPhotoUrl = '/uploads/pets/old.png';
  const createRes = await fetch(tApp.baseUrl + '/pets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cust.token },
    body: JSON.stringify({ name: 'Mít', species: 'cat', sex: 'female', birthDate: '2023-01-01' })
  });
  const createJson = await createRes.json();
  assert.equal(createRes.status, 201);
  const petId = createJson.data.id;
  await tApp.models.pets.setPhoto(null, petId, cust.id, { url: oldPhotoUrl, publicId: 'pets/old' });

  const sessionJson = JSON.stringify({ token: cust.token, user: cust.user });
  const calls = [];
  const vmPage = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'pet-profile.html'),
    url: `http://localhost:3000/pages/pet-profile.html?id=${encodeURIComponent(petId)}`,
    sessionJson,
    fetchImpl: makeBridgeFetch(tApp, calls)
  });
  await vmPage.document.dispatchEvent({ type: 'DOMContentLoaded' });
  const previewAvatar = vmPage.getOrCreate('previewAvatar');
  await waitFor(() => previewAvatar.innerHTML.includes(oldPhotoUrl) || (previewAvatar.children[0] && previewAvatar.children[0].src === oldPhotoUrl));

  const photoInput = vmPage.getOrCreate('photoInput', 'INPUT');
  const photoError = vmPage.getOrCreate('photo-error', 'P');
  const photoPick = vmPage.getOrCreate('photoPick', 'BUTTON');
  assert.equal(photoPick.textContent, 'Đổi ảnh');

  // 1. Valid PNG file -> uploads immediately without form submit
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  const validBlob = new Blob([pngBytes], { type: 'image/png' });
  validBlob.name = 'new.png';
  photoInput.files = [validBlob];
  await photoInput.dispatch('change', {});
  await waitFor(() => calls.some((c) => c.method === 'POST' && c.path === `/pets/${petId}/photo`));
  assert.ok(photoError.hidden, 'photoError must stay hidden on valid upload');

  // 2. 413 error -> shows photoError and keeps previous photo
  const prevSrc = previewAvatar.children[0] && previewAvatar.children[0].src;
  const vmFail = loadPageIntoVm({
    htmlPath: path.join(PAGES_DIR, 'pet-profile.html'),
    url: `http://localhost:3000/pages/pet-profile.html?id=${encodeURIComponent(petId)}`,
    sessionJson,
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith(`/pets/${petId}/photo`) && init.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Ảnh vượt quá 5 MB.' } }), { status: 413, headers: { 'Content-Type': 'application/json' } });
      }
      return makeBridgeFetch(tApp, [])(url, init);
    }
  });
  await vmFail.document.dispatchEvent({ type: 'DOMContentLoaded' });
  const failAvatar = vmFail.getOrCreate('previewAvatar');
  await waitFor(() => failAvatar.children[0] && failAvatar.children[0].src);
  const failSrcBefore = failAvatar.children[0].src;
  const failInput = vmFail.getOrCreate('photoInput', 'INPUT');
  const failError = vmFail.getOrCreate('photo-error', 'P');
  failInput.files = [validBlob];
  await failInput.dispatch('change', {});
  await waitFor(() => !failError.hidden);
  assert.ok(failError.textContent.length > 0, 'photoError must be shown on 413');
  assert.equal(failAvatar.children[0].src, failSrcBefore, '413 must keep old photo in preview');
});

test('S22.1 Api.assetUrl & PetService normalize /uploads/ on Live Server port 5500', async () => {
  const apiConfigSrc = fs.readFileSync(path.join(FRONTEND_DIR, 'js/config/api.config.js'), 'utf8');
  const petServiceSrc = fs.readFileSync(path.join(FRONTEND_DIR, 'js/services/pet.service.js'), 'utf8');

  function loadApiCtx({ port = '5500', protocol = 'http:', hostname = 'localhost', apiBase } = {}) {
    const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const ctx = {
      window: {
        location: { port, protocol, hostname },
        addEventListener: () => {},
        dispatchEvent: () => {},
        PETCARE_API_BASE: apiBase
      },
      localStorage: store,
      sessionStorage: store,
      CustomEvent: class CustomEvent { constructor(t) { this.type = t; } },
      URLSearchParams,
      FormData: class FormData { append() {} },
      fetch: async () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      console
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(apiConfigSrc, ctx);
    return ctx;
  }

  // 1. Port 5500 -> prefixes http://localhost:3000
  const ctx5500 = loadApiCtx({ port: '5500' });
  assert.equal(ctx5500.window.Api.assetUrl('/uploads/pets/a.png'), 'http://localhost:3000/uploads/pets/a.png');
  assert.equal(ctx5500.window.Api.assetUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(ctx5500.window.Api.assetUrl('blob:http://localhost:5500/123'), 'blob:http://localhost:5500/123');
  assert.equal(ctx5500.window.Api.assetUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  assert.equal(ctx5500.window.Api.assetUrl(null), null);

  // 2. Port 3000 (same-origin Express) -> keeps relative
  const ctx3000 = loadApiCtx({ port: '3000' });
  assert.equal(ctx3000.window.Api.assetUrl('/uploads/pets/a.png'), '/uploads/pets/a.png');

  // 3. Custom PETCARE_API_BASE respected
  const ctxCustom = loadApiCtx({ port: '5500', apiBase: 'https://api.petcare.vn/api/v1' });
  assert.equal(ctxCustom.window.Api.assetUrl('/uploads/pets/a.png'), 'https://api.petcare.vn/uploads/pets/a.png');

  // 4. PetService.list & PetService.uploadPhoto normalize photo on port 5500
  ctx5500.Api = ctx5500.window.Api;
  ctx5500.ApiError = ctx5500.window.ApiError;
  ctx5500.AuthService = { isLoggedIn: () => true };
  ctx5500.Fmt = { parseDate: () => null, todayIso: () => '2026-11-28' };
  ctx5500.Api.get = async () => [{ id: 'p1', name: 'Milo', photo: '/uploads/pets/milo.png' }];
  ctx5500.Api.upload = async () => ({ id: 'p1', name: 'Milo', photo: '/uploads/pets/milo2.png' });
  vm.runInContext(petServiceSrc, ctx5500);

  const list = await ctx5500.window.PetService.list();
  assert.equal(list[0].photo, 'http://localhost:3000/uploads/pets/milo.png');
  const uploaded = await ctx5500.window.PetService.uploadPhoto('p1', new Blob(['x']), 'milo.png');
  assert.equal(uploaded.photo, 'http://localhost:3000/uploads/pets/milo2.png');
});
