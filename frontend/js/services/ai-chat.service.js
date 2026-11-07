/**
 * PetCare AI Hub - AI assistant client
 * Sends the question to /api/v1/ai/chat (RAG over the knowledge base + Gemini on the server).
 * There is no offline or simulated answer: when the service is unavailable the caller gets an
 * ApiError (code "ai_unavailable") whose message explains why.
 *
 * Exposed as window.AIChatService
 */
(function () {
  'use strict';

  window.AIChatService = {
    /** Resolves to { text, disclaimer, sources:[{title}], grounded }. */
    ask(message, petId) {
      return Api.post('/ai/chat', { message, petId: petId || undefined });
    },

    /**
     * HTML for one answer bubble. The model text is escaped first (Fmt.richText), the medical
     * disclaimer is always shown, and an answer without knowledge-base support says so.
     */
    answerHtml(res) {
      const esc = Fmt.esc;
      const sources = (res.sources || []).map((x) => esc(x.title)).filter(Boolean);
      return `
        <div class="ai-answer">${Fmt.richText(res.text || '')}</div>
        ${res.grounded
          ? (sources.length ? `<p class="ai-source-list"><strong>Nguồn tham khảo:</strong> ${sources.join('; ')}</p>` : '')
          : '<p class="ai-source-list"><strong>Lưu ý:</strong> Câu trả lời này không dựa trên tài liệu nào trong cơ sở kiến thức của hệ thống.</p>'}
        <div class="ai-source-note"><strong>Cảnh báo an toàn y tế:</strong> ${esc(res.disclaimer || 'Thông tin chỉ mang tính tham khảo, không thay thế chẩn đoán của bác sĩ thú y.')}</div>`;
    },

    /** Plain-language message for a failed ask(). */
    errorMessage(err) {
      if (err && err.code === 'ai_unavailable') return 'Trợ lý AI hiện chưa hoạt động (dịch vụ AI chưa sẵn sàng). Bạn vẫn có thể đặt lịch với bác sĩ thú y.';
      if (err && err.status === 429) return 'Bạn gửi hơi nhanh. Vui lòng chờ một chút rồi thử lại.';
      if (err && err.code === 'network') return 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';
      return (err && err.message) || 'Chưa nhận được phản hồi. Vui lòng thử lại.';
    }
  };
})();
