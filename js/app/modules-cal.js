/* ═══════════════════════════════════════════════════════════════
   BernAudio — modules-cal.js
   CALIBRACIÓN DE MICRÓFONO DE MEDICIÓN
   Carga el archivo de corrección del fabricante (.cal/.csv/.txt/.frd)
   sin necesidad de pistófono: curva de corrección por frecuencia
   aplicada en vivo a SPL, RTA, Espectrograma y Función de Transferencia.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const DSP = global.DSP, BAU = global.BAU;

  const Cal = {
    el: {},
    init() {
      ['calFile', 'calApply', 'calExport', 'calRemove', 'calInfo', 'cvCal']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.calFile.addEventListener('change', () => this.loadFile());
      this.el.calApply.addEventListener('change', () => {
        const S = global.BA_STATE;
        S.micCalOn = this.el.calApply.checked && !!S.micCal;
        try { localStorage.setItem('ba_miccal_on', S.micCalOn ? '1' : '0'); } catch (e) {}
        this.changed();
        this.refreshInfo();
        this.draw();
      });
      this.el.calRemove.addEventListener('click', () => {
        const S = global.BA_STATE;
        S.micCal = null; S.micCalOn = false;
        try {
          localStorage.removeItem('ba_miccal');
          localStorage.removeItem('ba_miccal_on');
        } catch (e) {}
        this.el.calApply.checked = false;
        this.el.calFile.value = '';
        this.changed();
        this.refreshInfo();
        this.draw();
      });
      this.el.calExport.addEventListener('click', () => this.exportCsv());
      this.el.calApply.checked = !!global.BA_STATE.micCal && global.BA_STATE.micCalOn;
      this.refreshInfo();
    },

    changed() {
      global.BA_STATE.calibrated = false;
      global.UI.calibrationChanged();
    },
    onShow() { this.draw(); },

    loadFile() {
      const f = this.el.calFile.files && this.el.calFile.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { this.el.calInfo.textContent = 'Archivo demasiado grande (máximo 1 MB).'; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = DSP.parseCalFile(String(reader.result));
        if (!parsed) {
          this.el.calInfo.textContent = 'archivo no válido (se necesitan ≥5 pares freq, dB)';
          return;
        }
        const S = global.BA_STATE;
        S.micCal = parsed;
        S.micCalOn = true;
        try {
          localStorage.setItem('ba_miccal', JSON.stringify({
            f: Array.from(parsed.freqs, (v) => +v.toFixed(2)),
            db: Array.from(parsed.db, (v) => +v.toFixed(2)),
          }));
          localStorage.setItem('ba_miccal_on', '1');
        } catch (e) { /* cuota llena: la curva queda solo en memoria */ }
        this.el.calApply.checked = true;
        this.changed();
        this.refreshInfo();
        this.draw();
        global.UI.setStatus('calibración de micrófono cargada ✓');
      };
      reader.onerror = () => { this.el.calInfo.textContent = 'No se pudo leer el archivo. Prueba con un archivo de texto local.'; };
      reader.readAsText(f);
    },

    refreshInfo() {
      const S = global.BA_STATE;
      this.el.calExport.disabled = this.el.calRemove.disabled = this.el.calApply.disabled = !S.micCal;
      if (!S.micCal) { this.el.calInfo.textContent = 'sin archivo'; return; }
      const f = S.micCal.freqs;
      this.el.calInfo.textContent =
        f.length + ' pts · ' + Math.round(f[0]) + '–' + Math.round(f[f.length - 1]) + ' Hz' +
        (S.micCalOn ? ' · ACTIVA' : ' · inactiva');
    },

    exportCsv() {
      const S = global.BA_STATE;
      if (!S.micCal) return;
      const lines = ['frecuencia_hz,correccion_db'];
      for (let i = 0; i < S.micCal.freqs.length; i++) {
        lines.push(S.micCal.freqs[i].toFixed(2) + ',' + S.micCal.db[i].toFixed(2));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bernaudio-cal-micro.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },

    draw() {
      const S = global.BA_STATE;
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvCal);
      ctx.clearRect(0, 0, w, h);
      if (!S.micCal) {
        ctx.fillStyle = 'rgba(140,163,160,0.5)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('Carga un archivo de calibración (.cal / .csv / .txt / .frd) para ver la curva', 16, h / 2);
        return;
      }
      const f = S.micCal.freqs, db = S.micCal.db;
      const fmin = Math.max(10, f[0]), fmax = Math.max(fmin * 10, f[f.length - 1]);
      let dmin = Infinity, dmax = -Infinity;
      for (let i = 0; i < db.length; i++) {
        dmin = Math.min(dmin, db[i]);
        dmax = Math.max(dmax, db[i]);
      }
      const pad = Math.max(2, (dmax - dmin) * 0.12);
      dmin -= pad; dmax += pad;
      const padL = 44, padB = 22, padT = 8;
      const plotW = w - padL - 8, plotH = h - padB - padT;

      /* rejilla dB */
      ctx.strokeStyle = 'rgba(140,163,160,0.14)';
      ctx.fillStyle = 'rgba(140,163,160,0.55)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      const span = dmax - dmin;
      const step = span > 40 ? 10 : span > 16 ? 5 : 2;
      for (let d = Math.ceil(dmin / step) * step; d <= dmax; d += step) {
        const yy = padT + plotH * (1 - (d - dmin) / span);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(d.toFixed(0), 8, yy + 3);
      }
      /* décadas */
      [100, 1000, 10000].forEach((fq) => {
        if (fq < fmin || fq > fmax) return;
        const xx = padL + (Math.log10(fq / fmin) / Math.log10(fmax / fmin)) * plotW;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.fillText(fq >= 1000 ? fq / 1000 + 'k' : fq, xx - 8, h - 6);
      });
      /* curva de corrección */
      const on = S.micCalOn;
      ctx.beginPath();
      for (let i = 0; i < f.length; i++) {
        const xx = padL + (Math.log10(Math.max(f[i], fmin) / fmin) / Math.log10(fmax / fmin)) * plotW;
        const yy = padT + plotH * (1 - (db[i] - dmin) / span);
        i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = on ? '#F5B04C' : 'rgba(140,163,160,0.6)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      /* leyenda */
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = on ? '#F5B04C' : 'rgba(140,163,160,0.7)';
      ctx.fillText(on
        ? '● corrección aplicada a SPL · RTA · Espectrograma · Transferencia'
        : '○ curva cargada (aplicación desactivada)', padL + 8, padT + 12);
    },
  };

  global.MOD_CAL = Cal;
})(window);
