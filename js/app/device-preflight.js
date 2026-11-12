/* Device preflight and reusable, local-only measurement profiles. */
(function (global) {
  'use strict';
  const KEY = 'bernaudio.deviceProfiles.v1';
  const el = id => global.document.getElementById(id);
  const safeText = (value, max = 80) => String(value || '').trim().slice(0, max);
  const readProfiles = () => {
    try {
      const value = JSON.parse(global.localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value.filter(p => p && typeof p.name === 'string' && typeof p.inputLabel === 'string').slice(0, 12) : [];
    } catch (_) { return []; }
  };
  const writeProfiles = profiles => {
    try { global.localStorage.setItem(KEY, JSON.stringify(profiles.slice(0, 12))); return true; }
    catch (_) { return false; }
  };
  const PREFLIGHT = {
    init() {
      this.select = el('deviceProfileSelect');
      this.name = el('deviceProfileName');
      this.status = el('devicePreflightStatus');
      this.results = el('devicePreflightResults');
      el('deviceProfileSave')?.addEventListener('click', () => this.save());
      el('deviceProfileApply')?.addEventListener('click', () => this.apply());
      el('deviceProfileDelete')?.addEventListener('click', () => this.remove());
      el('devicePreflightRun')?.addEventListener('click', () => this.run());
      this.renderProfiles();
      this.run();
    },
    renderProfiles() {
      if (!this.select) return;
      const selected = this.select.value;
      this.select.textContent = '';
      const placeholder = global.document.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Selecciona un perfil guardado';
      this.select.appendChild(placeholder);
      readProfiles().forEach((profile, index) => {
        const option = global.document.createElement('option');
        option.value = String(index); option.textContent = profile.name + ' · ' + profile.inputLabel;
        this.select.appendChild(option);
      });
      if ([...this.select.children].some(option => option.value === selected)) this.select.value = selected;
    },
    snapshot() {
      const input = el('selInput');
      const label = input?.selectedOptions?.[0]?.textContent || 'Micrófono predeterminado';
      const state = global.BA_STATE || {};
      const curve = state.micCal ? {
        f: Array.from(state.micCal.freqs || []).slice(0, 4096),
        db: Array.from(state.micCal.db || []).slice(0, 4096)
      } : null;
      return {
        schemaVersion: 1, name: safeText(this.name?.value, 48) || 'Perfil de medición',
        inputLabel: safeText(label, 120), channels: Number(el('selChannels')?.value || 1),
        fftSize: Number(el('selFft')?.value || 8192), sampleRateAtSave: Number(global.AE?.sampleRate || 0),
        levelOffsetDb: Number.isFinite(state.cal) ? state.cal : 94,
        correctionCurve: curve, correctionEnabled: !!state.micCalOn,
        savedAt: new Date().toISOString()
      };
    },
    save() {
      const profile = this.snapshot();
      if (!profile.inputLabel || ![1, 2].includes(profile.channels) ||
          ![2048,4096,8192,16384,32768].includes(profile.fftSize) ||
          !Number.isFinite(profile.levelOffsetDb) || profile.levelOffsetDb < 0 || profile.levelOffsetDb > 180) {
        this.message('No se pudo guardar: revisa la entrada, canales y calibración.'); return;
      }
      const profiles = readProfiles();
      const index = profiles.findIndex(item => item.name.toLowerCase() === profile.name.toLowerCase() && item.inputLabel === profile.inputLabel);
      if (index >= 0) profiles[index] = profile; else if (profiles.length < 12) profiles.push(profile);
      else { this.message('Límite de 12 perfiles. Elimina uno antes de guardar otro.'); return; }
      if (!writeProfiles(profiles)) { this.message('Almacenamiento local no disponible. Exporta una sesión como respaldo.'); return; }
      this.renderProfiles(); this.select.value = String(Math.max(0, profiles.indexOf(profile)));
      this.message('Perfil guardado solo en este dispositivo. El nivel absoluto seguirá pendiente de verificación al aplicarlo.');
    },
    apply() {
      const index = Number(this.select?.value);
      const profile = readProfiles()[index];
      if (!profile) { this.message('Selecciona un perfil válido.'); return; }
      const input = el('selInput');
      const options = [...(input?.options || [])];
      const match = options.find(option => (option.textContent || '').trim() === profile.inputLabel);
      if (!match) { this.message('No se encontró la misma entrada de audio. Selecciónala manualmente; no se aplicó el perfil.'); return; }
      if (global.AE?.running) { this.message('Detén la captura antes de cambiar el perfil.'); return; }
      input.value = match.value;
      el('selChannels').value = String(profile.channels);
      el('selFft').value = String(profile.fftSize);
      el('selFft').dispatchEvent(new Event('change'));
      const offset = el('calOffset');
      offset.value = String(profile.levelOffsetDb);
      offset.dispatchEvent(new Event('input'));
      const state = global.BA_STATE;
      if (profile.correctionCurve && Array.isArray(profile.correctionCurve.f) &&
          Array.isArray(profile.correctionCurve.db) &&
          profile.correctionCurve.f.length >= 5 && profile.correctionCurve.f.length === profile.correctionCurve.db.length &&
          profile.correctionCurve.f.length <= 4096 &&
          profile.correctionCurve.f.every((v,i) => Number.isFinite(v) && v > 0 && (!i || v > profile.correctionCurve.f[i-1])) &&
          profile.correctionCurve.db.every(Number.isFinite)) {
        state.micCal = global.DSP.parseCalFile(profile.correctionCurve.f.map((f,i) => f + '\\t' + profile.correctionCurve.db[i]).join('\\n'));
        state.micCalOn = !!state.micCal && !!profile.correctionEnabled;
        if (state.micCal) {
          try {
            global.localStorage.setItem('ba_miccal', JSON.stringify({f:Array.from(state.micCal.freqs),db:Array.from(state.micCal.db)}));
            global.localStorage.setItem('ba_miccal_on', state.micCalOn ? '1' : '0');
          } catch (_) {}
          const apply = el('calApply'); if (apply) apply.checked = state.micCalOn;
          global.MOD_CAL?.refreshInfo?.(); global.MOD_CAL?.draw?.();
        }
      }
      state.calibrated = false;
      global.UI?.paintCalibration?.();
      global.UI?.refreshInputs?.();
      this.message('Perfil aplicado. Comprueba la cadena y vuelve a verificar el nivel con una referencia acústica antes de usar SPL absoluto.');
      this.run();
    },
    remove() {
      const index = Number(this.select?.value), profiles = readProfiles();
      if (!Number.isInteger(index) || index < 0 || index >= profiles.length) return;
      profiles.splice(index, 1); writeProfiles(profiles); this.renderProfiles();
      this.message('Perfil eliminado de este dispositivo.');
    },
    row(label, value, good, note = '') {
      const item = global.document.createElement('div'); item.className = 'preflight-row';
      const title = global.document.createElement('strong'); title.textContent = label;
      const detail = global.document.createElement('span'); detail.textContent = value + (note ? ' · ' + note : '');
      item.dataset.state = good ? 'ok' : 'warn'; item.appendChild(title); item.appendChild(detail); this.results?.appendChild(item);
    },
    run() {
      if (!this.results) return;
      this.results.textContent = '';
      const ae = global.AE || {}, state = global.BA_STATE || {};
      const input = el('selInput'), label = input?.selectedOptions?.[0]?.textContent || 'Micrófono predeterminado';
      const devices = global.navigator?.mediaDevices;
      const secure = global.isSecureContext === true;
      const running = !!ae.running;
      const channels = Number(ae.realChannels || 0);
      const processing = ['echoCancellation','noiseSuppression','autoGainControl'].filter(key => ae.settings?.[key] === true);
      this.row('Conexión segura', secure ? 'HTTPS disponible' : 'Se requiere HTTPS', secure, 'permite acceso al micrófono');
      this.row('Permiso y entrada', running ? label : 'Captura aún no iniciada', running && !!devices, 'el navegador solicita permiso al iniciar');
      this.row('Canales', running ? channels + ' canal(es) detectados' : Number(el('selChannels')?.value || 1) + ' solicitado(s)' ,
        running ? channels >= Number(el('selChannels')?.value || 1) : true,
        'el dispositivo puede limitar la entrada a mono');
      this.row('Frecuencia de muestreo', running ? (ae.sampleRate || 0) + ' Hz' : 'Se detectará al iniciar', running && ae.sampleRate >= 8000, 'informada por el navegador');
      this.row('Procesamiento del sistema', processing.length ? processing.join(', ') : 'No reportado como activo',
        processing.length === 0, 'el navegador puede aplicar procesamiento no expuesto');
      this.row('Corrección de micrófono', state.micCal ? (state.micCalOn ? 'Curva activa' : 'Curva cargada, inactiva') : 'Sin curva cargada',
        !!state.micCal && !!state.micCalOn, 'corrección de frecuencia');
      this.row('Nivel absoluto', state.calibrated ? 'Offset declarado' : 'Pendiente de verificación',
        !!state.calibrated, 'requiere referencia acústica y misma ganancia');
      this.message('Diagnóstico orientativo. Una marca verde no certifica la precisión acústica.');
    },
    message(value) { if (this.status) this.status.textContent = value; }
  };
  global.PREFLIGHT = PREFLIGHT;
  global.document.addEventListener('DOMContentLoaded', () => PREFLIGHT.init(), { once: true });
})(window);
