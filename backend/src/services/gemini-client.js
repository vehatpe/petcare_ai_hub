'use strict';
// Thin Gemini REST client (no SDK). Any failure becomes aiUnavailable (HTTP 503) - never a fake answer.
const { aiUnavailable } = require('../utils/errors');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function createGeminiClient({ apiKey, model, embedModel, embedDim, timeoutMs = 25000 }, fetchImpl = (...a) => fetch(...a)) {
  async function call(path, body) {
    if (!apiKey) throw aiUnavailable('Trợ lý AI chưa được cấu hình (thiếu GEMINI_API_KEY).');
    let res;
    try {
      res = await fetchImpl(`${BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (_) {
      throw aiUnavailable('Không kết nối được dịch vụ AI. Vui lòng thử lại sau.');
    }
    if (!res.ok) throw aiUnavailable(`Dịch vụ AI trả về lỗi (HTTP ${res.status}). Vui lòng thử lại sau.`);
    try { return await res.json(); } catch (_) { throw aiUnavailable('Dịch vụ AI trả về dữ liệu không hợp lệ.'); }
  }

  return {
    isConfigured: () => Boolean(apiKey),

    /** taskType: RETRIEVAL_QUERY | RETRIEVAL_DOCUMENT */
    async embed(text, taskType = 'RETRIEVAL_QUERY') {
      const body = { content: { parts: [{ text }] }, taskType };
      if (embedDim) body.outputDimensionality = embedDim;
      const data = await call(`models/${embedModel}:embedContent`, body);
      const values = data && data.embedding && data.embedding.values;
      if (!Array.isArray(values) || !values.length) throw aiUnavailable('Dịch vụ AI không trả về vector nhúng.');
      return values;
    },

    async generate({ system, user }) {
      const data = await call(`models/${model}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
      });
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
      if (!text) throw aiUnavailable('Dịch vụ AI không tạo được câu trả lời (có thể bị chặn bởi bộ lọc an toàn). Vui lòng thử lại.');
      return text;
    }
  };
}

module.exports = { createGeminiClient };
