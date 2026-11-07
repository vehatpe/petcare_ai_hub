'use strict';
const { aiUnavailable, validation, notFound } = require('../utils/errors');
const { cosineSimilarity } = require('../utils/vector-math');
const { DISCLAIMER, SYSTEM_PROMPT, buildUserPrompt, ungroundedAnswer } = require('../utils/rag-prompts');
const { todayInTz, ageLabel } = require('../utils/time');
const { isUuid } = require('../utils/validators');

const guard = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e && e.name === 'AppError') throw e;
    throw aiUnavailable('Dịch vụ AI gặp lỗi. Vui lòng thử lại sau.');
  }
};

const SPECIES_VI = { dog: 'chó', cat: 'mèo', other: 'khác' };

/** ai = { embed(text, taskType) -> number[], generate({system, user}) -> string } (injectable). */
function createAiRagService({ models, ai, config, clock = () => new Date() }) {
  let cache = { at: 0, chunks: null };

  async function loadChunks() {
    const now = Date.now();
    if (cache.chunks && now - cache.at < config.rag.cacheTtlMs) return cache.chunks;
    let chunks = await models.knowledge.listChunks();
    chunks = chunks.filter((c) => c.reviewStatus !== 'rejected' && (!config.rag.requireApproved || c.reviewStatus === 'approved'));
    cache = { at: now, chunks };
    return chunks;
  }

  async function petContext(ownerId, petId) {
    if (petId === undefined || petId === null || petId === '') return null;
    if (!isUuid(petId)) throw validation('Mã thú cưng không hợp lệ.', { petId: 'Mã thú cưng không hợp lệ.' });
    const pet = await models.pets.getByOwner(petId.toLowerCase(), ownerId);
    if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
    const lines = [
      `Tên: ${pet.name}`,
      `Loài: ${SPECIES_VI[pet.species] || pet.species}`,
      pet.breed ? `Giống: ${pet.breed}` : null,
      `Tuổi: ${ageLabel(pet.birthDate, todayInTz(clock(), config.timezone))}`,
      pet.weightKg ? `Cân nặng mới nhất: ${pet.weightKg} kg` : null,
      pet.conditions ? `Lưu ý sức khỏe chủ nuôi ghi: ${pet.conditions}` : null
    ];
    return lines.filter(Boolean).join('\n');
  }

  return {
    invalidateCache() { cache = { at: 0, chunks: null }; },

    async chat(ownerId, input) {
      const message = typeof (input && input.message) === 'string' ? input.message.trim() : '';
      if (!message || message.length > 1000) {
        throw validation('Câu hỏi cần từ 1 đến 1000 ký tự.', { message: 'Câu hỏi cần từ 1 đến 1000 ký tự.' });
      }
      const context = await petContext(ownerId, input.petId);

      const chunks = await loadChunks();
      if (!chunks.length) throw aiUnavailable('Kho tài liệu tham khảo của trợ lý AI chưa có nội dung. Quản trị viên cần nạp tài liệu trước.');

      const qv = await guard(() => ai.embed(message, 'RETRIEVAL_QUERY'));
      const ranked = chunks
        .map((c) => ({ c, score: cosineSimilarity(qv, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, config.rag.topK);

      if (!ranked.length || ranked[0].score < config.rag.minScore) {
        return { text: ungroundedAnswer(), disclaimer: DISCLAIMER, sources: [], grounded: false };
      }
      const used = ranked.filter((r) => r.score >= config.rag.minScore).map((r) => r.c);
      const text = await guard(() => ai.generate({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({ message, petContext: context, excerpts: used })
      }));
      const titles = [...new Set(used.map((c) => c.docTitle))];
      return { text, disclaimer: DISCLAIMER, sources: titles.map((title) => ({ title })), grounded: true };
    }
  };
}

module.exports = { createAiRagService };
