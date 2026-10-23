/* ═══════════════════════════════════════════════════════════════
   BERNAUDIO MODEL 80 — interacciones y motores canvas
   VU meters · RTA LED · espectrograma fósforo ámbar · TF trazador
   © Alicelabs LLC
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  document.documentElement.classList.add("js");
  var motionPreference = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reducedMotion = !!(motionPreference && motionPreference.matches);
  var paused = reducedMotion;
  var animationFrame = null;

  var nav = document.getElementById("nav");
  var burger = document.getElementById("navBurger");
  var navLinks = document.getElementById("navLinks");

  function closeMenu(restoreFocus) {
    if (!burger || !navLinks) return;
    navLinks.classList.remove("is-open");
    burger.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Abrir menú");
    if (restoreFocus) burger.focus();
  }
  function onScrollNav() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      var open = !navLinks.classList.contains("is-open");
      navLinks.classList.toggle("is-open", open);
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });
    navLinks.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && navLinks.classList.contains("is-open")) closeMenu(true);
    });
    document.addEventListener("click", function (event) {
      if (nav && !nav.contains(event.target)) closeMenu(false);
    });
  }

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ══════════ Canvas helpers ══════════ */
  function fitCanvas(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function makeVisibilityFlag(el) {
    var visible = true;
    if ("IntersectionObserver" in window) {
      var vio = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0.05 });
      vio.observe(el);
    }
    return function () { return visible; };
  }

  function smoothNoise(seed) {
    var t = seed * 1000;
    return function (x) {
      return (
        Math.sin(x * 0.9 + t) * 0.45 +
        Math.sin(x * 2.3 + t * 1.7) * 0.3 +
        Math.sin(x * 4.7 + t * 2.3) * 0.18 +
        Math.sin(x * 9.1 + t * 3.1) * 0.07
      );
    };
  }

  /* Fósforo ámbar (como un analizatore CRT de los 80) */
  function spectroColor(v) {
    v = Math.max(0, Math.min(1, v));
    var r, g, b;
    if (v < 0.38) {
      var k = v / 0.38;
      r = 14 + k * 130; g = 9 + k * 14; b = 6 + k * 7;
    } else if (v < 0.72) {
      var k2 = (v - 0.38) / 0.34;
      r = 144 + k2 * 111; g = 23 + k2 * 100; b = 13 + k2 * 25;
    } else {
      var k3 = (v - 0.72) / 0.28;
      r = 255; g = 123 + k3 * 115; b = 38 + k3 * 150;
    }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  /* ══════════ Simulación de nivel de audio (dinámica tipo música) ══════════ */
  function LevelSim(seed) {
    this.t = seed * 137;
    this.vu = 0.35;
    this.peak = 0.3;
  }
  LevelSim.prototype.next = function (dt) {
    this.t += dt;
    // mezcla con golpes rítmicos
    var beat = Math.max(0, Math.sin(this.t * 5.4));
    var target = Math.max(0.05, Math.min(1,
      0.42 +
      0.2 * Math.sin(this.t * 1.9 + 1) +
      0.16 * Math.sin(this.t * 4.7 + 2.4) +
      0.22 * Math.pow(beat, 3) +
      Math.random() * 0.08
    ));
    // balística VU: ataque rápido (~80 ms), liberación lenta (~650 ms)
    var tau = target > this.vu ? 0.09 : 0.55;
    this.vu += (target - this.vu) * Math.min(1, dt / tau);
    if (this.vu > this.peak) this.peak = this.vu;
    else this.peak = Math.max(this.vu, this.peak - dt * 0.12);
    return this;
  };

  /* ══════════ VU meter con aguja ══════════ */
  function drawVU(canvas, sim, dt) {
    var c = fitCanvas(canvas), ctx = c.ctx, w = c.w, h = c.h;
    var level = sim.vu;         // 0..1
    var peak = sim.peak;

    // cara crema retroiluminada
    var face = ctx.createRadialGradient(w / 2, h * 0.92, 6, w / 2, h * 0.6, h * 1.15);
    face.addColorStop(0, "#f6efd6");
    face.addColorStop(0.65, "#e9dfc0");
    face.addColorStop(1, "#d5c8a2");
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);

    // zona roja cuando el nivel pega fuerte (backlight)
    if (level > 0.78) {
      ctx.fillStyle = "rgba(225, 75, 51, " + ((level - 0.78) * 0.9).toFixed(3) + ")";
      ctx.fillRect(0, 0, w, h);
    }

    // geometría del arco
    var cx = w / 2, cy = h * 1.24;
    var r = h * 1.02;
    var aMin = -Math.PI * 0.78, aMax = -Math.PI * 0.22; // ángulos de -20dB..+3dB

    function aOf(v) { return aMin + (aMax - aMin) * Math.max(0, Math.min(1, v)); }

    // arco de escala
    ctx.strokeStyle = "rgba(40, 32, 20, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, aMin, aMax);
    ctx.stroke();

    // arco rojo (0..+3 dB → 0.80..1.0)
    ctx.strokeStyle = "rgba(200, 45, 28, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, aOf(0.8), aMax);
    ctx.stroke();

    // ticks + etiquetas dB
    var ticks = [
      { v: 0, l: "-20" }, { v: 0.14, l: "-10" }, { v: 0.27, l: "-7" },
      { v: 0.38, l: "-5" }, { v: 0.5, l: "-3" }, { v: 0.62, l: "-1" },
      { v: 0.8, l: "0" }, { v: 0.9, l: "+1" }, { v: 0.95, l: "+2" }, { v: 1, l: "+3" }
    ];
    ctx.fillStyle = "rgba(45, 36, 22, 0.9)";
    ctx.font = Math.max(8, h * 0.1) + "px Oswald, Arial Narrow, sans-serif";
    ctx.textAlign = "center";
    ticks.forEach(function (tk) {
      var a = aOf(tk.v);
      var x1 = cx + Math.cos(a) * (r - 3), y1 = cy + Math.sin(a) * (r - 3);
      var x2 = cx + Math.cos(a) * (r - 9), y2 = cy + Math.sin(a) * (r - 9);
      ctx.strokeStyle = tk.v >= 0.8 ? "rgba(200, 45, 28, 0.95)" : "rgba(40, 32, 20, 0.8)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      var lx = cx + Math.cos(a) * (r + 11), ly = cy + Math.sin(a) * (r + 11);
      if (ly < h - 2) ctx.fillText(tk.l, lx, ly);
    });

    // texto VU + marca
    ctx.fillStyle = "rgba(45, 36, 22, 0.85)";
    ctx.font = "600 " + Math.max(11, h * 0.17) + "px Oswald, Arial Narrow, sans-serif";
    ctx.fillText("VU", cx, cy - r * 0.42);
    ctx.font = Math.max(6.5, h * 0.075) + "px Oswald, Arial Narrow, sans-serif";
    ctx.fillStyle = "rgba(45, 36, 22, 0.55)";
    ctx.fillText("BERNAUDIO MODEL 80", cx, cy - r * 0.24);

    // aguja
    var na = aOf(level);
    ctx.strokeStyle = "#1a1408";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * r * 0.12, cy + Math.sin(na) * r * 0.12);
    ctx.lineTo(cx + Math.cos(na) * (r + 4), cy + Math.sin(na) * (r + 4));
    ctx.stroke();

    // marcador de pico (finísimo, rojo)
    var pa = aOf(peak);
    ctx.strokeStyle = "rgba(200, 45, 28, 0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * (r - 10), cy + Math.sin(pa) * (r - 10));
    ctx.lineTo(cx + Math.cos(pa) * (r + 2), cy + Math.sin(pa) * (r + 2));
    ctx.stroke();

    // bisel inferior
    var bez = ctx.createLinearGradient(0, h * 0.86, 0, h);
    bez.addColorStop(0, "rgba(0,0,0,0)");
    bez.addColorStop(1, "rgba(30, 22, 10, 0.55)");
    ctx.fillStyle = bez;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
  }

  /* ────────── Hero VU meters ────────── */
  var vuL = document.getElementById("vuL");
  var vuR = document.getElementById("vuR");
  var vuVisible = (vuL || vuR) ? makeVisibilityFlag(vuL || vuR) : function () { return false; };
  var simL = new LevelSim(1.7);
  var simR = new LevelSim(4.3);
  var lastVuT = 0;

  function drawHeroVU(time) {
    if (!vuL && !vuR) return;
    var dt = Math.min(0.05, (time - lastVuT) / 1000 || 0.016);
    lastVuT = time;
    if (vuL) { simL.next(dt); drawVU(vuL, simL, dt); }
    if (vuR) { simR.next(dt); drawVU(vuR, simR, dt); }
  }

  /* ══════════ CTA: osciloscopio ámbar ══════════ */
  var ctaCanvas = document.getElementById("ctaViz");
  var ctaVisible = ctaCanvas ? makeVisibilityFlag(ctaCanvas) : function () { return false; };

  function drawCTA(time) {
    if (!ctaCanvas) return;
    var c = fitCanvas(ctaCanvas), ctx = c.ctx, w = c.w, h = c.h;
    ctx.clearRect(0, 0, w, h);

    // rejilla de osciloscopio
    ctx.strokeStyle = "rgba(255, 162, 62, 0.06)";
    ctx.lineWidth = 1;
    var step = 44;
    for (var gx = step; gx < w; gx += step) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }
    for (var gy = step; gy < h; gy += step) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    // traza principal con glow
    ctx.save();
    ctx.shadowColor = "rgba(255, 162, 62, 0.8)";
    ctx.shadowBlur = 9;
    ctx.strokeStyle = "rgba(255, 178, 92, 0.85)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var x = 0; x <= w; x += 3) {
      var p = x / w;
      var y = h * 0.5 +
        Math.sin(p * 9 + time * 0.0011) * h * 0.13 * (0.6 + 0.4 * Math.sin(time * 0.0007 + p * 3)) +
        Math.sin(p * 23 + time * 0.0021) * h * 0.045 +
        Math.sin(p * 61 + time * 0.0032) * h * 0.018;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // traza secundaria tenue
    ctx.strokeStyle = "rgba(255, 138, 51, 0.3)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (var x2 = 0; x2 <= w; x2 += 4) {
      var p2 = x2 / w;
      var y2 = h * 0.5 +
        Math.sin(p2 * 6 - time * 0.0009 + 1.4) * h * 0.17 +
        Math.sin(p2 * 31 - time * 0.0016) * h * 0.03;
      if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  /* ══════════ RTA estilo analizador LED (DN60) ══════════ */
  function newBars(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push({ v: 0, peak: 0 });
    return a;
  }

  function drawLedRta(ctx, w, h, bars, time, withLabels) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0d0b07";
    ctx.fillRect(0, 0, w, h);

    var padB = withLabels ? 26 : 8;
    var padT = 10;
    var n = bars.length;
    var bw = w / n;
    var cellH = 8, cellGap = 2.5;
    var chartH = h - padB - padT;
    var rows = Math.floor(chartH / (cellH + cellGap));

    // celdas apagadas (fondo)
    for (var i = 0; i < n; i++) {
      var x = i * bw + bw * 0.18, bwi = bw * 0.64;
      for (var rc = 0; rc < rows; rc++) {
        var y = h - padB - (rc + 1) * (cellH + cellGap) + cellGap;
        ctx.fillStyle = "rgba(255, 232, 190, 0.045)";
        ctx.fillRect(x, y, bwi, cellH);
      }
    }

    // celdas encendidas + pico
    for (var j = 0; j < n; j++) {
      var tilt = 0.78 - (j / n) * 0.6;
      var wob = Math.sin(time * 0.003 + j * 1.7) * 0.13 + Math.sin(time * 0.0071 + j * 0.9) * 0.09;
      var target = Math.max(0.06, Math.min(0.97, tilt + wob));
      var bar = bars[j];
      bar.v += (target - bar.v) * 0.2;
      if (bar.v > bar.peak) bar.peak = bar.v; else bar.peak = Math.max(bar.v, bar.peak - 0.005);

      var litRows = Math.round(bar.v * rows);
      var peakRow = Math.round(bar.peak * rows);
      var xj = j * bw + bw * 0.18, bwj = bw * 0.64;
      for (var rr = 0; rr < litRows; rr++) {
        var frac = rr / rows;
        var col = frac < 0.55 ? "#4fbf6a" : frac < 0.82 ? "#ffa23e" : "#e14b33";
        ctx.fillStyle = col;
        var yy = h - padB - (rr + 1) * (cellH + cellGap) + cellGap;
        ctx.fillRect(xj, yy, bwj, cellH);
      }
      // celda de pico retenido
      if (peakRow > litRows || true) {
        var py = h - padB - peakRow * (cellH + cellGap) - cellGap * 0.4;
        if (py > padT - 4) {
          ctx.fillStyle = "#ffe9c4";
          ctx.fillRect(xj, py, bwj, 3);
        }
      }
    }

    if (withLabels) {
      ctx.fillStyle = "rgba(255, 162, 62, 0.6)";
      ctx.font = "13px 'VT323', monospace";
      ctx.textAlign = "center";
      var labels = ["31.5", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
      labels.forEach(function (lb, i) {
        var lx = (i / (labels.length - 1)) * (w - 30) + 15;
        ctx.fillText(lb, lx, h - 8);
      });
      ctx.textAlign = "left";
    }
  }

  /* ══════════ TF tipo trazador sobre papel milimetrado ══════════ */
  function drawTfGraph(ctx, w, h, time, scale) {
    ctx.fillStyle = "#0d0b07";
    ctx.fillRect(0, 0, w, h);

    var padL = 44 * scale, padR = 14, padT = 14, padB = 26;
    var gw = w - padL - padR, gh = h - padT - padB;
    var midY = padT + gh / 2;

    // papel milimetrado cálido
    ctx.strokeStyle = "rgba(255, 200, 130, 0.07)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= gw; gx += gw / 24) {
      ctx.beginPath(); ctx.moveTo(padL + gx, padT); ctx.lineTo(padL + gx, h - padB); ctx.stroke();
    }
    for (var gy = 0; gy <= gh; gy += gh / 10) {
      ctx.beginPath(); ctx.moveTo(padL, padT + gy); ctx.lineTo(w - padR, padT + gy); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 200, 130, 0.16)";
    [-12, -6, 0, 6, 12].forEach(function (db) {
      var y = midY - (db / 12) * (gh * 0.38);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    });

    ctx.fillStyle = "rgba(201, 191, 162, 0.6)";
    ctx.font = (10 * scale) + "px 'VT323', monospace";
    ["63", "250", "1k", "4k", "16k"].forEach(function (lb, i) {
      var x = padL + (i / 4) * gw;
      ctx.fillText(lb, x - 6, h - 8);
    });
    ["+12", "0", "-12"].forEach(function (lb, i) {
      var y = midY - (1 - i) * (gh * 0.38);
      ctx.fillText(lb, 12 * scale, y + 3);
    });

    var n = 96, mag = [], ph = [], coh = [];
    var n1 = smoothNoise(0.13), n2 = smoothNoise(0.41);
    for (var i = 0; i < n; i++) {
      var fx = i / n;
      var roll = -0.5 * Math.max(0, fx - 0.72) * 4;
      var low = 0.5 * Math.max(0, 0.14 - fx) * 3;
      var dip = -0.9 * Math.exp(-Math.pow((fx - 0.46) * 22, 2));
      var dip2 = -0.6 * Math.exp(-Math.pow((fx - 0.18) * 30, 2));
      var wig = n1(fx * 9 + time * 0.0004) * 0.22;
      mag.push(roll + low + dip + dip2 + wig);
      ph.push(n2(fx * 7 + time * 0.0003) * 2.4 * (1 - fx * 0.4));
      var cdip = 0.96 - Math.exp(-Math.pow((fx - 0.46) * 18, 2)) * 0.75 - Math.random() * 0.05;
      coh.push(Math.max(0.15, cdip));
    }

    function yOf(db) { return midY - (db / 12) * (gh * 0.38); }

    // magnitud: traza crema (como tinta del trazador)
    ctx.beginPath();
    for (var m = 0; m < n; m++) {
      var x = padL + (m / (n - 1)) * gw;
      var y = yOf(mag[m] * 12 * 0.85);
      if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#f2e8cc";
    ctx.lineWidth = 2;
    ctx.stroke();

    // fase: ámbar
    ctx.beginPath();
    for (var p = 0; p < n; p++) {
      var x2 = padL + (p / (n - 1)) * gw;
      var y2 = midY + (ph[p] / 2.6) * (gh * 0.34);
      if (p === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = "rgba(255, 162, 62, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // coherencia: LEDs inferiores
    for (var cI = 0; cI < n; cI += 2) {
      var x3 = padL + (cI / (n - 1)) * gw;
      var good = coh[cI] > 0.7;
      ctx.fillStyle = good ? "rgba(255, 162, 62, 0.85)" : "rgba(225, 75, 51, 0.9)";
      ctx.fillRect(x3, h - padB - (good ? 10 : 6), 2, 4);
    }

    ctx.font = (10 * scale) + "px 'VT323', monospace";
    var legend = [
      { t: "Magnitud", c: "rgba(242, 232, 204, 1)" },
      { t: "Fase", c: "rgba(255, 162, 62, 1)" },
      { t: "Coherencia", c: "rgba(255, 138, 51, 0.9)" }
    ];
    legend.forEach(function (lg, i) {
      var lx = w - padR - 96 * scale, ly = padT + 10 + i * 13;
      ctx.fillStyle = lg.c;
      ctx.fillRect(lx, ly - 4, 8, 3);
      ctx.fillStyle = "rgba(232, 223, 197, 0.8)";
      ctx.fillText(lg.t, lx + 13, ly);
    });
  }

  /* ══════════ Espectrograma (colas compartidas) ══════════ */
  function makeSpecBuffer(w, h) {
    var cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(w));
    cv.height = Math.max(2, Math.round(h));
    var cx = cv.getContext("2d");
    cx.fillStyle = "#0d0b07";
    cx.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }

  function stepSpec(spec, bins, time, w, h, colW, feedA, feedB) {
    var s = spec.getContext("2d");
    s.drawImage(spec, -colW, 0);
    for (var b = 0; b < bins; b++) {
      var fy = b / bins;
      var inten =
        feedA * Math.exp(-Math.pow((fy - 0.28) * 4.6, 2)) +
        feedB * Math.exp(-Math.pow((fy - 0.64) * 10, 2)) * (0.5 + 0.5 * Math.sin(time * 0.0035 + b * 0.2)) +
        0.16 * Math.sin(fy * 55 + time * 0.004) * Math.random();
      if (Math.sin(time * 0.001) > 0.82 && Math.abs(fy - 0.55) < 0.015) inten = 0.99;
      if (Math.sin(time * 0.0007 + 2) > 0.9 && Math.abs(fy - 0.33) < 0.01) inten = 0.95;
      inten = Math.max(0, Math.min(1, inten + Math.random() * 0.05));
      s.fillStyle = spectroColor(inten);
      var yy = spec.height - ((b + 1) / bins) * spec.height;
      s.fillRect(spec.width - colW, yy, colW, spec.height / bins + 1);
    }
  }

  /* ══════════ Motor de la ventana consola (hero) ══════════ */
  var appCanvas = document.getElementById("demoCanvas");
  var appVisible = appCanvas ? makeVisibilityFlag(appCanvas) : function () { return false; };
  var appMode = "rta";
  var appState = null;

  function drawApp(time) {
    if (!appCanvas) return;
    var c = fitCanvas(appCanvas), ctx = c.ctx, w = c.w, h = c.h;
    if (appMode === "spec") {
      if (!appState || appState.w !== w || appState.h !== h) {
        appState = { w: w, h: h, spec: makeSpecBuffer(w, h) };
      }
      stepSpec(appState.spec, 64, time, w, h, 3, 0.5, 0.3);
      ctx.drawImage(appState.spec, 0, 0, w, h);
      return;
    }
    if (!appState || appState.w !== w || appState.h !== h) {
      appState = { w: w, h: h, bars: newBars(31) };
    }
    if (appMode === "rta") {
      drawLedRta(ctx, w, h, appState.bars, time, false);
    } else {
      drawTfGraph(ctx, w, h, time, 0.8);
    }
  }

  /* ══════════ Motor de la demo grande ══════════ */
  var bigCanvas = document.getElementById("bigCanvas");
  var bigVisible = bigCanvas ? makeVisibilityFlag(bigCanvas) : function () { return false; };
  var bigMode = "rta";
  var bigCaption = document.getElementById("demoCaption");
  var bigState = null;
  var captions = {
    rta: "Ejemplo sintético: energía por bandas de 1/3 de octava y picos retenidos. No es una medición.",
    spec: "Ejemplo sintético: la frecuencia se representa de abajo hacia arriba y el tiempo avanza a la derecha. No es una medición.",
    tf: "Ejemplo sintético: magnitud en crema, fase en ámbar y coherencia en la franja inferior. No es una medición."
  };
  var canvasLabels = {
    rta: "Espectro de ejemplo por bandas con datos sintéticos",
    spec: "Espectrograma de ejemplo con datos sintéticos",
    tf: "Función de transferencia de ejemplo con datos sintéticos"
  };

  function drawBig(time) {
    if (!bigCanvas) return;
    var c = fitCanvas(bigCanvas), ctx = c.ctx, w = c.w, h = c.h;
    if (bigMode === "spec") {
      if (!bigState || bigState.w !== w || bigState.h !== h) {
        bigState = { w: w, h: h, spec: makeSpecBuffer(w, h) };
      }
      stepSpec(bigState.spec, 96, time, w, h, 3, 0.46, 0.28);
      ctx.drawImage(bigState.spec, 0, 0, w, h);
      return;
    }
    if (!bigState || bigState.w !== w || bigState.h !== h) {
      bigState = { w: w, h: h, bars: newBars(31) };
    }
    if (bigMode === "rta") {
      drawLedRta(ctx, w, h, bigState.bars, time, true);
    } else {
      drawTfGraph(ctx, w, h, time, 1);
    }
  }

  /* Each tab group uses one reusable panel and supports the standard keyboard keys. */
  function connectTabs(selector, attribute, panelId, onSelect) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(selector));
    var panel = document.getElementById(panelId);
    function select(tab, focus) {
      tabs.forEach(function (item) {
        var active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      if (panel) panel.setAttribute("aria-labelledby", tab.id);
      onSelect(tab.getAttribute(attribute));
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (event) {
        var next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(tabs[next], true);
      });
    });
  }

  connectTabs(".app-tab", "data-mode", "heroPanel", function (mode) {
    appMode = mode;
    appState = null;
    if (appCanvas) appCanvas.setAttribute("aria-label", canvasLabels[mode]);
    drawApp(performance.now());
  });
  connectTabs(".demo-tab", "data-demo", "demoPanel", function (mode) {
    bigMode = mode;
    bigState = null;
    if (bigCaption) bigCaption.textContent = captions[mode];
    if (bigCanvas) bigCanvas.setAttribute("aria-label", canvasLabels[mode]);
    drawBig(performance.now());
  });

  var readF = document.getElementById("readoutF");
  var readL = document.getElementById("readoutL");
  var freqs = [63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];
  var lastReadout = 0;
  function updateReadout(time) {
    if (!appVisible() || time - lastReadout < 600) return;
    lastReadout = time;
    var f = freqs[(Math.random() * freqs.length) | 0];
    if (readF) readF.textContent = f >= 1000 ? (f / 1000).toFixed(1) + " kHz" : f + " Hz";
    if (readL) readL.textContent = (-(18 + Math.random() * 18)).toFixed(1) + " dB / SIM";
  }

  var hasCanvas = !!(appCanvas || bigCanvas || vuL || vuR || ctaCanvas);
  function drawFrame(time, force) {
    if (force || vuVisible()) drawHeroVU(time);
    if (force || ctaVisible()) drawCTA(time);
    if (force || appVisible()) drawApp(time);
    if (force || bigVisible()) drawBig(time);
    updateReadout(time);
  }
  function loop(time) {
    animationFrame = null;
    if (paused || document.hidden || !hasCanvas) return;
    drawFrame(time, false);
    animationFrame = requestAnimationFrame(loop);
  }
  function startAnimation() {
    if (!paused && !document.hidden && hasCanvas && animationFrame === null) {
      animationFrame = requestAnimationFrame(loop);
    }
  }
  var motionButton = document.getElementById("demoMotion");
  function updateMotionButton() {
    document.body.classList.toggle("is-paused", paused);
    if (!motionButton) return;
    motionButton.textContent = paused ? "Reanudar animación" : "Pausar animación";
    motionButton.setAttribute("aria-pressed", String(paused));
  }
  function setPaused(value) {
    paused = value;
    if (paused && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    updateMotionButton();
    startAnimation();
  }
  if (motionButton) motionButton.addEventListener("click", function () { setPaused(!paused); });
  if (motionPreference && motionPreference.addEventListener) {
    motionPreference.addEventListener("change", function (event) {
      reducedMotion = event.matches;
      setPaused(reducedMotion);
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    startAnimation();
  });
  updateMotionButton();
  if (hasCanvas) drawFrame(16, true);
  startAnimation();

  var resizeTimer;
  window.addEventListener("resize", function () {
    if (window.innerWidth > 980) closeMenu(false);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      appState = null;
      bigState = null;
      if (hasCanvas) drawFrame(performance.now(), true);
    }, 180);
  });
})();
