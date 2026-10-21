/* ═══════════════════════════════════════════════════════════════
   BernAudio Subs — Motor de física para arreglos de subwoofers
   --------------------------------------------------------------
   Modelo: suma coherente de fuentes puntuales (1/r) con delay,
   polaridad y ganancia por caja, evaluado en rejilla para:
     · Mapa SPL  : |Σ gᵢ·e^{-j(k·rᵢ+ω·τᵢ)}| / rᵢ  (1 o 6 frecuencias)
     · Polar 360°: ídem sobre círculo de radio fijo
     · Ondas     : Σ gᵢ·sen(ω·t − k·rᵢ − ω·τᵢ) / rᵢ  animado
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  const FREQS = [31, 40, 50, 63, 80, 100, 125];

  /* ---------- Estado compartido con la UI ---------- */
  const SA = {
    type: 'line',      // line | earc | farc | endfire | grad | stack
    n: 6,
    perRow: 3,
    spacing: 1.35,
    rowSep: 1.35,
    angle: 0,          // steering (earc), grados
    spread: 90,        // apertura del arco físico (farc)
    freqIdx: 3,        // índice en FREQS
    temp: 20,
    broadband: false,
    showPositions: true,
    view: 'map'
  };

  /* ---------- Derivados ---------- */
  let c = 343, lambda = 5.43;
  let subs = [];
  let view = { x0: -12, y0: -9, w: 24, h: 18 };
  let bbox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  /* ---------- Canvas ---------- */
  let canvas = null, ctx = null, dpr = 1, cw = 0, ch = 0;

  /* ---------- Rejillas precalculadas ---------- */
  let GW = 0, GH = 0, rMap = null;   // distancias por sub (mapa)
  let GW2 = 0, GH2 = 0, rWav = null; // distancias por sub (ondas)
  let mapDb = null;                  // Float32Array con dB normalizados (mapa)
  const RMIN = 0.5;

  /* ---------- Colormaps ---------- */
  function buildLut(stops) {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      lut[i * 3]     = a[1] + (b[1] - a[1]) * f;
      lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * f;
      lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * f;
    }
    return lut;
  }
  const LUT_SPL = buildLut([
    [0.00,  14, 11,  6],
    [0.16,  52, 22, 10],
    [0.34, 122, 45, 14],
    [0.52, 200, 92, 22],
    [0.66, 255,148, 50],
    [0.78, 255,196,110],
    [0.89, 255,228,170],
    [1.00, 255,246,222]
  ]);
  const LUT_POS = buildLut([
    [0.00,  16, 13,  8],
    [0.55, 140, 70, 20],
    [1.00, 255,162, 62]
  ]);
  const LUT_NEG = buildLut([
    [0.00,  10, 16, 22],
    [0.55, 132, 78, 30],
    [1.00, 245,176, 76]
  ]);

  /* ---------- Utilidades ---------- */
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const speedOfSound = t => 331.3 + 0.606 * t;

  /* ---------- Construcción del arreglo ---------- */
  function buildArray() {
    const s = [];
    const d = SA.spacing, N = SA.n;
    const push = (x, y, ms, pol, label) => s.push({
      x, y, delayMs: Math.max(0, Math.round(ms * 1000) / 1000), pol, label
    });
    switch (SA.type) {
      case 'line':
        for (let i = 0; i < N; i++) push((i - (N - 1) / 2) * d, 0, 0, 1, 'S' + (i + 1));
        break;
      case 'earc': {
        const th = SA.angle * Math.PI / 180;
        const raw = [];
        for (let i = 0; i < N; i++) raw.push(((i - (N - 1) / 2) * d * Math.sin(th)) / c * 1000);
        const mn = Math.min.apply(null, raw);
        for (let i = 0; i < N; i++) push((i - (N - 1) / 2) * d, 0, raw[i] - mn, 1, 'S' + (i + 1));
        break;
      }
      case 'farc': {
        const S = SA.spread * Math.PI / 180;
        const dphi = N > 1 ? S / (N - 1) : 0;
        const R = d / (2 * Math.sin(Math.max(dphi / 2, 1e-6)));
        for (let i = 0; i < N; i++) {
          const phi = (i - (N - 1) / 2) * dphi;
          push(R * Math.sin(phi), R * (Math.cos(phi) - 1), 0, 1, 'S' + (i + 1));
        }
        break;
      }
      case 'endfire':
        for (let i = 0; i < N; i++) push(0, -i * d, ((N - 1) - i) * d / c * 1000, 1, 'S' + (i + 1));
        break;
      case 'grad': {
        const M = SA.perRow, s2 = SA.rowSep;
        for (let i = 0; i < M; i++) push((i - (M - 1) / 2) * d,  s2 / 2, 0, 1, 'F' + (i + 1));
        for (let i = 0; i < M; i++) push((i - (M - 1) / 2) * d, -s2 / 2, s2 / c * 1000, -1, 'T' + (i + 1));
        break;
      }
      case 'stack':
        push(0,  SA.rowSep / 2, 0, 1, 'S1');
        push(0, -SA.rowSep / 2, SA.rowSep / c * 1000, -1, 'S2');
        break;
    }
    return s;
  }

  function computeBbox() {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const s of subs) {
      if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
    }
    bbox = { minX, maxX, minY, maxY };
  }

  function fitView() {
    const aw = Math.max(1, bbox.maxX - bbox.minX);
    const ah = Math.max(1, bbox.maxY - bbox.minY);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const aspect = (cw > 0 && ch > 0) ? cw / ch : 1.5;
    let w = Math.max(16, aw * 1.9 + 6);
    let h = w / aspect;
    const hNeed = ah * 1.8 + 9;
    if (h < hNeed) { h = hNeed; w = h * aspect; }
    w /= Math.max(0.4, SA.zoom || 1); h /= Math.max(0.4, SA.zoom || 1);
    view = { x0: cx - w / 2, y0: cy - h * 0.42, w, h };
  }

  /* ---------- Precálculo de distancias ---------- */
  function allocGrid(gw, gh) {
    const n = subs.length;
    const arr = new Array(n);
    for (let s = 0; s < n; s++) arr[s] = new Float32Array(gw * gh);
    for (let s = 0; s < n; s++) {
      const sx = subs[s].x, sy = subs[s].y, rA = arr[s];
      for (let iy = 0; iy < gh; iy++) {
        const wy = view.y0 + view.h - ((iy + 0.5) / gh) * view.h;
        const dy = wy - sy;
        const row = iy * gw;
        for (let ix = 0; ix < gw; ix++) {
          const wx = view.x0 + ((ix + 0.5) / gw) * view.w;
          const dx = wx - sx;
          rA[row + ix] = Math.max(RMIN, Math.sqrt(dx * dx + dy * dy));
        }
      }
    }
    return arr;
  }

  function rebuildGrids() {
    if (!canvas || subs.length === 0) return;
    GW = cw < 640 ? 120 : 176;
    GH = Math.max(60, Math.round(GW * ch / cw));
    rMap = allocGrid(GW, GH);
    GW2 = Math.round(GW * 0.62);
    GH2 = Math.round(GH * 0.62);
    rWav = allocGrid(GW2, GH2);
  }

  /* ---------- Mapa SPL ---------- */
  function computeMap() {
    if (!rMap) return;
    const freqs = SA.broadband ? FREQS.slice(1) : [FREQS[SA.freqIdx]];
    const cells = GW * GH;
    const re = new Float64Array(cells), im = new Float64Array(cells);
    for (let q = 0; q < freqs.length; q++) {
      const f = freqs[q];
      const k = 2 * Math.PI * f / c, w = 2 * Math.PI * f;
      for (let s = 0; s < subs.length; s++) {
        const sb = subs[s], rA = rMap[s];
        const phd = w * sb.delayMs / 1000;
        const g = sb.pol;
        for (let cell = 0; cell < cells; cell++) {
          const r = rA[cell];
          const ph = phd + k * r;
          const a = g / r;
          re[cell] += a * Math.cos(ph);
          im[cell] -= a * Math.sin(ph);
        }
      }
    }
    const energy = mapDb;
    if (!energy || energy.length !== cells) mapDb = new Float32Array(cells);
    let mx = 1e-12;
    const eA = mapDb;
    for (let cell = 0; cell < cells; cell++) {
      const m = Math.sqrt(re[cell] * re[cell] + im[cell] * im[cell]) / freqs.length;
      eA[cell] = m;
      if (m > mx) mx = m;
    }
    const inv = 1 / mx;
    for (let cell = 0; cell < cells; cell++) {
      const db = 20 * Math.log10(eA[cell] * inv + 1e-9);
      eA[cell] = clamp((db + 30) / 30, 0, 1);
    }
  }

  function drawMap() {
    if (!ctx || !mapDb) return;
    const img = ctx.createImageData(GW, GH);
    const px = img.data, eA = mapDb;
    for (let i = 0; i < eA.length; i++) {
      const li = (eA[i] * 255) | 0;
      const p = i * 4;
      px[p]     = LUT_SPL[li * 3];
      px[p + 1] = LUT_SPL[li * 3 + 1];
      px[p + 2] = LUT_SPL[li * 3 + 2];
      px[p + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = GW; off.height = GH;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, cw, ch);
    drawOverlay(ctx);
    drawLegend(ctx);
    drawMapInfo(ctx);
  }

  /* ---------- Polar 360° ---------- */
  function computePolar() {
    const f = FREQS[SA.freqIdx];
    const k = 2 * Math.PI * f / c, w = 2 * Math.PI * f;
    const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    const Rp = Math.max(8, diag * 1.15);
    const M = 360;
    const mag = new Float64Array(M);
    let mx = 1e-12;
    for (let i = 0; i < M; i++) {
      const th = i * Math.PI / 180;
      const px = Math.sin(th) * Rp, py = Math.cos(th) * Rp;
      let re = 0, im = 0;
      for (let s = 0; s < subs.length; s++) {
        const sb = subs[s];
        const dx = px - sb.x, dy = py - sb.y;
        const r = Math.max(RMIN, Math.sqrt(dx * dx + dy * dy));
        const ph = w * sb.delayMs / 1000 + k * r;
        const a = sb.pol / r;
        re += a * Math.cos(ph);
        im -= a * Math.sin(ph);
      }
      mag[i] = Math.sqrt(re * re + im * im);
      if (mag[i] > mx) mx = mag[i];
    }
    const norm = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const db = 20 * Math.log10(mag[i] / mx + 1e-9);
      norm[i] = clamp((db + 30) / 30, 0, 1);
    }
    return { norm, Rp, f };
  }

  function drawPolar() {
    if (!ctx) return;
    const { norm, Rp, f } = computePolar();
    const cxm = cw / 2, cym = ch / 2 + 8;
    const Rmax = Math.min(cw, ch) * 0.42;
    const toXY = (i, rad) => {
      const th = i * Math.PI / 180;
      return [cxm + Math.sin(th) * rad, cym - Math.cos(th) * rad];
    };
    // anillos
    ctx.lineWidth = 1;
    const rings = [0, -6, -12, -18, -24, -30];
    for (const db of rings) {
      const rad = (db + 30) / 30 * Rmax;
      ctx.strokeStyle = db === 0 ? 'rgba(201,191,162,.45)' : 'rgba(201,191,162,.14)';
      ctx.beginPath();
      ctx.arc(cxm, cym, Math.max(1, rad), 0, Math.PI * 2);
      ctx.stroke();
      if (db < 0 && db > -30) {
        ctx.fillStyle = 'rgba(93,107,128,.85)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(db), cxm + rad + 3, cym - 3);
      }
    }
    // ejes
    ctx.strokeStyle = 'rgba(148,163,184,.12)';
    for (let a = 0; a < 360; a += 45) {
      const [x2, y2] = toXY(a, Rmax);
      ctx.beginPath(); ctx.moveTo(cxm, cym); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // traza
    ctx.beginPath();
    for (let i = 0; i <= 360; i++) {
      const v = norm[i % 360] * Rmax;
      const [x2, y2] = toXY(i, Math.max(1, v));
      if (i === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,162,62,.16)';
    ctx.fill();
    ctx.strokeStyle = '#ffa23e';
    ctx.lineWidth = 2;
    ctx.stroke();
    // etiquetas
    ctx.fillStyle = '#efe8d6';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0° · público', cxm, cym - Rmax - 8);
    ctx.fillStyle = 'rgba(179,169,143,.9)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('90°', cxm + Rmax + 16, cym + 3);
    ctx.fillText('270°', cxm - Rmax - 18, cym + 3);
    ctx.fillText('180° · atrás', cxm, cym + Rmax + 16);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(179,169,143,.9)';
    ctx.fillText(f + ' Hz · radio ' + Rp.toFixed(1) + ' m · ' + subs.length + ' cajas', 12, ch - 12);
  }

  /* ---------- Ondas animadas ---------- */
  const waves = { t: 0, running: false, raf: 0, last: 0, maxAmp: 1e-6 };

  function frameWaves(ts) {
    if (!waves.running || !ctx || !rWav) return;
    if (!waves.last) waves.last = ts;
    const dt = Math.min(0.06, (ts - waves.last) / 1000);
    waves.last = ts;
    waves.t += dt * 0.22; // ralentizado ~4.5x para visualizar

    const f = FREQS[SA.freqIdx];
    const k = 2 * Math.PI * f / c, w = 2 * Math.PI * f;
    const cells = GW2 * GH2;
    const img = ctx.createImageData(GW2, GH2);
    const px = img.data;
    let peak = 1e-6;
    const amp = new Float32Array(cells);
    for (let s = 0; s < subs.length; s++) {
      const sb = subs[s], rA = rWav[s];
      const g = sb.pol;
      const ph0 = w * (waves.t - sb.delayMs / 1000);
      for (let cell = 0; cell < cells; cell++) {
        amp[cell] += g * Math.sin(ph0 - k * rA[cell]) / rA[cell];
      }
    }
    for (let cell = 0; cell < cells; cell++) {
      const a = Math.abs(amp[cell]);
      if (a > peak) peak = a;
    }
    waves.maxAmp = Math.max(peak, waves.maxAmp * 0.995);
    const inv = 1 / waves.maxAmp;
    for (let i = 0; i < cells; i++) {
      const v = clamp(amp[i] * inv, -1, 1);
      const t = Math.abs(v);
      const lut = v >= 0 ? LUT_POS : LUT_NEG;
      const li = (t * 255) | 0;
      const p = i * 4;
      px[p] = lut[li * 3]; px[p + 1] = lut[li * 3 + 1]; px[p + 2] = lut[li * 3 + 2]; px[p + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = GW2; off.height = GH2;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, cw, ch);
    drawOverlay(ctx);
    drawMapInfo(ctx);
    ctx.fillStyle = 'rgba(151,165,185,.85)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(f + ' Hz · tiempo ralentizado 4.5×', cw - 12, ch - 12);
    ctx.textAlign = 'left';
    waves.raf = requestAnimationFrame(frameWaves);
  }

  function startWaves() {
    stopWaves();
    waves.running = true;
    waves.last = 0;
    waves.raf = requestAnimationFrame(frameWaves);
  }
  function stopWaves() {
    waves.running = false;
    if (waves.raf) cancelAnimationFrame(waves.raf);
    waves.raf = 0;
  }

  /* ---------- Overlay común ---------- */
  function w2px(x, y) {
    return [
      (x - view.x0) / view.w * cw,
      ch - (y - view.y0) / view.h * ch
    ];
  }
  function scalePx() { return cw / view.w; }

  function roundRect(c2, x, y, w, h, r) {
    if (c2.roundRect) { c2.beginPath(); c2.roundRect(x, y, w, h, r); return; }
    c2.beginPath();
    c2.moveTo(x + r, y);
    c2.arcTo(x + w, y, x + w, y + h, r);
    c2.arcTo(x + w, y + h, x, y + h, r);
    c2.arcTo(x, y + h, x, y, r);
    c2.arcTo(x, y, x + w, y, r);
    c2.closePath();
  }

  function drawOverlay(c2) {
    if (!SA.showPositions) return;
    const sp = scalePx();
    const bw = Math.max(9, 0.62 * sp);
    // flecha del público
    const [ax, ay] = w2px((bbox.minX + bbox.maxX) / 2, view.y0 + view.h * 0.94);
    c2.strokeStyle = 'rgba(232,238,246,.55)';
    c2.fillStyle = 'rgba(232,238,246,.75)';
    c2.lineWidth = 1.6;
    c2.beginPath();
    c2.moveTo(ax, ay - 16); c2.lineTo(ax, ay + 2);
    c2.moveTo(ax - 4, ay - 11); c2.lineTo(ax, ay - 16); c2.lineTo(ax + 4, ay - 11);
    c2.stroke();
    c2.font = '600 10px Inter, sans-serif';
    c2.textAlign = 'center';
    c2.fillText('PÚBLICO', ax, ay + 14);
    // cajas
    for (const s of subs) {
      const [x, y] = w2px(s.x, s.y);
      c2.fillStyle = s.pol < 0 ? 'rgba(245,176,76,.92)' : 'rgba(14,26,34,.94)';
      c2.strokeStyle = s.pol < 0 ? '#e14b33' : '#ffa23e';
      c2.lineWidth = 1.6;
      roundRect(c2, x - bw / 2, y - bw / 2, bw, bw, 3);
      c2.fill(); c2.stroke();
      if (bw >= 12) {
        c2.fillStyle = s.pol < 0 ? '#e14b33' : '#ffe9c4';
        c2.font = '600 ' + Math.max(8, bw * 0.62) + 'px Inter, sans-serif';
        c2.textAlign = 'center';
        c2.textBaseline = 'middle';
        c2.fillText(s.label, x, y + 0.5);
        c2.textBaseline = 'alphabetic';
      }
    }
    // barra de escala
    const target = view.w / 5;
    const nice = [1, 2, 5, 10, 20, 50];
    let bar = nice[0];
    for (const nn of nice) { if (nn <= target) bar = nn; }
    const bx = 14, by = ch - 26;
    const bpx = bar * sp;
    c2.strokeStyle = 'rgba(232,238,246,.7)';
    c2.lineWidth = 2;
    c2.beginPath();
    c2.moveTo(bx, by - 4); c2.lineTo(bx, by);
    c2.lineTo(bx + bpx, by); c2.lineTo(bx + bpx, by - 4);
    c2.stroke();
    c2.fillStyle = 'rgba(232,238,246,.8)';
    c2.font = '10px Inter, sans-serif';
    c2.textAlign = 'left';
    c2.fillText(bar + ' m', bx, by - 8);
  }

  function drawLegend(c2) {
    const lw = 10, lh = Math.min(ch * 0.5, 170);
    const lx = cw - lw - 16, ly = (ch - lh) / 2;
    for (let i = 0; i < lh; i++) {
      const t = 1 - i / lh;
      const li = (t * 255) | 0;
      c2.fillStyle = 'rgb(' + LUT_SPL[li * 3] + ',' + LUT_SPL[li * 3 + 1] + ',' + LUT_SPL[li * 3 + 2] + ')';
      c2.fillRect(lx, ly + i, lw, 1.2);
    }
    c2.strokeStyle = 'rgba(148,163,184,.35)';
    c2.lineWidth = 1;
    c2.strokeRect(lx + 0.5, ly + 0.5, lw, lh);
    c2.fillStyle = 'rgba(232,238,246,.85)';
    c2.font = '9px Inter, sans-serif';
    c2.textAlign = 'right';
    const marks = [0, -10, -20, -30];
    for (const db of marks) {
      const yy = ly + (db + 30) / 30 * lh;
      c2.fillText(db + ' dB', lx - 4, yy + 3);
    }
  }

  function drawMapInfo(c2) {
    const names = {
      line: 'Línea recta', earc: 'Arco electrónico', farc: 'Arco físico',
      endfire: 'End-fired', grad: 'Gradiente 2 filas', stack: 'Stack invertido'
    };
    const f = SA.broadband
      ? '40–125 Hz (banda ancha)'
      : FREQS[SA.freqIdx] + ' Hz';
    c2.fillStyle = 'rgba(6,10,15,.62)';
    roundRect(c2, 10, 10, Math.min(240, cw - 70), 40, 8);
    c2.fill();
    c2.fillStyle = '#efe8d6';
    c2.font = '600 11px "Space Grotesk", Inter, sans-serif';
    c2.textAlign = 'left';
    c2.fillText(names[SA.type], 20, 26);
    c2.fillStyle = 'rgba(151,165,185,.95)';
    c2.font = '10px Inter, sans-serif';
    c2.fillText(f + ' · c = ' + c.toFixed(1) + ' m/s · normalizado a 0 dB', 20, 41);
  }

  /* ---------- Render despacho ---------- */
  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#05080d';
    ctx.fillRect(0, 0, cw, ch);
    if (subs.length === 0) return;
    if (SA.view === 'map') { computeMap(); drawMap(); }
    else if (SA.view === 'polar') { drawPolar(); }
    else if (SA.view === 'waves') { startWaves(); }
  }

  let computeTimer = 0;
  function recompute() {
    c = speedOfSound(SA.temp);
    lambda = c / FREQS[SA.freqIdx];
    subs = buildArray();
    computeBbox();
    fitView();
    rebuildGrids();
    waves.maxAmp = 1e-6;
    if (SA.view === 'waves') { render(); }
    else {
      clearTimeout(computeTimer);
      render();
    }
  }

  /* ---------- API ---------- */
  window.BernSubs = {
    SA,
    FREQS,
    get subs() { return subs; },
    get bbox() { return bbox; },
    get speed() { return c; },
    get lambda() { return lambda; },
    init(cv) {
      canvas = cv;
      ctx = canvas.getContext('2d');
      dpr = Math.min(2, window.devicePixelRatio || 1);
      resize();
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(function () { resize(); recompute(); });
        ro.observe(canvas.parentElement);
      }
      window.addEventListener('resize', function () { resize(); recompute(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopWaves();
        else if (SA.view === 'waves') startWaves();
      });
    },
    setView(v) {
      SA.view = v;
      if (v !== 'waves') stopWaves();
      recompute();
    },
    recompute,
    arraySize() {
      const aw = bbox.maxX - bbox.minX;
      const ah = bbox.maxY - bbox.minY;
      return Math.max(aw, ah);
    }
  };

  function resize() {
    if (!canvas || !canvas.parentElement) return;
    const r = canvas.parentElement.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    cw = Math.round(r.width);
    ch = Math.round(r.height);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
})();
