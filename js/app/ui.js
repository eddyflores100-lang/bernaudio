/* ═══════════════════════════════════════════════════════════════
   BernAudio — ui.js
   Arranque, pestañas, bucle rAF, calibración y estado global
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const AE = global.AE;

  /* ── Estado global compartido ── */
  const BA_STATE = {
    cal: parseFloat(localStorage.getItem('ba_cal') || '94'),
  };
  global.BA_STATE = BA_STATE;

  const MODULES = {
    spl: global.MOD_SPL,
    rta: global.MOD_RTA,
    spectro: global.MOD_SPECTRO,
    tf: global.MOD_TF,
    ir: global.MOD_IR,
    gen: global.MOD_GEN,
  };

  const UI = {
    active: 'spl',
    started: false,

    init() {
      /* módulos */
      Object.values(MODULES).forEach((m) => m.init());

      /* overlay */
      document.getElementById('btnStart').addEventListener('click', () => this.boot(false));
      const errBox = document.getElementById('startError');

      /* botón alternativo (sin micrófono) se crea bajo demanda */
      this._errBox = errBox;

      /* tabs */
      document.querySelectorAll('.tab').forEach((t) => {
        t.addEventListener('click', () => this.showTab(t.dataset.mod));
      });

      /* FFT */
      const selFft = document.getElementById('selFft');
      selFft.addEventListener('change', () => {
        AE.setFftSize(+selFft.value);
        document.getElementById('stFft').textContent = selFft.value;
        Object.values(MODULES).forEach((m) => m.onFftChange && m.onFftChange());
      });
      document.getElementById('stFft').textContent = selFft.value;

      /* calibración */
      const calSlider = document.getElementById('calOffset');
      calSlider.value = BA_STATE.cal;
      const calChip = document.getElementById('calChip');
      const stCal = document.getElementById('stCal');
      const paintCal = () => {
        BA_STATE.cal = +calSlider.value;
        calChip.textContent = BA_STATE.cal.toFixed(1) + ' dB';
        stCal.textContent = BA_STATE.cal.toFixed(1) + ' dBFS→SPL';
        try { localStorage.setItem('ba_cal', String(BA_STATE.cal)); } catch (e) {}
      };
      calSlider.addEventListener('input', paintCal);
      paintCal();

      /* detener */
      document.getElementById('btnStop').addEventListener('click', () => this.shutdown());

      /* carga de dispositivos */
      this.refreshInputs();
      navigator.mediaDevices && navigator.mediaDevices.addEventListener &&
        navigator.mediaDevices.addEventListener('devicechange', () => this.refreshInputs());
      document.getElementById('selInput').addEventListener('change', async () => {
        if (this.started && !AE.noMic) await this.reboot();
      });

      /* bucle */
      let last = performance.now();
      const loop = (now) => {
        const dt = Math.min(100, now - last);
        last = now;
        const m = MODULES[this.active];
        if (m && (AE.running || this.active === 'gen')) {
          try { m.tick(dt); } catch (e) { console.error('[tick ' + this.active + ']', e); }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    async boot(retryWithNoMic) {
      const errBox = this._errBox;
      errBox.style.display = 'none';
      try {
        const sel = document.getElementById('selInput');
        const sr = await AE.start(sel.value || null);
        this.started = true;
        this._setOverlay(false);
        document.getElementById('stSr').textContent = (sr / 1000).toFixed(1) + ' kHz';
        document.getElementById('stDot').classList.add('on');
        document.getElementById('stText').textContent = 'medición activa';
        this.setStatus('medición activa');
        Object.values(MODULES).forEach((m) => m.onFftChange && m.onFftChange());
        this.refreshInputs();
      } catch (err) {
        console.warn(err);
        errBox.style.display = 'block';
        errBox.innerHTML =
          '⚠️ ' + (err && err.name === 'NotAllowedError'
            ? 'Permiso de micrófono denegado. Habilítalo en el candado de la barra de direcciones y reintenta.'
            : 'No se pudo acceder al micrófono: ' + (err && err.message ? err.message : err)) +
          '<br><br><button class="btn btn-sm btn-amber" id="btnNoMic">Continuar sin micrófono (solo generador)</button>';
        const b = document.getElementById('btnNoMic');
        if (b) b.addEventListener('click', async () => {
          const sr = await AE.startCtxOnly();
          this.started = true;
          this._setOverlay(false);
          document.getElementById('stSr').textContent = (sr / 1000).toFixed(1) + ' kHz';
          document.getElementById('stDot').classList.add('on');
          document.getElementById('stText').textContent = 'sin micrófono';
          this.setStatus('sin micrófono — solo generador');
        });
      }
    },

    async reboot() {
      const sel = document.getElementById('selInput');
      try {
        const sr = await AE.start(sel.value || null);
        document.getElementById('stSr').textContent = (sr / 1000).toFixed(1) + ' kHz';
        AE.noMic = false;
        this.setStatus('medición activa');
      } catch (e) { console.warn(e); }
    },

    shutdown() {
      MOD_TF.stop(); MOD_GEN.stop();
      AE.stop();
      this.started = false;
      document.getElementById('stDot').classList.remove('on');
      document.getElementById('stText').textContent = 'detenido';
      this._setOverlay(true);
    },

    _setOverlay(show) {
      document.getElementById('overlay').classList.toggle('hidden', !show);
    },

    async refreshInputs() {
      const sel = document.getElementById('selInput');
      const prev = sel.value;
      try {
        const list = await AE.inputs();
        sel.innerHTML = '<option value="">Micrófono predeterminado</option>';
        list.forEach((d, i) => {
          const o = document.createElement('option');
          o.value = d.deviceId;
          o.textContent = d.label || ('Entrada ' + (i + 1));
          sel.appendChild(o);
        });
        if (prev) sel.value = prev;
      } catch (e) { /* sin permisos aún: lista vacía */ }
    },

    showTab(name) {
      this.active = name;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mod === name));
      document.querySelectorAll('.module').forEach((mEl) => {
        mEl.classList.toggle('active', mEl.id === 'mod-' + name);
      });
    },

    setStatus(txt) {
      const el = document.getElementById('stText');
      if (el) el.textContent = txt;
    },
  };

  global.UI = UI;
  document.addEventListener('DOMContentLoaded', () => UI.init());
})(window);
