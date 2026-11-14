'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');
const { createDb } = require('../src/models/db');

test('Phase B: Health check endpoint', async (t) => {
  const app = await startTestApp();
  t.after(app.close);

  await t.test('GET /health returns 200 and database connected', async () => {
    const res = await app.call('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, { status: 'ok', database: 'connected' });
  });

  await t.test('GET /health returns 503 without leaking details when DB ping fails', async () => {
    const origPing = app.models.ping;
    app.models.ping = async () => { throw new Error('Secret connection failure detail'); };
    try {
      const res = await app.call('GET', '/health');
      assert.equal(res.status, 503);
      assert.equal(res.body.success, false);
      assert.deepEqual(res.body.data, { status: 'down', database: 'disconnected' });
      assert.equal(JSON.stringify(res.body).includes('Secret connection failure detail'), false);
    } finally {
      app.models.ping = origPing;
    }
  });
});

test('Phase B: Helmet CSP header removes unsafe-inline from script-src', async (t) => {
  const app = await startTestApp();
  t.after(app.close);

  const res = await app.call('GET', '/health');
  const csp = res.headers.get('content-security-policy') || '';

  assert.ok(csp.length > 0, 'CSP header must be present');
  assert.match(csp, /script-src[^;]*'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'script-src must NOT contain unsafe-inline');
});

test('Phase B: Separate rate limiters', async (t) => {
  // Test with tight limits: authMax = 2, aiMax = 2, meMax = 100
  const app = await startTestApp({
    env: {
      AUTH_RATE_LIMIT_MAX: '2',
      AI_RATE_LIMIT_MAX: '2',
      ME_RATE_LIMIT_MAX: '100'
    },
    ai: {
      embed: async () => [0, 0, 1],
      generate: async () => 'Trợ lý AI phản hồi.'
    }
  });
  t.after(app.close);

  await t.test('authLimiter: isolates by identifier (user A hits 429, user B unaffected)', async () => {
    // 2 failed attempts for userA@example.com
    await app.call('POST', '/auth/login', { body: { identifier: 'userA@example.com', password: 'wrongpassword' } });
    await app.call('POST', '/auth/login', { body: { identifier: 'userA@example.com', password: 'wrongpassword' } });

    // 3rd attempt for userA@example.com -> 429 rate_limited
    const blockedA = await app.call('POST', '/auth/login', { body: { identifier: 'userA@example.com', password: 'wrongpassword' } });
    assert.equal(blockedA.status, 429);
    assert.equal(blockedA.body.code, 'rate_limited');

    // userB@example.com on the same IP is still allowed (returns 401 credentials, not 429)
    const allowedB = await app.call('POST', '/auth/login', { body: { identifier: 'userB@example.com', password: 'wrongpassword' } });
    assert.equal(allowedB.status, 401);
    assert.equal(allowedB.body.code, 'credentials');
  });

  await t.test('meLimiter: 40 consecutive requests to /auth/me succeed without 429', async () => {
    const user = await app.registerCustomer();
    for (let i = 0; i < 40; i++) {
      const meRes = await app.call('GET', '/auth/me', { token: user.token });
      assert.equal(meRes.status, 200, `Request ${i + 1} to /auth/me must return 200`);
    }
  });

  await t.test('aiLimiter: keyed by authenticated user ID (user 1 blocked at limit, user 2 still allowed)', async () => {
    const user1 = await app.registerCustomer();
    const user2 = await app.registerCustomer();

    // Seed dummy knowledge chunk so /ai/chat proceeds
    await app.models.knowledge.replaceDoc(
      { docSlug: 'test', docTitle: 'Tài liệu test', reviewStatus: 'pending-veterinary-review' },
      [{ chunkIndex: 0, content: 'Nội dung test', embedding: [0, 0, 1] }]
    );

    // Call 1 & 2 for user 1
    const r1 = await app.call('POST', '/ai/chat', { token: user1.token, body: { message: 'Chào AI lần 1' } });
    assert.equal(r1.status, 200);
    const r2 = await app.call('POST', '/ai/chat', { token: user1.token, body: { message: 'Chào AI lần 2' } });
    assert.equal(r2.status, 200);

    // Call 3 for user 1 -> 429 rate_limited
    const r3Blocked = await app.call('POST', '/ai/chat', { token: user1.token, body: { message: 'Chào AI lần 3' } });
    assert.equal(r3Blocked.status, 429);
    assert.equal(r3Blocked.body.code, 'rate_limited');

    // User 2 on the same IP can still call /ai/chat
    const rUser2 = await app.call('POST', '/ai/chat', { token: user2.token, body: { message: 'User 2 hỏi AI' } });
    assert.equal(rUser2.status, 200);
  });
});

test('Phase B: SQL 1205 Deadlock Retry in db.transaction', async (t) => {
  function createMockPool() {
    let txCount = 0;
    const pool = {
      request() { return { query: async () => ({ recordset: [] }) }; }
    };
    return {
      pool,
      getTxCount: () => txCount,
      sqlMock: {
        Transaction: class {
          constructor() {
            txCount++;
            this.begun = false;
            this.committed = false;
            this.rolledBack = false;
          }
          async begin() { this.begun = true; }
          async commit() { this.committed = true; }
          async rollback() { this.rolledBack = true; }
          request() {
            return {
              input() { return this; },
              query: async () => ({ recordset: [{ ok: 1 }] })
            };
          }
        }
      }
    };
  }

  await t.test('retries on SQL 1205 and succeeds on attempt 3 (attempt 0, 1 deadlock; 2 ok)', async () => {
    const { pool, getTxCount, sqlMock } = createMockPool();
    const origTx = require('mssql').Transaction;
    require('mssql').Transaction = sqlMock.Transaction;

    try {
      const db = createDb(pool);
      let workAttempts = 0;

      const result = await db.transaction(async () => {
        workAttempts++;
        if (workAttempts < 3) {
          const err = new Error('Transaction was deadlocked');
          err.number = 1205;
          throw err;
        }
        return 'success_after_deadlock';
      });

      assert.equal(result, 'success_after_deadlock');
      assert.equal(workAttempts, 3, 'Must attempt 3 times (initial + 2 retries)');
      assert.equal(getTxCount(), 3, 'Must create 3 distinct transactions');
    } finally {
      require('mssql').Transaction = origTx;
    }
  });

  await t.test('gives up and throws after 2 retries if 1205 persists', async () => {
    const { pool, getTxCount, sqlMock } = createMockPool();
    const origTx = require('mssql').Transaction;
    require('mssql').Transaction = sqlMock.Transaction;

    try {
      const db = createDb(pool);
      let workAttempts = 0;

      await assert.rejects(
        async () => {
          await db.transaction(async () => {
            workAttempts++;
            const err = new Error('Persistent deadlock');
            err.number = 1205;
            throw err;
          });
        },
        (err) => err.number === 1205
      );

      assert.equal(workAttempts, 3, 'Must attempt exactly 3 times before giving up');
      assert.equal(getTxCount(), 3);
    } finally {
      require('mssql').Transaction = origTx;
    }
  });

  await t.test('does NOT retry on non-1205 error (e.g. 2627 unique violation)', async () => {
    const { pool, getTxCount, sqlMock } = createMockPool();
    const origTx = require('mssql').Transaction;
    require('mssql').Transaction = sqlMock.Transaction;

    try {
      const db = createDb(pool);
      let workAttempts = 0;

      await assert.rejects(
        async () => {
          await db.transaction(async () => {
            workAttempts++;
            const err = new Error('Duplicate key violation');
            err.number = 2627;
            throw err;
          });
        },
        (err) => err.number === 2627
      );

      assert.equal(workAttempts, 1, 'Non-1205 error must fail immediately on attempt 1');
      assert.equal(getTxCount(), 1);
    } finally {
      require('mssql').Transaction = origTx;
    }
  });
});
