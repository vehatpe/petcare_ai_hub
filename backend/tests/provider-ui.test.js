'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const headerJsPath = path.resolve(__dirname, '../../frontend/js/components/header.js');
const headerJsCode = fs.readFileSync(headerJsPath, 'utf8');

const providersJsPath = path.resolve(__dirname, '../../frontend/js/pages/providers.js');
const providersJsCode = fs.readFileSync(providersJsPath, 'utf8');

test('Provider Nav: contains all 4 items and excludes Booking and AI assistant', () => {
  let mainNavHtml = '';
  const mockNav = {
    _defaultNavHtml: '<a href="index.html">Trang chủ</a><a href="services.html">Dịch vụ</a>',
    get innerHTML() { return mainNavHtml; },
    set innerHTML(val) { mainNavHtml = val; }
  };

  const sandbox = {
    window: {
      location: { pathname: '/pages/provider-services.html', search: '' },
      addEventListener: () => {},
      dispatchEvent: () => {},
      matchMedia: () => ({ addEventListener: () => {} })
    },
    document: {
      querySelector: (sel) => {
        if (sel === '.main-nav') return mockNav;
        return null;
      },
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {}
    },
    Fmt: {
      esc: (s) => String(s ?? ''),
      initials: () => 'AB',
      firstName: (n) => n
    },
    AuthService: {
      pageUrl: (f) => f,
      homeUrl: () => '../index.html',
      currentUser: () => ({
        id: 'prov-user-1',
        role: 'provider',
        status: 'active',
        fullName: 'Chủ Cơ Sở Test',
        email: 'prov@clinic.vn',
        providerId: 'clinic-1'
      }),
      refresh: () => {}
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(headerJsCode, sandbox);

  // Assert items in mainNavHtml
  assert.ok(mainNavHtml.includes('Trang chủ'), 'Must have Trang chủ');
  assert.ok(mainNavHtml.includes('Dịch vụ của tôi'), 'Must have Dịch vụ của tôi');
  assert.ok(mainNavHtml.includes('Hồ sơ cơ sở'), 'Must have Hồ sơ cơ sở');
  assert.ok(mainNavHtml.includes('Quản lý bác sĩ'), 'Must have Quản lý bác sĩ');

  // Must NOT contain customer / general booking / ai assistant links
  assert.equal(mainNavHtml.includes('Đặt lịch hẹn'), false, 'Provider nav must not include Đặt lịch hẹn');
  assert.equal(mainNavHtml.includes('Trợ lý AI'), false, 'Provider nav must not include Trợ lý AI');
});

test('Public providers directory: does not render licenseNo or taxCode', () => {
  assert.equal(providersJsCode.includes('licenseNo'), false, 'providers.js must never reference licenseNo');
  assert.equal(providersJsCode.includes('taxCode'), false, 'providers.js must never reference taxCode');
});

test('Public providers directory: empty services shows "Cơ sở chưa đăng dịch vụ nào" and no booking button', () => {
  assert.ok(providersJsCode.includes('Cơ sở chưa đăng dịch vụ nào'), 'Must have Vietnamese message for empty services');
  assert.ok(providersJsCode.includes('mine.length'), 'Must check services count before rendering booking button');
});

test('Landing page bento: booking card has hidden attribute for staff roles (admin, provider, vet)', () => {
  const landingJsPath = path.resolve(__dirname, '../../frontend/js/pages/landing.js');
  const landingJsCode = fs.readFileSync(landingJsPath, 'utf8');

  // Verify header.js handles .bento2-booking hiding
  assert.ok(headerJsCode.includes('.bento2-booking'), 'header.js must query .bento2-booking');
  assert.ok(headerJsCode.includes('el.hidden = isStaff'), 'header.js must set hidden attribute on .bento2-booking for staff');
  assert.ok(landingJsCode.includes('isStaff'), 'landing.js must check isStaff for booking action buttons');
});
