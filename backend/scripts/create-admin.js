'use strict';
/**
 * PetCare AI Hub - Admin Creation Script
 *
 * Usage:
 *   node scripts/create-admin.js --email <email> --name <name> --phone <phone>
 *
 * Password:
 *   Set via ADMIN_PASSWORD environment variable or prompted via hidden stdin.
 *   NEVER passed via CLI arguments, NEVER printed to console, NEVER logged.
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const readline = require('node:readline');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../src/config');
const { validateRegister } = require('../src/utils/validators');

function parseArgs(argv) {
  const args = { email: '', name: '', phone: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--email' && argv[i + 1]) {
      args.email = argv[++i];
    } else if (argv[i] === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if (argv[i] === '--phone' && argv[i + 1]) {
      args.phone = argv[++i];
    }
  }
  return args;
}

function askHiddenPassword(promptText = 'Nhập mật khẩu cho Admin: ') {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // In non-interactive mode (pipes/redirects), read a line directly without echoing
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          process.stdin.removeAllListeners('data');
          process.stdin.removeAllListeners('end');
          resolve(buffer.slice(0, newlineIndex).replace(/\r$/, ''));
        }
      });
      process.stdin.on('end', () => {
        resolve(buffer.replace(/\r?\n$/, ''));
      });
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const stdin = process.stdin;
    process.stdout.write(promptText);

    // Mute stdout while user types
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, encoding, callback) => {
      // Allow writing prompt and newline, hide typed characters
      if (chunk === promptText || chunk === '\n' || chunk === '\r\n') {
        return origWrite(chunk, encoding, callback);
      }
      return true;
    };

    rl.question('', (answer) => {
      process.stdout.write = origWrite;
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function createAdminUser({ email, name, phone, password, models, bcryptCost }) {
  // Validate inputs using standard validators
  const { errors, value } = validateRegister({
    role: 'customer', // mock role to validate common fields
    fullName: name,
    email,
    phone,
    password
  });

  const relevantErrors = {};
  if (errors.fullName) relevantErrors.name = errors.fullName;
  if (errors.email) relevantErrors.email = errors.email;
  if (errors.phone) relevantErrors.phone = errors.phone;
  if (errors.password) relevantErrors.password = errors.password;

  if (Object.keys(relevantErrors).length > 0) {
    const err = new Error('Thông tin không hợp lệ: ' + Object.values(relevantErrors).join('; '));
    err.validationErrors = relevantErrors;
    throw err;
  }

  // Idempotency check by email
  const existingByEmail = await models.users.findByEmail(value.email);
  if (existingByEmail) {
    if (existingByEmail.role === 'admin') {
      return { status: 'already_exists', user: existingByEmail };
    }
    const err = new Error(`Email ${value.email} đã tồn tại nhưng có vai trò '${existingByEmail.role}'. Không thể nâng quyền ngầm.`);
    err.code = 'ROLE_CONFLICT';
    throw err;
  }

  // Check phone uniqueness
  const existingByPhone = await models.users.findByPhone(value.phone);
  if (existingByPhone) {
    const err = new Error(`Số điện thoại ${value.phone} đã được sử dụng bởi tài khoản khác.`);
    err.code = 'PHONE_CONFLICT';
    throw err;
  }

  const passwordHash = await bcrypt.hash(value.password, bcryptCost || 10);
  const adminId = crypto.randomUUID();

  const user = await models.users.create({
    id: adminId,
    role: 'admin',
    status: 'active',
    fullName: value.fullName,
    email: value.email,
    phone: value.phone,
    passwordHash,
    orgName: null,
    orgType: null,
    providerId: null,
    orgArea: null,
    approvedBy: null,
    approvedAt: null,
    mustChangePassword: false,
    rejectReason: null
  });

  // Audit log entry
  if (models.audit && typeof models.audit.log === 'function') {
    await models.audit.log({
      actorUserId: null,
      action: 'admin_created',
      targetType: 'user',
      targetId: adminId,
      detail: 'create-admin script'
    });
  }

  return { status: 'created', user };
}

async function runCli() {
  const args = parseArgs(process.argv);
  if (!args.email || !args.name || !args.phone) {
    console.error('Thiếu tham số bắt buộc. Sử dụng: node scripts/create-admin.js --email <email> --name <name> --phone <phone>');
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHiddenPassword();
  }

  if (!password) {
    console.error('Mật khẩu không được để trống.');
    process.exit(1);
  }

  const config = loadConfig();
  const { createSqlModels } = require('../src/models');
  let pool = null;
  try {
    const sqlResources = await createSqlModels(config.db);
    pool = sqlResources.pool;
    const result = await createAdminUser({
      email: args.email,
      name: args.name,
      phone: args.phone,
      password,
      models: sqlResources.models,
      bcryptCost: config.bcryptCost
    });

    if (result.status === 'already_exists') {
      console.log(`Tài khoản Admin với email ${args.email} đã tồn tại.`);
      process.exit(0);
    } else {
      console.log(`Đã tạo thành công Admin: ${result.user.fullName} (${result.user.email})`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`Lỗi: ${err.message}`);
    process.exit(1);
  } finally {
    if (pool) {
      try { await pool.close(); } catch (_) {}
    }
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { createAdminUser, parseArgs };
