(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(error => console.warn('BernAudio: no se pudo registrar el modo instalable/offline.', error));
  }, { once: true });
})();
