/* ═══════════════════════════════════════════════════════════════
   BernAudio — modules-spl.js
   Módulos: SPL · RTA · Espectrograma
   Define también utilidades compartidas (window.BAU)
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const DSP = global.DSP, AE = global.AE;

  /* Polyfill roundRect para navegadores antiguos */
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
  }

  /* ── Utilidades compartidas ─────────────────────────────── */
  const BAU = {
    /* Ajusta canvas a DPR; devuelve {ctx, w, h} lógicos */
    fitCanvas(cv) {
      const dpr = global.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.max(1, Math.round(w * dpr));
        cv.height = Math.max(1, Math.round(h * dpr));
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w, h };
    },
    /* Color por nivel p∈[0,1]: teal → ámbar → rojo */
    levelColor(p) {
      p = DSP.clamp(p, 0, 1);
      let r, g, b;
      if (p < 0.5) {
        const t = p / 0.5;
        r = 45 + t * (245 - 45); g = 212 + t * (176 - 212); b = 191 + t * (76 - 191);
      } else {
        const t = (p - 0.5) / 0.5;
        r = 245 + t * (249 - 245); g = 176 + t * (112 - 176); b = 76 + t * (102 - 76);
      }
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    },
    fmtDb(v, digits) {
      if (!isFinite(v)) return '--';
      return v.toFixed(digits === undefined ? 1 : digits);
    },
  };
  BAU.yToPx = (v, vMin, vMax, h) => h - ((v - vMin) / (vMax - vMin)) * h;
  global.BAU = BAU;

  /* ════════════════ MÓDULO SPL ════════════════ */
  const SPL = {
    hist: [], histMax: 240, // 2 muestras/s × 120 s
    msFast: null, msSlow: null, leqPower: null, leqN: 0,
    lMin: Infinity, lMax: -Infinity,
    lastHistT: 0,

    el: {},
    init() {
      ['splNow', 'splNowL', 'splLeq', 'splMax', 'splMin', 'splPeak', 'splWeight', 'splSpeed', 'splReset', 'cvSplHist']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      // etiqueta real del Peak (Z, dominio tiempo)
      const lbl = this.el.splPeak.parentElement.querySelector('.l');
      if (lbl) lbl.textContent = 'Peak (Z)';
      this.el.splReset.addEventListener('click', () => this.reset());
    },
    reset() {
      this.msFast = this.msSlow = this.leqPower = null;
      this.leqN = 0; this.lMin = Infinity; this.lMax = -Infinity; this.hist = [];
    },
    /* Potencia total ponderada desde freqDb (dB/bin) */
    totalPower(weightDb) {
      const cal = global.BA_STATE.cal;
      const calFn = global.BA_STATE.micCalDb;
      let p = 0;
      const binHz = AE.sampleRate / AE.fftSize;
      for (let i = 1; i < AE.freqDb.length; i++) {
        const f = i * binHz;
        if (f < 20 || f > 20000) continue;
        const l = AE.freqDb[i] + cal + calFn(f) + (weightDb ? weightDb(f) : 0);
        p += Math.pow(10, l / 10);
      }
      return p;
    },
    tick(dtMs) {
      if (!AE.poll()) return;
      const wSel = this.el.splWeight.value;
      const wf = wSel === 'A' ? DSP.aWeightDb : wSel === 'C' ? DSP.cWeightDb : null;

      const p = this.totalPower(wf);
      const aF = Math.exp(-dtMs / 125), aS = Math.exp(-dtMs / 1000);
      this.msFast = this.msFast == null ? p : aF * this.msFast + (1 - aF) * p;
      this.msSlow = this.msSlow == null ? p : aS * this.msSlow + (1 - aS) * p;
      this.leqPower = this.leqPower == null ? p : this.leqPower + p;
      this.leqN++;

      const useFast = this.el.splSpeed.value === 'fast';
      const level = DSP.dbFromPower(useFast ? this.msFast : this.msSlow);
      if (isFinite(level)) {
        this.lMin = Math.min(this.lMin, level);
        this.lMax = Math.max(this.lMax, level);
      }

      /* Peak dominio tiempo (Z) */
      const pk = DSP.dbFromAmp(AE.peak()) + global.BA_STATE.cal;

      /* Readouts */
      const set = (id, v) => { this.el[id].textContent = isFinite(v) ? v.toFixed(1) : '--'; };
      set('splNow', level);
      set('splLeq', DSP.dbFromPower(this.leqPower / this.leqN));
      set('splMax', this.lMax); set('splMin', this.lMin); set('splPeak', pk);
      this.el.splNow.className = 'v' + (level > 100 ? ' hot' : level > 85 ? ' warn' : '');
      this.el.splNowL.textContent = 'dB' + wSel + ' · ' + (useFast ? 'Fast' : 'Slow');

      /* Historial 2 Hz */
      this.lastHistT += dtMs;
      if (this.lastHistT >= 500) {
        this.lastHistT = 0;
        this.hist.push(level);
        if (this.hist.length > this.histMax) this.hist.shift();
      }
      this.drawHist();
    },
    drawHist() {
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvSplHist);
      const yMin = 30, yMax = 120;
      ctx.clearRect(0, 0, w, h);
      /* rejilla */
      ctx.strokeStyle = 'rgba(140,163,160,0.14)'; ctx.fillStyle = 'rgba(140,163,160,0.55)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      for (let y = 40; y <= 120; y += 20) {
        const yy = BAU.yToPx(y, yMin, yMax, h - 18);
        ctx.beginPath(); ctx.moveTo(30, yy); ctx.lineTo(w - 4, yy); ctx.stroke();
        ctx.fillText(y.toFixed(0), 2, yy + 3);
      }
      if (this.hist.length < 2) return;
      /* línea + relleno */
      const n = this.hist.length, x0 = 30, x1 = w - 6;
      const px = (i) => x0 + ((x1 - x0) * i) / (this.histMax - 1);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = isFinite(this.hist[i]) ? DSP.clamp(this.hist[i], yMin, yMax) : yMin;
        const yy = BAU.yToPx(v, yMin, yMax, h - 18);
        i === 0 ? ctx.moveTo(px(i + (this.histMax - n)), yy) : ctx.lineTo(px(i + (this.histMax - n)), yy);
      }
      ctx.strokeStyle = '#2DD4BF'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.lineTo(px(this.histMax), h - 18); ctx.lineTo(px(this.histMax - n), h - 18); ctx.closePath();
      ctx.fillStyle = 'rgba(45,212,191,0.12)'; ctx.fill();
    },
  };

  /* ════════════════ MÓDULO RTA ════════════════ */
  const RTA = {
    bands: [], disp: null, peaks: null, peakMode: 'decay',
    curves: [], curveColors: ['#2DD4BF', '#F5B04C', '#F97066', '#B794F6'],
    avgN: 8,

    el: {},
    init() {
      ['rtaRes', 'rtaWeight', 'rtaAvg', 'rtaPeak', 'rtaSaveCurve', 'rtaClearCurves', 'cvRta']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.rtaRes.addEventListener('change', () => this.rebuild());
      this.el.rtaAvg.addEventListener('change', () => { this.avgN = +this.el.rtaAvg.value; });
      this.el.rtaPeak.addEventListener('change', () => { this.peakMode = this.el.rtaPeak.value; this.peaks = null; });
      this.el.rtaSaveCurve.addEventListener('click', () => this.saveCurve());
      this.el.rtaClearCurves.addEventListener('click', () => { this.curves = []; });
      this.rebuild();
    },
    rebuild() {
      const nPerOct = +this.el.rtaRes.value;
      const fmax = Math.min(20000, AE.sampleRate / 2 * 0.92);
      this.bands = DSP.octaveBands(nPerOct, 20, fmax);
      this.disp = new Float64Array(this.bands.length);
      this.peaks = new Float64Array(this.bands.length).fill(-Infinity);
    },
    onFftChange() { this.rebuild(); },
    saveCurve() {
      if (!this.bands.length) return;
      this.curves.push({ bands: this.bands.map((b) => b.fc), lv: Float64Array.from(this.disp) });
      if (this.curves.length > 4) this.curves.shift();
    },
    tick(dtMs) {
      if (!AE.poll()) return;
      const cal = global.BA_STATE.cal;
      const wSel = this.el.rtaWeight.value;
      const binHz = AE.sampleRate / AE.fftSize;
      const wf = wSel === 'A' ? DSP.aWeightDb : wSel === 'C' ? DSP.cWeightDb : null;

      const lv = DSP.bandLevels(AE.freqDb, binHz, this.bands, cal, wf);
      /* curva de calibración del micro aplicada al centro de cada banda */
      const calFn = global.BA_STATE.micCalDb;
      if (calFn) for (let i = 0; i < lv.length; i++) lv[i] += calFn(this.bands[i].fc);
      const alpha = 1 / this.avgN;
      for (let i = 0; i < lv.length; i++) {
        const p = isFinite(lv[i]) ? Math.pow(10, lv[i] / 10) : 0;
        const prev = Math.pow(10, this.disp[i] / 10);
        this.disp[i] = DSP.dbFromPower(prev + alpha * (p - prev));
        /* peak hold */
        if (this.peakMode !== 'off' && isFinite(this.disp[i])) {
          if (this.disp[i] > this.peaks[i]) this.peaks[i] = this.disp[i];
          else if (this.peakMode === 'decay') this.peaks[i] -= (3 * dtMs) / 1000;
        }
      }
      this.draw();
    },
    draw() {
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvRta);
      const yMin = 20, yMax = 125, padL = 30, padB = 20;
      const gw = w - padL - 6, gh = h - padB - 8;
      ctx.clearRect(0, 0, w, h);

      /* rejilla */
      ctx.strokeStyle = 'rgba(140,163,160,0.14)'; ctx.fillStyle = 'rgba(140,163,160,0.55)';
      ctx.font = '10px JetBrains Mono, monospace'; ctx.lineWidth = 1;
      for (let y = 30; y <= 120; y += 10) {
        const yy = 8 + gh - ((y - yMin) / (yMax - yMin)) * gh;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + gw, yy); ctx.stroke();
        ctx.fillText(y.toFixed(0), 4, yy + 3);
      }

      const n = this.bands.length, slot = gw / n;
      /* curvas guardadas */
      for (let c = 0; c < this.curves.length; c++) {
        const cur = this.curves[c];
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const v = isFinite(cur.lv[i]) ? DSP.clamp(cur.lv[i], yMin, yMax) : yMin;
          const yy = 8 + gh - ((v - yMin) / (yMax - yMin)) * gh;
          i === 0 ? ctx.moveTo(padL + slot * (i + 0.5), yy) : ctx.lineTo(padL + slot * (i + 0.5), yy);
        }
        ctx.strokeStyle = this.curveColors[c % 4]; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* barras */
      for (let i = 0; i < n; i++) {
        const v = this.disp[i];
        if (!isFinite(v)) continue;
        const p = (v - yMin) / (yMax - yMin);
        const bh = DSP.clamp(p, 0.004, 1) * gh;
        const bw = Math.max(2, slot * 0.62);
        const x = padL + slot * i + (slot - bw) / 2;
        const y = 8 + gh - bh;
        const g = ctx.createLinearGradient(0, y, 0, 8 + gh);
        g.addColorStop(0, BAU.levelColor(p));
        g.addColorStop(1, 'rgba(45,212,191,0.25)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 2);
        ctx.fill();
        /* peak marker */
        if (this.peakMode !== 'off' && isFinite(this.peaks[i])) {
          const py = 8 + gh - ((DSP.clamp(this.peaks[i], yMin, yMax) - yMin) / (yMax - yMin)) * gh;
          ctx.fillStyle = 'rgba(230,241,238,0.8)';
          ctx.fillRect(x, py - 1, bw, 2);
        }
        /* etiquetas: en los centros de octava (paso = bandas por octava) */
        const labelStep = Math.max(1, +this.el.rtaRes.value || 3);
        if (i % labelStep === 0) {
          ctx.fillStyle = 'rgba(140,163,160,0.7)';
          const lbl = DSP.bandLabel(this.bands[i].fc);
          ctx.fillText(lbl, x + bw / 2 - ctx.measureText(lbl).width / 2, h - 6);
        }
      }
    },
  };

  /* ════════════════ MÓDULO ESPECTROGRAMA ════════════════ */
  const Spectro = {
    off: null, offCtx: null, lut: null, fmax: 24000,
    el: {},
    init() {
      ['spMap', 'spTop', 'spRange', 'spFmax', 'spTopChip', 'spRangeChip', 'cvSpectro']
        .forEach((id) => (this.el[id] = document.getElementById(id)));
      this.el.spMap.addEventListener('change', () => { this.lut = DSP.colormap(this.el.spMap.value); });
      this.el.spTop.addEventListener('input', () => { this.el.spTopChip.textContent = this.el.spTop.value; });
      this.el.spRange.addEventListener('input', () => { this.el.spRangeChip.textContent = this.el.spRange.value; });
      this.el.spFmax.addEventListener('change', () => { this.fmax = +this.el.spFmax.value; this.resetOff(); });
      this.lut = DSP.colormap('audio');

      /* crosshair de lectura (ratón / táctil) */
      const cv = this.el.cvSpectro;
      const setPos = (x, y) => { this._mx = x; this._my = y; };
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        setPos(e.clientX - r.left, e.clientY - r.top);
      });
      cv.addEventListener('mouseleave', () => { this._mx = null; });
      cv.addEventListener('touchstart', (e) => {
        const r = cv.getBoundingClientRect(), t = e.touches[0];
        setPos(t.clientX - r.left, t.clientY - r.top);
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        const r = cv.getBoundingClientRect(), t = e.touches[0];
        setPos(t.clientX - r.left, t.clientY - r.top);
      }, { passive: true });
      cv.addEventListener('touchend', () => { this._mx = null; });
    },
    resetOff() { this.off = null; },
    onFftChange() { this.resetOff(); },
    tick() {
      if (!AE.poll()) return;
      const { ctx, w, h } = BAU.fitCanvas(this.el.cvSpectro);
      const padL = 44, padR = 56;
      const plotW = w - padL - padR;

      /* canvas offscreen persistente */
      if (!this.off || this.off.width !== Math.max(1, plotW) || this.off.height !== h) {
        this.off = document.createElement('canvas');
        this.off.width = Math.max(1, plotW); this.off.height = Math.max(1, h);
        this.offCtx = this.off.getContext('2d');
        this.offCtx.fillStyle = '#000'; this.offCtx.fillRect(0, 0, this.off.width, h);
      }

      const cal = global.BA_STATE.cal;
      const calFn = global.BA_STATE.micCalDb;
      const top = +this.el.spTop.value + cal;
      const range = +this.el.spRange.value;
      const bottom = top - range;
      const binHz = AE.sampleRate / AE.fftSize;
      const nb = AE.freqDb.length;
      const H = h, W = this.off.width;
      const fmin = 20;

      /* desplazar 2 px a la izquierda y pintar columna nueva */
      const step = 2;
      this.offCtx.drawImage(this.off, -step, 0);
      this.offCtx.fillStyle = '#000';
      this.offCtx.fillRect(W - step, 0, step, H);
      const img = this.offCtx.getImageData(W - step, 0, step, H);
      const d = img.data;

      for (let y = 0; y < H; y++) {
        const frac = 1 - y / H; // abajo = graves
        const f = fmin * Math.pow(this.fmax / fmin, frac);
        const bin = f / binHz;
        const i0 = Math.min(nb - 1, Math.floor(bin));
        const t = bin - i0;
        /* dBFS → dB SPL (cal de nivel + curva de calibración del micro) */
        const v = AE.freqDb[i0] * (1 - t) + AE.freqDb[Math.min(nb - 1, i0 + 1)] * t
          + cal + calFn(f);
        let norm = (v - bottom) / range;           // 0..1
        norm = DSP.clamp(norm, 0, 1);
        const ci = Math.round(norm * 255) * 3;
        for (let s = 0; s < step; s++) {
          const o = (y * step + s) * 4;
          d[o] = this.lut[ci]; d[o + 1] = this.lut[ci + 1]; d[o + 2] = this.lut[ci + 2]; d[o + 3] = 255;
        }
      }
      this.offCtx.putImageData(img, W - step, 0);

      /* componer */
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#000'; ctx.fillRect(padL, 0, plotW, H);
      ctx.drawImage(this.off, padL, 0);

      /* eje de frecuencia log */
      ctx.fillStyle = 'rgba(140,163,160,0.75)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach((f) => {
        if (f > this.fmax) return;
        const frac = Math.log(f / fmin) / Math.log(this.fmax / fmin);
        const yy = (1 - frac) * H;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : f.toFixed(0), 6, yy + 3);
      });
      /* línea de 0 dBFS/SPL cal */
      const y0 = (1 - (top - bottom) / range) * H;
      if (y0 > 0 && y0 < H) {
        ctx.strokeStyle = 'rgba(245,176,76,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + plotW, y0); ctx.stroke();
        ctx.setLineDash([]);
      }

      /* ── barra de magnitud (escala completa de color) ── */
      const cbX = padL + plotW + 12, cbW = 9;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      for (let i = 0; i <= 8; i++) {
        const c = Math.round((1 - i / 8) * 255) * 3;
        grad.addColorStop(i / 8, 'rgb(' + this.lut[c] + ',' + this.lut[c + 1] + ',' + this.lut[c + 2] + ')');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(cbX, 0, cbW, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.strokeRect(cbX + 0.5, 0.5, cbW, H - 1);
      ctx.fillStyle = 'rgba(230,241,238,0.9)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('dB', cbX + cbW + 3, 9);
      ctx.fillText(top.toFixed(0), cbX + cbW + 3, 20);
      ctx.fillText(((top + bottom) / 2).toFixed(0), cbX + cbW + 3, H / 2 + 3);
      ctx.fillText(bottom.toFixed(0), cbX + cbW + 3, H - 2);

      /* ── crosshair de lectura frecuencia · magnitud ── */
      if (this._mx != null && this._mx > padL && this._mx < padL + plotW && this._my > 0 && this._my < H) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(this._mx, 0); ctx.lineTo(this._mx, H);
        ctx.moveTo(padL, this._my); ctx.lineTo(padL + plotW, this._my);
        ctx.stroke();
        ctx.setLineDash([]);
        const frac = 1 - this._my / H;
        const fRead = fmin * Math.pow(this.fmax / fmin, frac);
        const bin = fRead / binHz;
        const i0 = Math.min(nb - 1, Math.floor(bin));
        const t = bin - i0;
        const dbRead = AE.freqDb[i0] * (1 - t) + AE.freqDb[Math.min(nb - 1, i0 + 1)] * t + cal + calFn(fRead);
        const txt = (fRead >= 1000 ? (fRead / 1000).toFixed(2) + ' kHz' : fRead.toFixed(0) + ' Hz')
          + ' · ' + dbRead.toFixed(1) + ' dB';
        ctx.font = '11px JetBrains Mono, monospace';
        const tw = ctx.measureText(txt).width;
        let tx = this._mx + 8;
        if (tx + tw > padL + plotW - 4) tx = this._mx - tw - 8;
        const ty = Math.max(14, this._my - 8);
        ctx.fillStyle = 'rgba(6,8,12,0.85)';
        ctx.fillRect(tx - 4, ty - 12, tw + 8, 16);
        ctx.fillStyle = '#E6F1EE';
        ctx.fillText(txt, tx, ty);
      }
    },
  };

  global.MOD_SPL = SPL;
  global.MOD_RTA = RTA;
  global.MOD_SPECTRO = Spectro;
})(window);
