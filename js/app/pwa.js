(() => {
  'use strict';
  const settings = document.querySelector('.mobile-settings');
  if (settings && window.matchMedia?.('(max-width: 720px)').matches) settings.open = false;
  const updateSummary = () => {
    const node = document.getElementById('mobileSettingsSummary');
    if (!node) return;
    const input = document.getElementById('selInput');
    const channels = document.getElementById('selChannels');
    const fft = document.getElementById('selFft');
    const inputName = input?.selectedOptions?.[0]?.textContent || 'Micrófono';
    node.textContent = inputName + ' · ' + (channels?.value === '2' ? 'Estéreo' : 'Mono') + ' · FFT ' + (fft?.value || '8192');
  };
  for (const id of ['selInput', 'selChannels', 'selFft']) document.getElementById(id)?.addEventListener('change', updateSummary);
  updateSummary();
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(error => console.warn('BernAudio: no se pudo registrar el modo instalable/offline.', error));
  }, { once: true });
})();
