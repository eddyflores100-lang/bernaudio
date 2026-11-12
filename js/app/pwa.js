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
  for (const id of ['selInput', 'selChannels', 'selFft']) {
    document.getElementById(id)?.addEventListener('change', updateSummary);
  }
  updateSummary();

  const installButtons = [...document.querySelectorAll('[data-pwa-install]')];
  const guide = document.getElementById('pwaInstallGuide');
  const guideDone = document.getElementById('btnInstallGuideDone');
  const closeGuide = document.getElementById('btnCloseInstallGuide');
  const intro = document.getElementById('pwaInstallIntro');
  const iosDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    navigator.standalone === true;
  let deferredInstallPrompt = null;
  let lastInstallButton = null;

  const showGuide = (button) => {
    lastInstallButton = button || null;
    if (!guide) return;
    if (intro) {
      intro.textContent = iosDevice
        ? 'En iPhone o iPad, la instalación se inicia desde el menú Compartir del navegador.'
        : 'En Android, usa el aviso de instalación o el menú del navegador. En otros equipos, busca la opción Instalar en el menú.';
    }
    guide.hidden = false;
    guideDone?.focus();
  };
  const hideGuide = () => {
    if (!guide) return;
    guide.hidden = true;
    lastInstallButton?.focus?.();
  };
  const setInstalled = () => {
    installButtons.forEach(button => {
      button.hidden = true;
      button.disabled = true;
    });
  };
  const setInstallAvailable = () => {
    if (isStandalone()) { setInstalled(); return; }
    installButtons.forEach(button => {
      button.hidden = false;
      button.disabled = false;
      button.textContent = deferredInstallPrompt ? '⇩ Instalar app' : (iosDevice ? 'Cómo instalar' : '⇩ Instalar app');
    });
  };

  for (const button of installButtons) {
    button.addEventListener('click', async () => {
      if (isStandalone()) { setInstalled(); return; }
      if (!deferredInstallPrompt) { showGuide(button); return; }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      setInstallAvailable();
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === 'accepted') {
          button.textContent = 'Instalando…';
        } else {
          button.textContent = '⇩ Instalar app';
        }
      } catch (_) {
        showGuide(button);
      }
    });
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallAvailable();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstalled();
  });
  closeGuide?.addEventListener('click', hideGuide);
  guideDone?.addEventListener('click', hideGuide);
  guide?.addEventListener('click', event => {
    if (event.target === guide) hideGuide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && guide && !guide.hidden) hideGuide();
  });
  setInstallAvailable();

  const network = document.getElementById('pwaNetworkStatus');
  const updateNetwork = () => {
    if (!network) return;
    const online = navigator.onLine !== false;
    network.textContent = online ? 'En línea' : 'Sin conexión · IA y clima no disponibles';
    network.classList.toggle('is-offline', !online);
    network.classList.toggle('is-online', online);
  };
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  updateNetwork();

  const updateBanner = document.getElementById('pwaUpdateBanner');
  const applyUpdate = document.getElementById('btnApplyPwaUpdate');
  const dismissUpdate = document.getElementById('btnDismissPwaUpdate');
  const showUpdate = () => { if (updateBanner) updateBanner.hidden = false; };
  applyUpdate?.addEventListener('click', () => window.location.reload());
  dismissUpdate?.addEventListener('click', () => { if (updateBanner) updateBanner.hidden = true; });

  const applyShortcut = () => {
    const match = String(window.location?.search || '').match(/[?&]view=(field|spl)(?:&|$)/);
    const view = match?.[1];
    if (view === 'field' || view === 'spl') window.UI?.showTab?.(view);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyShortcut, { once: true });
  } else {
    applyShortcut();
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showUpdate();
      hadController = true;
    });
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        if (registration.waiting && navigator.serviceWorker.controller) showUpdate();
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
          });
        });
        if (navigator.onLine !== false) registration.update().catch(() => {});
      } catch (error) {
        console.warn('BernAudio: no se pudo registrar el modo instalable/offline.', error);
      }
    }, { once: true });
  }
})();
