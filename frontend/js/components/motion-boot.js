/**
 * Runs in <head> (blocking, tiny): marks the document as motion-enabled unless the visitor
 * prefers reduced motion. If motion.js never loads, the class is removed so content stays visible.
 */
(function (d) {
  'use strict';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  d.classList.add('js-motion');
  setTimeout(function () { if (!window.PetCareMotion) d.classList.remove('js-motion'); }, 3000);
})(document.documentElement);
