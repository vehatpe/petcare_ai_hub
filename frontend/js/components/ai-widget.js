/**
 * PetCare AI Hub - Floating AI Chatbot Widget
 * Guests see a sign-in prompt instead of the chat. Signed-in owners chat with
 * context taken from their own pet profiles (never from sample pets).
 */

const AIWidget = {
  isOpen: false,
  activePet: null,

  init() {
    if (document.getElementById('petcare-ai-widget-root')) return;

    const root = document.createElement('div');
    root.id = 'petcare-ai-widget-root';
    root.innerHTML = `
      <button type="button" class="ai-widget-launcher" id="aiWidgetLauncher" aria-label="Mở Trợ lý AI PetCare" aria-expanded="false" aria-controls="aiWidgetPopup">
        <div class="ai-launcher-avatar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
        </div>
        <div class="ai-launcher-text">
          <span class="ai-launcher-title">Trợ lý AI</span>
          <span class="ai-launcher-status">Hỏi về sức khỏe bé</span>
        </div>
      </button>

      <div class="ai-widget-popup" id="aiWidgetPopup" role="dialog" aria-label="Trợ lý Y tế và Dinh dưỡng AI">
        <div class="ai-widget-header">
          <div class="ai-header-info">
            <div class="ai-header-avatar" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path></svg>
            </div>
            <div>
              <div class="ai-header-title">Trợ lý Y tế & Dinh dưỡng AI</div>
              <div class="ai-header-subtitle">Tư vấn sơ bộ, không thay bác sĩ</div>
            </div>
          </div>
          <button type="button" class="ai-close-btn" id="aiWidgetClose" aria-label="Đóng chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="ai-medical-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div><strong>Cảnh báo an toàn y tế:</strong> AI chỉ tư vấn và sàng lọc ban đầu, không thay thế chẩn đoán lâm sàng của bác sĩ thú y.</div>
        </div>

        <div class="ai-lock" id="aiWidgetLock"></div>

        <div class="ai-chat-body" id="aiChatBody">
          <div class="ai-context-strip" id="aiWidgetContext"></div>

          <div class="ai-messages-container" id="aiWidgetMessages" aria-live="polite">
            <div class="chat-bubble chat-bubble-bot">
              Xin chào! Tôi trả lời dựa trên tài liệu tham khảo của hệ thống, chỉ mang tính tham khảo. Bạn muốn hỏi điều gì về bé?
            </div>
          </div>

          <div class="ai-quick-suggestions">
            <button type="button" class="ai-chip" data-query="Chó bị nôn bỏ ăn phải làm sao?">Chó bị nôn bỏ ăn</button>
            <button type="button" class="ai-chip" data-query="Lịch tiêm phòng chuẩn cho chó mèo">Lịch tiêm vắc xin</button>
            <button type="button" class="ai-chip" data-query="Chế độ ăn phòng sỏi thận cho mèo">Dinh dưỡng phòng sỏi thận</button>
            <button type="button" class="ai-chip" data-query="Lịch tẩy giun định kỳ">Lịch tẩy giun</button>
          </div>

          <form class="ai-input-footer" id="aiWidgetForm">
            <input type="text" id="aiWidgetInput" placeholder="Nhập triệu chứng hoặc thắc mắc..." aria-label="Câu hỏi cho Trợ lý AI" autocomplete="off" required>
            <button type="submit" class="ai-send-btn" aria-label="Gửi tin nhắn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            </button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    this.bindEvents();
    this.refresh();
  },

  /** Re-evaluate auth state and pet list (called on open and when auth changes). */
  async refresh() {
    const popup = document.getElementById('aiWidgetPopup');
    const lock = document.getElementById('aiWidgetLock');
    const ctx = document.getElementById('aiWidgetContext');
    if (!popup) return;

    const user = AuthService.currentUser();
    const isStaff = user && user.role !== 'customer';
    popup.classList.toggle('is-locked', !user || isStaff);

    if (!user || isStaff) {
      const next = AuthService.currentAsNext();
      if (isStaff) {
        lock.innerHTML = `
          <h3>Chỉ chủ nuôi mới sử dụng Trợ lý AI</h3>
          <p>Trợ lý AI trả lời dựa trên hồ sơ thú cưng của chủ nuôi. Hãy đăng nhập tài khoản chủ nuôi để trò chuyện.</p>
          <div class="gate-panel-actions">
            <a class="btn btn-primary" href="${AuthService.homeUrl()}">Về trang chủ</a>
            <button type="button" class="btn btn-outline" data-action="logout-to-customer">Đăng xuất</button>
          </div>`;
      } else {
        lock.innerHTML = `
          <h3>Đăng nhập để trò chuyện</h3>
          <p>Trợ lý AI trả lời dựa trên hồ sơ thú cưng của bạn, nên cần có tài khoản. Đăng ký miễn phí chỉ mất một phút.</p>
          <div class="gate-panel-actions">
            <a class="btn btn-primary" href="${AuthGate.loginUrl(next)}">Đăng nhập</a>
            <a class="btn btn-outline" href="${AuthGate.registerUrl(next)}">Tạo tài khoản</a>
          </div>`;
      }
      this.activePet = null;
      return;
    }

    let pets;
    try {
      pets = await PetService.list();
    } catch (_) {
      ctx.innerHTML = '<span>Chưa tải được danh sách thú cưng. Bạn vẫn hỏi được câu hỏi chung.</span>';
      this.activePet = null;
      return;
    }
    if (!pets.length) {
      this.activePet = null;
      ctx.innerHTML = `<span>Chưa chọn hồ sơ thú cưng.</span> <a href="${AuthService.pageUrl('pet-profile.html')}">Thêm thú cưng</a>`;
      return;
    }

    this.pets = pets;
    if (!this.activePet || !pets.some((p) => p.id === this.activePet.id)) {
      this.activePet = this.toContext(pets[0]);
    }
    ctx.innerHTML = `
      <label for="aiWidgetPetSelect" class="ai-context-label">Hồ sơ đang chọn:</label>
      <select id="aiWidgetPetSelect">
        ${pets.map((p) => `<option value="${Fmt.esc(p.id)}"${p.id === this.activePet.id ? ' selected' : ''}>${Fmt.esc(p.name)} (${Fmt.esc(PetService.speciesLabel(p.species))})</option>`).join('')}
      </select>`;
    document.getElementById('aiWidgetPetSelect').addEventListener('change', (e) => {
      const pet = (this.pets || []).find((p) => p.id === e.target.value);
      if (pet) this.activePet = this.toContext(pet);
    });
  },

  toContext(pet) {
    return { id: pet.id, name: pet.name, breed: pet.breed || PetService.speciesLabel(pet.species), age: PetService.ageLabel(pet.birthDate) };
  },

  bindEvents() {
    const launcher = document.getElementById('aiWidgetLauncher');
    const popup = document.getElementById('aiWidgetPopup');
    const closeBtn = document.getElementById('aiWidgetClose');
    const form = document.getElementById('aiWidgetForm');
    const input = document.getElementById('aiWidgetInput');

    const setOpen = (open) => {
      this.isOpen = open;
      popup.classList.toggle('active', open);
      launcher.setAttribute('aria-expanded', String(open));
      if (open) {
        this.refresh();
        const target = popup.classList.contains('is-locked') ? popup.querySelector('.ai-lock a') : input;
        if (target) target.focus();
      } else {
        launcher.focus();
      }
    };

    launcher.addEventListener('click', () => setOpen(!this.isOpen));
    closeBtn.addEventListener('click', () => setOpen(false));
    popup.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) setOpen(false); });
    window.addEventListener('petcare:auth-changed', () => this.refresh());

    document.querySelectorAll('#aiWidgetPopup .ai-chip').forEach((chip) => {
      chip.addEventListener('click', () => this.handleSendMessage(chip.getAttribute('data-query')));
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      this.handleSendMessage(message);
      input.value = '';
    });
  },

  async handleSendMessage(userText) {
    const messagesContainer = document.getElementById('aiWidgetMessages');

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble chat-bubble-user';
    userBubble.textContent = userText;
    messagesContainer.appendChild(userBubble);

    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'chat-bubble chat-bubble-bot';
    loadingBubble.innerHTML = '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="visually-hidden" role="status">Đang tra cứu cơ sở kiến thức thú y...</span>';
    messagesContainer.appendChild(loadingBubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      const response = await AIChatService.ask(userText, this.activePet && this.activePet.id);
      loadingBubble.remove();
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble chat-bubble-bot';
      botBubble.innerHTML = AIChatService.answerHtml(response);
      messagesContainer.appendChild(botBubble);
    } catch (err) {
      loadingBubble.remove();
      const errBubble = document.createElement('div');
      errBubble.className = 'chat-bubble chat-bubble-bot';
      errBubble.setAttribute('role', 'alert');
      errBubble.textContent = AIChatService.errorMessage(err);
      messagesContainer.appendChild(errBubble);
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
};

window.AIWidget = AIWidget;
