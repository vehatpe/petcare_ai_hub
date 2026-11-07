'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cosineSimilarity } = require('../src/utils/vector-math');
const { nowInTz, todayInTz, addDays, isValidYmd, monthsBetween, ageLabel } = require('../src/utils/time');
const { evaluateVaccinations } = require('../src/utils/health');
const { parseFrontmatter, splitMarkdown } = require('../src/utils/chunker');
const { loadConfig } = require('../src/config');

test('cosineSimilarity: identical, orthogonal, opposite, degenerate', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) + 1) < 1e-12);
  assert.ok(Math.abs(cosineSimilarity([2, 0], [5, 0]) - 1) < 1e-12, 'scale invariant');
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0, 'length mismatch');
  assert.equal(cosineSimilarity([], []), 0);
});

test('timezone: same instant is a different day in Asia/Ho_Chi_Minh vs UTC', () => {
  const instant = new Date('2026-06-10T20:30:00Z'); // 03:30 on the 11th in Vietnam
  assert.deepEqual(nowInTz(instant, 'Asia/Ho_Chi_Minh'), { date: '2026-06-11', time: '03:30' });
  assert.equal(todayInTz(instant, 'UTC'), '2026-06-10');
  assert.equal(nowInTz(new Date('2026-06-10T17:00:00Z'), 'Asia/Ho_Chi_Minh').time, '00:00', 'midnight is 00, not 24');
});

test('date helpers', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.ok(isValidYmd('2024-02-29'));
  assert.ok(!isValidYmd('2025-02-29'));
  assert.ok(!isValidYmd('2025-2-9'));
  assert.equal(monthsBetween('2024-01-31', '2024-02-29'), 0);
  assert.equal(ageLabel('2024-03-10', '2026-06-10'), '2 tuổi 3 tháng');
  assert.equal(ageLabel('2026-06-01', '2026-06-10'), 'dưới 1 tháng');
});

test('vaccine evaluation: latest dose per vaccine only, statuses, boundaries', () => {
  const today = '2026-06-10';
  const rows = [
    { id: 'a1', vaccineName: 'Dại', administeredOn: '2025-01-01', nextDueOn: '2026-01-01', source: 'owner' }, // superseded
    { id: 'a2', vaccineName: ' dại ', administeredOn: '2026-05-01', nextDueOn: '2027-05-01', source: 'owner' },
    { id: 'b1', vaccineName: '7 bệnh', administeredOn: '2025-06-01', nextDueOn: '2026-06-09', source: 'clinic' },
    { id: 'c1', vaccineName: 'FVRCP', administeredOn: '2025-06-20', nextDueOn: '2026-06-10', source: 'owner' }, // today -> due-soon
    { id: 'd1', vaccineName: 'Khác', administeredOn: '2025-06-20', nextDueOn: '2026-07-10', source: 'owner' }, // +30 days -> due-soon
    { id: 'e1', vaccineName: 'Lepto', administeredOn: '2025-06-20', nextDueOn: '2026-07-11', source: 'owner' }, // +31 -> ok
    { id: 'f1', vaccineName: 'Ghi nhận', administeredOn: '2025-06-20', nextDueOn: null, source: 'owner' }
  ];
  const { list, summary } = evaluateVaccinations(rows, today);
  const st = Object.fromEntries(list.map((v) => [v.id, v.status]));
  assert.deepEqual(st, { a1: 'recorded', a2: 'ok', b1: 'overdue', c1: 'due-soon', d1: 'due-soon', e1: 'ok', f1: 'recorded' });
  assert.deepEqual(summary, { total: 6, upToDate: 2, dueSoon: 2, overdue: 1, nextDue: { vaccineName: '7 bệnh', dueOn: '2026-06-09' } });
  assert.deepEqual(evaluateVaccinations([], today).summary, { total: 0, upToDate: 0, dueSoon: 0, overdue: 0, nextDue: null });
});

test('chunker: frontmatter, dropped leading note, size bound, heading kept', () => {
  const raw = '---\ntitle: Tài liệu\nreviewStatus: pending-veterinary-review\n---\n> Lưu ý duyệt\n\n# Tiêu đề\n\nMở đầu.\n\n## Mục A\n\n' +
    Array.from({ length: 12 }, (_, i) => `Đoạn số ${i} `.padEnd(120, 'x')).join('\n\n') + '\n\n## Mục B\n\nNgắn.';
  const { meta, body } = parseFrontmatter(raw);
  assert.equal(meta.title, 'Tài liệu');
  assert.equal(meta.reviewStatus, 'pending-veterinary-review');
  const chunks = splitMarkdown(body, 800);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= 900));
  assert.ok(!chunks.some((c) => c.includes('Lưu ý duyệt')));
  assert.ok(chunks.some((c) => c.startsWith('Mục B')));
});

test('config: production refuses weak or missing JWT_SECRET', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'changeme-changeme-changeme-changeme-changeme' }), /JWT_SECRET/);
  const ok = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'q8Zr1vLxT4mBn7YcA0dKe5HgUo3WjPsF9' });
  assert.equal(ok.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(loadConfig({}).jwtSecretEphemeral, true);
});
