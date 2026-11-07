/**
 * PetCare AI Hub - Global Main Script
 * Header, drawer and auth state live in components/header.js; this file only
 * boots shared widgets. The old "quick role switcher" was removed on purpose:
 * roles come from the signed-in account, never from a UI toggle.
 */
document.addEventListener('DOMContentLoaded', () => {
  try { localStorage.removeItem('petcare_current_role'); } catch (_) { /* ignore */ }
  if (window.AIWidget) window.AIWidget.init();
});
