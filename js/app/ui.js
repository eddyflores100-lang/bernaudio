/* Measurement lifecycle and accessible controls; storage is optional. */
(function (global) {
  'use strict';
  const AE = global.AE, DSP = global.DSP;
  const read = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) {} };
  let saved = null;
  try {
    const data = JSON.parse(read('ba_miccal', 'null'));
    if (data && Array.isArray(data.f) && Array.isArray(data.db) && data.f.length === data.db.length)
      saved = DSP.parseCalFile(data.f.map((f, i) => f + '\t' + data.db[i]).join('\n'));
  } catch (_) {}
  const offset = Number(read('ba_cal', '94'));
  const BA_STATE = {
    cal: Number.isFinite(offset) && offset >= 0 && offset <= 180 ? offset : 94,
    calibrated: false, micCal: saved, micCalOn: !!saved && read('ba_miccal_on') === '1',
    micCalDb(f) { return this.micCal && this.micCalOn ? DSP.interpLogDb(f, this.micCal.freqs, this.micCal.db) : 0; }
  };
  BA_STATE.micCalDb = BA_STATE.micCalDb.bind(BA_STATE); global.BA_STATE = BA_STATE;
  const MODULES = { spl: global.MOD_SPL, rta: global.MOD_RTA, spectro: global.MOD_SPECTRO,
    tf: global.MOD_TF, ir: global.MOD_IR, gen: global.MOD_GEN, delay: global.MOD_DELAY, cal: global.MOD_CAL };
  const el = id => document.getElementById(id);
  const each = fn => Object.values(MODULES).filter(Boolean).forEach(fn);
  const UI = {
    active: 'spl', started: false, _busy: false, _operation: 0,
    init() {
      each(m => m.init()); this._errBox = el('startError');
      el('btnStart').addEventListener('click', () => this.boot());
      el('btnGenOnly').addEventListener('click', () => this.startNoMic());
      el('btnStop').addEventListener('click', () => this.shutdown());
      el('btnResume').addEventListener('click', async () => {
        try { if (AE.ctx) { await AE.ctx.resume(); this.setStatus(AE.running ? 'Captura activa' : 'Solo generador'); } }
        catch (e) { this.setStatus('No se pudo reanudar: ' + e.message); }
      });
      document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => this.showTab(t.dataset.mod));
        t.addEventListener('keydown', e => {
          const tabs = [...document.querySelectorAll('.tab')], i = tabs.indexOf(t);
          let next;
          if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
          if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
          if (e.key === 'Home') next = 0;
          if (e.key === 'End') next = tabs.length - 1;
          if (next != null) { e.preventDefault(); this.showTab(tabs[next].dataset.mod); tabs[next].focus(); }
        });
      });
      el('selFft').addEventListener('change', () => {
        AE.setFftSize(+el('selFft').value); el('stFft').textContent = AE.fftSize;
        each(m => m.onFftChange?.());
      });
      for (const id of ['selChannels', 'selInput']) el(id).addEventListener('change', async () => {
        BA_STATE.calibrated = false; this.paintCalibration();
        if (this.started && !AE.noMic) await this.reboot();
      });
      el('calOffset').value = BA_STATE.cal;
      el('calOffset').addEventListener('input', () => {
        BA_STATE.cal = +el('calOffset').value; BA_STATE.calibrated = false;
        write('ba_cal', BA_STATE.cal); this.calibrationChanged();
      });
      el('calSetReference').addEventListener('click', () => this.setReference());
      el('calConfirm').addEventListener('click', () => {
        BA_STATE.calibrated = true; this.calibrationChanged(); this.setStatus('Offset manual declarado; vuelve a comprobarlo si cambia la ganancia o la entrada.');
      });
      el('btnSession').addEventListener('click', () => this.exportSession());
      el('rtaExport').addEventListener('click', () => {
        const r = MODULES.rta;
        if (!r.disp?.some(Number.isFinite)) { this.setStatus('Espera a tener un espectro válido.'); return; }
        const rows = ['# nivel,' + (BA_STATE.calibrated ? 'calibrado por usuario' : 'estimado'), 'frecuencia_hz,nivel_db' + el('rtaWeight').value];
        r.bands.forEach((b, i) => { if (Number.isFinite(r.disp[i])) rows.push(b.fc.toFixed(3) + ',' + r.disp[i].toFixed(3)); });
        global.BAU.download('bernaudio_rta.csv', '\uFEFF' + rows.join('\n'), 'text/csv;charset=utf-8');
      });
      el('rtaPng').addEventListener('click', () => {
        const a = document.createElement('a'); a.href = el('cvRta').toDataURL('image/png'); a.download = 'bernaudio_rta.png'; a.click();
      });
      this.paintCalibration(); this.refreshInputs();
      navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshInputs());
      global.addEventListener?.('pagehide', () => this.shutdown());
      let last = performance.now(), accumulated = 0;
      const loop = now => {
        const dt = Math.max(0, now - last); last = now; accumulated += dt;
        if (accumulated >= 50) {
          const delta = accumulated; accumulated = 0;
          if (AE.running) {
            // Measurement runs irrespective of the selected tool. SPL uses input blocks.
            for (const name of ['tf', 'delay']) try { MODULES[name]?.tick(delta); } catch (e) { console.error(name, e); }
            if (!['tf', 'delay'].includes(this.active)) try { MODULES[this.active]?.tick?.(delta); } catch (e) { console.error(this.active, e); }
          } else if (this.active === 'gen') MODULES.gen?.tick?.(delta);
          const quality = el('stQuality');
          if (quality) quality.textContent = AE.clipped ? 'SATURACIÓN · baja la ganancia' : AE.running ? AE.backend : 'Sin captura';
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop); this.showTab('spl');
    },
    paintCalibration() {
      if (el('calChip')) el('calChip').textContent = BA_STATE.cal.toFixed(1) + ' dB';
      if (el('stCal')) el('stCal').textContent = BA_STATE.calibrated ? 'Offset declarado' : 'SIN CALIBRAR';
      if (el('levelNotice')) el('levelNotice').textContent = BA_STATE.calibrated
        ? 'Nivel con offset declarado por el usuario. La lectura depende del micrófono y la ganancia; no es un sonómetro certificado.'
        : 'Nivel estimado, sin calibrar. Ajusta Calibración con una referencia conocida antes de interpretar valores absolutos.';
    },
    calibrationChanged() {
      MODULES.spl?.reset(); MODULES.rta?.rebuild(); MODULES.spectro?.resetOff();
      if (MODULES.tf?.measuring) MODULES.tf.resetAvg();
      this.paintCalibration();
    },
    setReference() {
      const target = Number(el('calReference').value), spl = MODULES.spl;
      if (!AE.running || !Number.isFinite(spl.lastRawDb) || spl.lastRawDb < -120) { this.setStatus('Necesitas una señal de referencia estable y el micrófono activo.'); return; }
      if (el('splWeight').value !== 'Z') { this.setStatus('Selecciona ponderación Z antes de calibrar con el tono de referencia.'); return; }
      const value = target - spl.lastRawDb;
      if (!Number.isFinite(target) || target < 30 || target > 140 || value < 0 || value > 180) { this.setStatus('Nivel de referencia u offset fuera de rango.'); return; }
      BA_STATE.cal = Math.round(value * 10) / 10; BA_STATE.calibrated = true;
      el('calOffset').value = BA_STATE.cal; write('ba_cal', BA_STATE.cal); this.calibrationChanged();
      this.setStatus('Nivel ajustado a ' + target + ' dB con la referencia del usuario.');
    },
    _beforeStop() { each(m => m.onAudioStop?.()); },
    _afterStart() { each(m => { if (m.onAudioStart) m.onAudioStart(); else m.onFftChange?.(); }); },
    async boot() {
      if (this._busy) return; const operation = ++this._operation; this._busy = true; this._errBox.style.display = 'none'; this._setBusy(true);
      try {
        this._beforeStop(); await AE.start(el('selInput').value || null, +el('selChannels').value);
        if (operation !== this._operation) return;
        this.started = true; BA_STATE.calibrated = false; this.paintCalibration(); this._afterStart();
        this._setOverlay(false); this._paintHardware(); await this.refreshInputs();
        if (operation !== this._operation) return;
        this.setStatus(AE.channels > AE.realChannels ? 'Entrada mono detectada: TF loopback y Delay dual requieren dos canales físicos.' : 'Captura activa · salida en silencio');
        this.showTab(this.active); document.querySelector('.tab.active')?.focus();
      } catch (err) { if (operation === this._operation) { this.started = false; if (err.name !== 'AbortError') this._showError(err); } }
      finally { if (operation === this._operation) { this._busy = false; this._setBusy(false); } }
    },
    async startNoMic() {
      if (this._busy) return; const operation = ++this._operation; this._busy = true; this._setBusy(true);
      try {
        this._beforeStop(); await AE.startCtxOnly();
        if (operation !== this._operation) return;
        this.started = true; this._afterStart();
        this._setOverlay(false); this._paintHardware(); this.showTab('gen'); this.setStatus('Solo generador · salida en silencio hasta Reproducir');
      } catch (err) { if (operation === this._operation && err.name !== 'AbortError') this._showError(err); }
      finally { if (operation === this._operation) { this._busy = false; this._setBusy(false); } }
    },
    async reboot() { await this.boot(); },
    async shutdown(message = 'Detenido · salida en silencio') {
      const operation = ++this._operation;
      this._beforeStop(); this.started = false; this._busy = false; this._setBusy(false); this._setOverlay(true);
      el('stDot')?.classList.remove('on'); this.setStatus(message);
      await AE.stop();
      if (operation === this._operation) this.setStatus(message);
    },
    _paintHardware() {
      el('stSr').textContent = (AE.sampleRate / 1000).toFixed(1) + ' kHz'; el('stCh').textContent = AE.realChannels + ' reportados';
      el('stDot').classList.add('on');
      const processing = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter(k => AE.settings[k] === true);
      el('hardwareNotice').textContent = processing.length ? 'El dispositivo mantiene procesamiento activo: ' + processing.join(', ') : 'Entrada 1 = medición · Entrada 2 = referencia cableada. fs indica el contexto del navegador.';
    },
    _showError(err) {
      const box = this._errBox; box.style.display = 'block';
      box.textContent = err?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Habilítalo en el navegador o elige Solo generador.' : 'No se pudo iniciar: ' + (err?.message || String(err));
      this._setOverlay(true);
    },
    _setBusy(value) { for (const id of ['btnStart', 'btnGenOnly', 'selInput', 'selChannels']) if (el(id)) el(id).disabled = value; },
    _setOverlay(show) { el('overlay').classList.toggle('hidden', !show); if (el('workspace')) el('workspace').inert = show; },
    async refreshInputs() {
      const select = el('selInput'), prev = select.value;
      try {
        const list = await AE.inputs(); select.innerHTML = '<option value="">Micrófono predeterminado</option>';
        list.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Entrada ' + (i + 1); select.appendChild(o); });
        if (list.some(d => d.deviceId === prev)) select.value = prev;
      } catch (_) {}
    },
    showTab(name) {
      this.active = name;
      document.querySelectorAll('.tab').forEach(t => {
        const active = t.dataset.mod === name; t.classList.toggle('active', active); t.setAttribute('aria-selected', active); t.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll('.module').forEach(panel => panel.classList.toggle('active', panel.id === 'mod-' + name));
      MODULES[name]?.onShow?.();
    },
    exportSession() {
      const report = { product: 'BernAudio', schemaVersion: 1, createdAt: new Date().toISOString(),
        sampleRate: AE.sampleRate, channels: AE.realChannels, captureBackend: AE.backend,
        level: MODULES.spl.snapshot(), correctionCurve: BA_STATE.micCal ? { enabled: BA_STATE.micCalOn,
          frequencies: Array.from(BA_STATE.micCal.freqs), db: Array.from(BA_STATE.micCal.db) } : null,
        limitations: ['Nivel dependiente de calibración y ganancia.', 'Retardo interno incluye latencia de cadena.', 'No es un sonómetro certificado.'] };
      global.BAU.download('bernaudio_session.json', JSON.stringify(report, null, 2), 'application/json');
      this.setStatus('Informe de sesión exportado en JSON.');
    },
    setStatus(text) { if (el('stText')) el('stText').textContent = text; }
  };
  global.UI = UI;
  document.addEventListener('DOMContentLoaded', () => UI.init());
})(window);
