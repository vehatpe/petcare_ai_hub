'use strict';
/**
 * Tạo báo cáo bàn giao từ Git + project_status.md, KHÔNG tốn token AI.
 * Dùng khi AI sắp hết lượt / hết token và cần chuyển sang tài khoản khác.
 *   node backend/scripts/handoff.js                 -> in ra màn hình
 *   node backend/scripts/handoff.js --out handoff.md [--test]
 * --out ghi UTF-8 (tránh lỗi mã hóa khi dùng ">" trong PowerShell). --test chạy thêm "npm test" (DB giả) và chỉ lấy dòng tổng kết.
 * Không đọc .env, không in bí mật. Chỉ đọc; không sửa repo.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const withTest = args.includes('--test');

function git(a) {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  if (r.error) return '(không chạy được git: ' + r.error.message + ')';
  return (r.stdout || '').replace(/\s+$/, '') || (r.stderr || '').trim();
}
const cap = (s, n) => { const l = s.split(/\r?\n/); return l.length > n ? l.slice(0, n).join('\n') + `\n... (+${l.length - n} dòng nữa)` : s; };

const root = git(['rev-parse', '--show-toplevel']);
if (!root || root.startsWith('(') || root.startsWith('fatal')) { console.error('Không nằm trong repo Git.'); process.exit(1); }
process.chdir(root);

const base = git(['rev-parse', '--verify', '--quiet', 'main']) ? 'main' : (git(['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : null);
const L = [];
L.push('# BÁO CÁO BÀN GIAO (tạo tự động từ Git)');
L.push(`Thời điểm: ${new Date().toISOString()}`);
L.push(`Nhánh: ${git(['branch', '--show-current'])}   |   HEAD: ${git(['rev-parse', '--short', 'HEAD'])}`);
L.push('');
L.push(`## Commit trên nhánh này so với ${base || '(không tìm thấy main)'}`);
L.push('```\n' + cap(base ? git(['log', '--oneline', `${base}..HEAD`]) : git(['log', '--oneline', '-10']), 30) + '\n```');
L.push('## Thay đổi CHƯA commit (git status --short)');
const st = git(['status', '--short']);
L.push('```\n' + (st ? cap(st, 40) : '(sạch)') + '\n```');
L.push('## Quy mô thay đổi chưa commit (git diff --stat, gồm cả staged)');
const ds = [git(['diff', '--stat']), git(['diff', '--cached', '--stat'])].filter(Boolean).join('\n');
L.push('```\n' + (ds ? cap(ds, 40) : '(không có)') + '\n```');
if (base) {
  L.push(`## Tệp đã đổi so với ${base}`);
  L.push('```\n' + cap(git(['diff', '--stat', `${base}...HEAD`]), 40) + '\n```');
}

const sp = path.join(root, 'project_status.md');
if (fs.existsSync(sp)) {
  const lines = fs.readFileSync(sp, 'utf8').split(/\r?\n/);
  const head = lines.filter((l) => /^- \*\*(Cập nhật lần cuối|Nhánh làm việc|Giai đoạn hiện tại|Việc kế tiếp)/.test(l));
  L.push('## project_status.md (đầu file)');
  L.push(head.length ? head.join('\n') : '(không tìm thấy các dòng đầu)');
  const i = lines.findIndex((l) => /^#{1,3}\s*.*Đang làm/i.test(l));
  L.push('## Mục "Đang làm" trong project_status.md');
  if (i < 0) L.push('(CHƯA CÓ mục này: AI trước chưa ghi trạng thái dở dang; dựa vào Git ở trên)');
  else {
    const rest = lines.slice(i + 1);
    const j = rest.findIndex((l) => /^#{1,3}\s/.test(l));
    L.push(cap(rest.slice(0, j < 0 ? rest.length : j).join('\n').trim(), 25) || '(trống)');
  }
} else L.push('## project_status.md\n(không tồn tại)');

if (withTest) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['test'], { cwd: path.join(root, 'backend'), encoding: 'utf8', shell: process.platform === 'win32' });
  const out = (r.stdout || '') + (r.stderr || '');
  const sum = out.split(/\r?\n/).filter((l) => /^# (tests|pass|fail|skipped|todo)\b/.test(l));
  L.push('## npm test (DB giả)');
  L.push('```\n' + (sum.join('\n') || cap(out, 15)) + '\n```');
}
L.push('');
L.push('Lưu ý: báo cáo này chỉ phản ánh trạng thái Git. KHÔNG biết migration nào đã áp dụng trên DB dev: AI tiếp quản phải tự kiểm bằng `node scripts/migrate.js`.');
const text = L.join('\n') + '\n';
if (outFile) { fs.writeFileSync(outFile, text, 'utf8'); console.log('Đã ghi ' + outFile + ' (' + text.length + ' ký tự).'); } else process.stdout.write(text);
