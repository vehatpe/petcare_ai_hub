'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');
const { DISCLAIMER } = require('../src/utils/rag-prompts');
const { createGeminiClient } = require('../src/services/gemini-client');

const DISC = 'AI chỉ đóng vai trò tư vấn & sàng lọc ban đầu, không thay thế chẩn đoán lâm sàng của Bác sĩ thú y chuyên môn.';

function fakeAi({ onGenerate } = {}) {
  const calls = { embed: [], generate: [] };
  return {
    calls,
    // vectors: question about "nôn" -> [1,0,0]; about "tiêm" -> [0,1,0]; anything else -> [0,0,1]
    embed: async (text, taskType) => {
      calls.embed.push({ text, taskType });
      if (/nôn/.test(text)) return [1, 0, 0];
      if (/tiêm/.test(text)) return [0, 1, 0];
      return [0, 0, 1];
    },
    generate: async (args) => { calls.generate.push(args); return onGenerate ? onGenerate(args) : 'Câu trả lời dựa trên tài liệu.'; }
  };
}

async function seedChunks(app) {
  await app.models.knowledge.replaceDoc({ docSlug: 'nonm', docTitle: 'Nôn và bỏ ăn', reviewStatus: 'pending-veterinary-review' },
    [{ chunkIndex: 0, content: 'Nôn nhiều lần cần gặp bác sĩ thú y.', embedding: [1, 0, 0] }, { chunkIndex: 1, content: 'Theo dõi nướu.', embedding: [0.9, 0.1, 0] }]);
  await app.models.knowledge.replaceDoc({ docSlug: 'tiem', docTitle: 'Lịch tiêm chủng', reviewStatus: 'pending-veterinary-review' },
    [{ chunkIndex: 0, content: 'Tiêm nhắc hằng năm.', embedding: [0, 1, 0] }]);
}

