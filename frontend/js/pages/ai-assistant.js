/**
 * PetCare AI Hub - Dedicated AI assistant page
 * Guests see a sign-in panel. Owners chat with context from their own pet profiles;
 * "recent questions" are the owner's own past questions (stored per account).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const win = document.getElementById('aiMainWindow');
  const user = AuthService.currentUser();
  const lock = document.getElementById('pageLock');
  const petSelect = document.getElementById('pagePetSelect');
  const hint = document.getElementById('petSelectHint');
  const recentEl = document.getElementById('recentList');

  if (!user) {
    win.classList.add('is-locked');
    const next = AuthService.currentAsNext();
    lock.innerHTML = `
      <h3>Đăng nhập để trò chuyện với Trợ lý AI</h3>
      <p>Trợ lý trả lời dựa trên hồ sơ thú cưng của bạn, nên cần có tài khoản. Đăng ký miễn phí chỉ mất một phút.</p>
      <div class="gate-panel-actions">
        <a class="btn btn-primary" href="${AuthGate.loginUrl(next)}">Đăng nhập</a>
        <a class="btn btn-outline" href="${AuthGate.registerUrl(next)}">Tạo tài khoản</a>
      </div>`;
    petSelect.disabled = true;
    petSelect.innerHTML = '<option>Đăng nhập để chọn hồ sơ</option>';
    document.getElementById('btnNewChat').disabled = true;
    recentEl.innerHTML = '<p class="ai-conv-empty">Đăng nhập để lưu câu hỏi của bạn.</p>';
    return;
  }

  const form = document.getElementById('pageChatForm');
  const input = document.getElementById('pageChatInput');
  const messages = document.getElementById('pageChatMessages');
  const HISTORY_KEY = `petcare_ai_recent_${user.id}`;
  let pets = [];
  const params = new URLSearchParams(window.location.search);
  let currentPet = null;

  /* ---------- Pet context (loaded from the API) ---------- */
  function setupPets() {
    if (pets.length) {
      const preset = pets.find((p) => p.id === params.get('pet')) || pets[0];
      currentPet = preset;
      petSelect.innerHTML = pets.map((p) => `<option value="${Fmt.esc(p.id)}"${p.id === preset.id ? ' selected' : ''}>${Fmt.esc(p.name)} (${Fmt.esc(PetService.speciesLabel(p.species))})</option>`).join('');
    } else {
      petSelect.disabled = true;
      petSelect.innerHTML = '<option>Chưa có hồ sơ thú cưng</option>';
      hint.innerHTML = 'Bạn vẫn hỏi được câu hỏi chung. <a href="pet-profile.html?next=ai-assistant.html"><strong>Thêm thú cưng</strong></a> để câu trả lời đúng với bé.';
      hint.hidden = false;
    }
  }
  petSelect.disabled = true;
  petSelect.innerHTML = '<option>Đang tải…</option>';
  PetService.list().then((list) => { pets = list; petSelect.disabled = false; setupPets(); })
    .catch(() => { petSelect.innerHTML = '<option>Không tải được hồ sơ</option>'; hint.textContent = 'Chưa tải được hồ sơ thú cưng. Bạn vẫn hỏi được câu hỏi chung.'; hint.hidden = false; });

  petSelect.addEventListener('change', () => {
    currentPet = pets.find((p) => p.id === petSelect.value) || null;
  });

  /* ---------- Recent questions ---------- */
  const loadRecent = () => {
    try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
  };
  function remember(text) {
    const list = [text, ...loadRecent().filter((q) => q !== text)].slice(0, 8);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (_) { /* optional */ }
    renderRecent();
  }
  function renderRecent() {
    const list = loadRecent();
    recentEl.innerHTML = list.length
      ? list.map((q) => `<button type="button" class="ai-conv-item" data-q="${Fmt.esc(q)}">${Fmt.esc(q)}</button>`).join('')
      : '<p class="ai-conv-empty">Chưa có câu hỏi nào. Câu hỏi bạn gửi sẽ hiện ở đây.</p>';
  }
  recentEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (btn) sendMessage(btn.dataset.q);
  });

  /* ---------- Chat ---------- */
  document.querySelectorAll('.ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => sendMessage(chip.getAttribute('data-query')));
  });

  document.getElementById('btnNewChat').addEventListener('click', () => {
    const who = currentPet ? `<strong>${Fmt.esc(currentPet.name)}</strong>` : 'thú cưng của bạn';
    messages.innerHTML = `<div class="chat-bubble chat-bubble-bot">Cuộc trò chuyện mới đã bắt đầu. Tôi có thể giúp gì cho ${who} hôm nay?</div>`;
    input.focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendMessage(text);
    input.value = '';
  });

  async function sendMessage(userText) {
    const u = document.createElement('div');
    u.className = 'chat-bubble chat-bubble-user';
    u.textContent = userText;
    messages.appendChild(u);
    remember(userText);

    const loading = document.createElement('div');
    loading.className = 'chat-bubble chat-bubble-bot';
    loading.innerHTML = '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="visually-hidden" role="status">Đang tra cứu cơ sở kiến thức thú y...</span>';
    messages.appendChild(loading);
    messages.scrollTop = messages.scrollHeight;

    try {
      const res = await AIChatService.ask(userText, currentPet && currentPet.id);
      loading.remove();
      const bot = document.createElement('div');
      bot.className = 'chat-bubble chat-bubble-bot';
      bot.innerHTML = AIChatService.answerHtml(res);
      messages.appendChild(bot);
    } catch (err) {
      loading.remove();
      const bot = document.createElement('div');
      bot.className = 'chat-bubble chat-bubble-bot';
      bot.setAttribute('role', 'alert');
      bot.textContent = AIChatService.errorMessage(err);
      messages.appendChild(bot);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  renderRecent();
});