test('AI chat', async (t) => {
  const ai = fakeAi();
  const app = await startTestApp({ ai });
  t.after(app.close);
  const { call } = app;
  const { token } = await app.registerCustomer();
  await seedChunks(app);

  await t.test('disclaimer constant matches contract text', () => assert.equal(DISCLAIMER, DISC));

  await t.test('grounded answer: sources are real titles, pet context from DB, retrieval before generate', async () => {
    const pet = await app.createPet(token, { name: 'Bơ', breed: 'Corgi', birthDate: '2024-03-10', weightKg: 11.5, conditions: 'dị ứng gà' });
    const r = await call('POST', '/ai/chat', { token, body: { message: 'Bé nôn 2 lần hôm nay', petId: pet.id } });
    assert.equal(r.status, 200);
    assert.equal(r.data.grounded, true);
    assert.equal(r.data.text, 'Câu trả lời dựa trên tài liệu.');
    assert.equal(r.data.disclaimer, DISC);
    assert.deepEqual(r.data.sources, [{ title: 'Nôn và bỏ ăn' }]);
    const prompt = ai.calls.generate.at(-1);
    assert.match(prompt.system, /Chỉ trả lời dựa trên/);
    assert.match(prompt.user, /Nôn nhiều lần cần gặp bác sĩ/);
    assert.match(prompt.user, /Tên: Bơ/);
    assert.match(prompt.user, /Giống: Corgi/);
    assert.match(prompt.user, /Tuổi: 2 tuổi 3 tháng/);
    assert.match(prompt.user, /11\.5 kg/);
    assert.match(prompt.user, /dị ứng gà/);
    assert.equal(ai.calls.embed.at(-1).taskType, 'RETRIEVAL_QUERY');
  });

  await t.test('only chunks above RAG_MIN_SCORE are passed to the model', async () => {
    await call('POST', '/ai/chat', { token, body: { message: 'lịch tiêm cho chó?' } });
    const prompt = ai.calls.generate.at(-1).user;
    assert.match(prompt, /Tiêm nhắc hằng năm/);
    assert.doesNotMatch(prompt, /Nôn nhiều lần/);
  });

  await t.test('below threshold: grounded=false, server template, no sources, generate NOT called', async () => {
    const before = ai.calls.generate.length;
    const r = await call('POST', '/ai/chat', { token, body: { message: 'Nên đặt tên gì cho bé?' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.grounded, false);
    assert.deepEqual(r.data.sources, []);
    assert.equal(r.data.disclaimer, DISC);
    assert.match(r.data.text, /chưa có tài liệu tham khảo phù hợp/);
    assert.match(r.data.text, /bác sĩ thú y/);
    assert.equal(ai.calls.generate.length, before);
  });

  await t.test('validation: empty / too long message, bad petId', async () => {
    assert.equal((await call('POST', '/ai/chat', { token, body: { message: '   ' } })).status, 422);
    assert.equal((await call('POST', '/ai/chat', { token, body: { message: 'a'.repeat(1001) } })).status, 422);
    assert.equal((await call('POST', '/ai/chat', { token, body: { message: 'hi', petId: 'zzz' } })).status, 422);
    assert.equal((await call('POST', '/ai/chat', { body: { message: 'hi' } })).status, 401);
  });

  await t.test('503 ai_unavailable when generate fails (no fake answer, disclaimer-free error envelope)', async () => {
    const bad = await startTestApp({ ai: fakeAi({ onGenerate: () => { throw new Error('boom: secret detail'); } }) });
    try {
      await seedChunks(bad);
      const u = await bad.registerCustomer();
      const r = await bad.call('POST', '/ai/chat', { token: u.token, body: { message: 'nôn' } });
      assert.equal(r.status, 503); assert.equal(r.body.code, 'ai_unavailable'); assert.equal(r.body.success, false);
      assert.equal(JSON.stringify(r.body).includes('secret detail'), false);
    } finally { await bad.close(); }
  });

  await t.test('503 when embedding fails', async () => {
    const bad = await startTestApp({ ai: { embed: async () => { throw new Error('net'); }, generate: async () => 'x' } });
    try {
      await seedChunks(bad);
      const u = await bad.registerCustomer();
      assert.equal((await bad.call('POST', '/ai/chat', { token: u.token, body: { message: 'nôn' } })).status, 503);
    } finally { await bad.close(); }
  });

  await t.test('503 when there are no knowledge chunks (and the model is never called)', async () => {
    const calls = fakeAi();
    const empty = await startTestApp({ ai: calls });
    try {
      const u = await empty.registerCustomer();
      const r = await empty.call('POST', '/ai/chat', { token: u.token, body: { message: 'nôn' } });
      assert.equal(r.status, 503); assert.equal(r.body.code, 'ai_unavailable');
      assert.equal(calls.calls.embed.length + calls.calls.generate.length, 0);
    } finally { await empty.close(); }
  });

  await t.test('rejected chunks are never retrieved; RAG_REQUIRE_APPROVED filters unreviewed', async () => {
    const strict = await startTestApp({ ai: fakeAi(), env: { RAG_REQUIRE_APPROVED: 'true' } });
    try {
      await seedChunks(strict); // all pending-veterinary-review
      const u = await strict.registerCustomer();
      assert.equal((await strict.call('POST', '/ai/chat', { token: u.token, body: { message: 'nôn' } })).status, 503);
      await strict.models.knowledge.replaceDoc({ docSlug: 'ok', docTitle: 'Đã duyệt', reviewStatus: 'approved' }, [{ chunkIndex: 0, content: 'Nội dung', embedding: [1, 0, 0] }]);
      const r = await strict.call('POST', '/ai/chat', { token: u.token, body: { message: 'nôn' } });
      assert.deepEqual(r.data.sources, [{ title: 'Đã duyệt' }]);
    } finally { await strict.close(); }
  });
});

test('Gemini REST client: no key -> ai_unavailable; request shape; error mapping', async () => {
  const noKey = createGeminiClient({ apiKey: '', model: 'm', embedModel: 'e', embedDim: 8 });
  await assert.rejects(noKey.embed('x'), (e) => e.status === 503 && e.code === 'ai_unavailable');
  await assert.rejects(noKey.generate({ system: 's', user: 'u' }), (e) => e.status === 503);

  const seen = [];
  const mkFetch = (resp) => async (url, init) => { seen.push({ url, init }); return resp; };
  const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
  const c = createGeminiClient({ apiKey: 'K', model: 'gen-model', embedModel: 'emb-model', embedDim: 8 },
    mkFetch(okJson({ embedding: { values: [0.1, 0.2] } })));
  assert.deepEqual(await c.embed('xin chào', 'RETRIEVAL_DOCUMENT'), [0.1, 0.2]);
  assert.match(seen[0].url, /models\/emb-model:embedContent$/);
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'K');
  assert.equal(seen[0].url.includes('K'), false, 'key is a header, never in the URL');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.taskType, 'RETRIEVAL_DOCUMENT'); assert.equal(body.outputDimensionality, 8);

  const g = createGeminiClient({ apiKey: 'K', model: 'gen-model', embedModel: 'e' },
    mkFetch(okJson({ candidates: [{ content: { parts: [{ text: 'Xin ' }, { text: 'chào' }] } }] })));
  assert.equal(await g.generate({ system: 'S', user: 'U' }), 'Xin chào');
  assert.match(seen[1].url, /models\/gen-model:generateContent$/);
  assert.equal(JSON.parse(seen[1].init.body).systemInstruction.parts[0].text, 'S');

  const http500 = createGeminiClient({ apiKey: 'K', model: 'm', embedModel: 'e' }, mkFetch({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(http500.generate({ system: 's', user: 'u' }), (e) => e.status === 503);
  const blocked = createGeminiClient({ apiKey: 'K', model: 'm', embedModel: 'e' }, mkFetch(okJson({ candidates: [] })));
  await assert.rejects(blocked.generate({ system: 's', user: 'u' }), (e) => e.status === 503);
  const netDown = createGeminiClient({ apiKey: 'K', model: 'm', embedModel: 'e' }, async () => { throw new Error('ECONNRESET'); });
  await assert.rejects(netDown.embed('x'), (e) => e.status === 503);
});
