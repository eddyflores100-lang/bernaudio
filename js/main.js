/* ═══════════════════════════════════════════
   BernAudio — landing interactions & canvas engines
   ═══════════════════════════════════════════ */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ────────── Nav ────────── */
  var nav = document.getElementById("nav");
  var burger = document.getElementById("navBurger");
  var navLinks = document.getElementById("navLinks");

  function onScrollNav() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      var open = navLinks.classList.toggle("is-open");
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    navLinks.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        navLinks.classList.remove("is-open");
        burger.classList.remove("is-open");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ────────── Reveal on scroll (robusto) ──────────
     El contenido NUNCA puede quedar invisible:
     1) CSS solo oculta .reveal si <html> tiene clase "js".
     2) Sin IntersectionObserver o con movimiento reducido → todo visible.
     3) Si el observer está roto/bloqueado (0 revelados en 3 s) → todo visible.
     4) Cualquier error → todo visible. */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  function revealAll() {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }
  try {
    if ("IntersectionObserver" in window && !reducedMotion) {
      var revealedCount = 0;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
            revealedCount++;
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealEls.forEach(function (el) { io.observe(el); });
      setTimeout(function () {
        if (revealedCount === 0) revealAll(); /* IO bloqueado → mostrar todo */
      }, 3000);
    } else {
      revealAll();
    }
  } catch (e) {
    revealAll();
  }

  /* ────────── Precio: toggle perpetua/suscripción ────────── */
  var ptBtns = document.querySelectorAll(".pt-btn");
  ptBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var plan = btn.getAttribute("data-plan");
      ptBtns.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      document.querySelectorAll(".price-card .amount[data-perp]").forEach(function (el) {
        el.textContent = plan === "sub" ? el.getAttribute("data-sub") : el.getAttribute("data-perp");
      });
      document.querySelectorAll(".price-card .per").forEach(function (el) {
        var v = plan === "sub" ? el.getAttribute("data-sub") : el.getAttribute("data-perp");
        if (v) el.textContent = v;
      });
    });
  });

  /* ────────── Año footer ────────── */
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

  /* Color ramp for spectrogram: dark → teal → amber */
  function spectroColor(v) {
    v = Math.max(0, Math.min(1, v));
    var r, g, b;
    if (v < 0.45) {
      var k = v / 0.45;
      r = 10 + k * 8; g = 16 + k * 110; b = 23 + k * 96;
    } else if (v < 0.8) {
      var k2 = (v - 0.45) / 0.35;
      r = 18 + k2 * 227; g = 126 + k2 * 50; b = 119 - k2 * 43;
    } else {
      var k3 = (v - 0.8) / 0.2;
      r = 245; g = 176 + k3 * 60; b = 76 + k3 * 120;
    }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  /* ══════════ 1) Hero background spectrum ══════════ */
  var heroCanvas = document.getElementById("heroViz");
  var heroVisible = heroCanvas ? makeVisibilityFlag(heroCanvas) : function () { return false; };
  var heroBars = [];
  (function initHeroBars() {
    for (var i = 0; i < 64; i++) heroBars.push(Math.random());
  })();

  function drawHero(time) {
    if (!heroCanvas) return;
    var c = fitCanvas(heroCanvas), ctx = c.ctx, w = c.w, h = c.h;
    ctx.clearRect(0, 0, w, h);
    var n = heroBars.length;
    var bw = w / n;
    var grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "rgba(45,212,191,0.85)");
    grad.addColorStop(0.55, "rgba(45,212,191,0.28)");
    grad.addColorStop(1, "rgba(45,212,191,0.02)");
    ctx.fillStyle = grad;
    for (var i = 0; i < n; i++) {
      var phase = time * 0.0011 + i * 0.55;
      var env =
        0.32 +
        0.24 * Math.sin(phase) +
        0.18 * Math.sin(phase * 2.7 + 1.3) +
        0.12 * Math.sin(phase * 5.1 + 0.6);
      env = Math.max(0.05, Math.min(1, env));
      heroBars[i] += (env - heroBars[i]) * 0.08;
      var bh = heroBars[i] * h * 0.92;
      ctx.fillRect(i * bw + bw * 0.18, h - bh, bw * 0.64, bh);
    }
  }

  /* ══════════ 2) CTA waveform ══════════ */
  var ctaCanvas = document.getElementById("ctaViz");
  var ctaVisible = ctaCanvas ? makeVisibilityFlag(ctaCanvas) : function () { return false; };

  function drawCTA(time) {
    if (!ctaCanvas) return;
    var c = fitCanvas(ctaCanvas), ctx = c.ctx, w = c.w, h = c.h;
    ctx.clearRect(0, 0, w, h);
    var waves = [
      { color: "rgba(45,212,191,0.5)", amp: h * 0.10, freq: 0.012, speed: 0.0009, y: 0.32 },
      { color: "rgba(245,176,76,0.35)", amp: h * 0.08, freq: 0.02, speed: -0.0013, y: 0.68 },
      { color: "rgba(94,234,212,0.22)", amp: h * 0.14, freq: 0.007, speed: 0.0006, y: 0.5 }
    ];
    waves.forEach(function (wv) {
      ctx.beginPath();
      for (var x = 0; x <= w; x += 4) {
        var y = h * wv.y +
          Math.sin(x * wv.freq + time * wv.speed) * wv.amp +
          Math.sin(x * wv.freq * 2.6 + time * wv.speed * 1.8) * wv.amp * 0.35;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
  }

  /* ══════════ 3) App-window mini engine ══════════ */
  var appCanvas = document.getElementById("demoCanvas");
  var appVisible = appCanvas ? makeVisibilityFlag(appCanvas) : function () { return false; };
  var appMode = "rta";
  var appState = null;

  function newBars(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push({ v: 0, peak: 0 });
    return a;
  }

  function drawApp(time) {
    if (!appCanvas) return;
    var c = fitCanvas(appCanvas), ctx = c.ctx, w = c.w, h = c.h;
    if (!appState || appState.w !== w || appState.h !== h) {
      appState = {
        w: w, h: h,
        bars: newBars(31),
        spec: null
      };
    }
    ctx.clearRect(0, 0, w, h);

    if (appMode === "rta") {
      var n = appState.bars.length, bw = w / n;
      for (var i = 0; i < n; i++) {
        var tilt = 0.78 - (i / n) * 0.62;
        var wob = Math.sin(time * 0.003 + i * 1.7) * 0.14 + Math.sin(time * 0.0071 + i * 0.9) * 0.1;
        var target = Math.max(0.06, Math.min(0.97, tilt + wob));
        var bar = appState.bars[i];
        bar.v += (target - bar.v) * 0.22;
        if (bar.v > bar.peak) bar.peak = bar.v; else bar.peak = Math.max(bar.v, bar.peak - 0.006);
        var bh = bar.v * (h - 8);
        var x = i * bw + bw * 0.16, bwi = bw * 0.68;
        var grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, "rgba(20,184,166,0.95)");
        grad.addColorStop(1, "rgba(94,234,212,0.85)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, h - bh, bwi, bh);
        ctx.fillStyle = "rgba(245,176,76,0.9)";
        var py = h - bar.peak * (h - 8) - 2;
        ctx.fillRect(x, py, bwi, 2);
      }
    } else if (appMode === "spec") {
      var bins = 64;
      if (!appState.spec) {
        appState.spec = document.createElement("canvas");
        appState.spec.width = Math.max(2, Math.round(w));
        appState.spec.height = Math.max(2, Math.round(h));
        var sctx = appState.spec.getContext("2d");
        sctx.fillStyle = "#0a1017";
        sctx.fillRect(0, 0, appState.spec.width, appState.spec.height);
      }
      var s = appState.spec.getContext("2d");
      var colW = 3;
      s.drawImage(appState.spec, -colW, 0);
      for (var b = 0; b < bins; b++) {
        var fy = b / bins;
        var inten =
          0.55 * Math.exp(-Math.pow((fy - 0.3) * 5, 2)) +
          0.30 * Math.exp(-Math.pow((fy - 0.72) * 12, 2)) * (0.5 + 0.5 * Math.sin(time * 0.004)) +
          0.22 * Math.sin(fy * 40 + time * 0.005) * Math.random();
        if (Math.sin(time * 0.0012) > 0.86 && Math.abs(fy - 0.62) < 0.02) inten = 0.98;
        inten = Math.max(0, Math.min(1, inten + Math.random() * 0.06));
        s.fillStyle = spectroColor(inten);
        var yy = appState.spec.height - ((b + 1) / bins) * appState.spec.height;
        s.fillRect(appState.spec.width - colW, yy, colW, appState.spec.height / bins + 1);
      }
      ctx.drawImage(appState.spec, 0, 0, w, h);
    } else {
      drawTfGraph(ctx, w, h, time, 0.8);
    }
  }

  /* TF graph shared by app window & big demo */
  function drawTfGraph(ctx, w, h, time, scale) {
    var padL = 44 * scale, padR = 14, padT = 14, padB = 26;
    var gw = w - padL - padR, gh = h - padT - padB;
    var midY = padT + gh / 2;

    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;
    var rows = [-12, -6, 0, 6, 12];
    rows.forEach(function (db) {
      var y = midY - (db / 12) * (gh * 0.38);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    });
    ctx.fillStyle = "rgba(148,163,184,0.45)";
    ctx.font = (9 * scale) + "px Inter, sans-serif";
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

    ctx.beginPath();
    for (var m = 0; m < n; m++) {
      var x = padL + (m / (n - 1)) * gw;
      var y = yOf(mag[m] * 12 * 0.85);
      if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(45,212,191,1)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    for (var p = 0; p < n; p++) {
      var x2 = padL + (p / (n - 1)) * gw;
      var y2 = midY + (ph[p] / 2.6) * (gh * 0.34);
      if (p === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = "rgba(245,176,76,0.75)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    for (var cI = 0; cI < n; cI += 2) {
      var x3 = padL + (cI / (n - 1)) * gw;
      var good = coh[cI] > 0.7;
      ctx.fillStyle = good ? "rgba(148,163,184,0.7)" : "rgba(248,113,113,0.8)";
      ctx.fillRect(x3, h - padB - (good ? 10 : 6), 2, 4);
    }

    ctx.font = (9.5 * scale) + "px Inter, sans-serif";
    var legend = [
      { t: "Magnitud", c: "rgba(45,212,191,1)" },
      { t: "Fase", c: "rgba(245,176,76,0.85)" },
      { t: "Coherencia", c: "rgba(148,163,184,0.8)" }
    ];
    legend.forEach(function (lg, i) {
      var lx = w - padR - 96 * scale, ly = padT + 10 + i * 13;
      ctx.fillStyle = lg.c;
      ctx.fillRect(lx, ly - 4, 8, 3);
      ctx.fillStyle = "rgba(232,238,246,0.75)";
      ctx.fillText(lg.t, lx + 13, ly);
    });
  }

  /* ══════════ 4) Big demo engine ══════════ */
  var bigCanvas = document.getElementById("bigCanvas");
  var bigVisible = bigCanvas ? makeVisibilityFlag(bigCanvas) : function () { return false; };
  var bigMode = "rta";
  var bigCaption = document.getElementById("demoCaption");
  var bigState = null;
  var captions = {
    rta: "Barras de 1/3 de octava con picos de retención (ámbar) — así se ve una mezcla con ruido rosa de referencia.",
    spec: "Frecuencia (vertical) vs. tiempo (horizontal). Las líneas verticales brillantes son feedback: identifícalas y elimínalas en segundos.",
    tf: "Magnitud (teal), fase (ámbar) y coherencia (gris). Coherencia alta = medición confiable; los huecos rojos indican ruido de fondo."
  };

  document.querySelectorAll(".demo-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".demo-tab").forEach(function (t) {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      bigMode = tab.getAttribute("data-demo");
      if (bigMode === "spec") bigState = null;
      if (bigCaption) bigCaption.textContent = captions[bigMode];
    });
  });

  function drawBig(time) {
    if (!bigCanvas) return;
    var c = fitCanvas(bigCanvas), ctx = c.ctx, w = c.w, h = c.h;
    if (bigMode !== "spec" && (!bigState || bigState.w !== w || bigState.h !== h)) {
      bigState = { w: w, h: h, bars: newBars(31) };
    }
    if (bigMode === "spec") {
      if (!bigState || bigState.w !== w || bigState.h !== h) {
        bigState = {
          w: w, h: h,
          spec: (function () {
            var cv = document.createElement("canvas");
            cv.width = Math.max(2, Math.round(w));
            cv.height = Math.max(2, Math.round(h));
            var cx = cv.getContext("2d");
            cx.fillStyle = "#0a1017";
            cx.fillRect(0, 0, cv.width, cv.height);
            return cv;
          })()
        };
      }
      var s = bigState.spec.getContext("2d");
      var colW = 3;
      s.drawImage(bigState.spec, -colW, 0);
      var bins = 96;
      for (var b = 0; b < bins; b++) {
        var fy = b / bins;
        var inten =
          0.5 * Math.exp(-Math.pow((fy - 0.25) * 4.5, 2)) +
          0.28 * Math.exp(-Math.pow((fy - 0.6) * 9, 2)) * (0.5 + 0.5 * Math.sin(time * 0.0035 + b * 0.2)) +
          0.18 * Math.sin(fy * 60 + time * 0.004) * Math.random();
        if (Math.sin(time * 0.001) > 0.82 && Math.abs(fy - 0.55) < 0.015) inten = 0.99;
        if (Math.sin(time * 0.0007 + 2) > 0.9 && Math.abs(fy - 0.33) < 0.01) inten = 0.95;
        inten = Math.max(0, Math.min(1, inten + Math.random() * 0.05));
        s.fillStyle = spectroColor(inten);
        var yy = bigState.spec.height - ((b + 1) / bins) * bigState.spec.height;
        s.fillRect(bigState.spec.width - colW, yy, colW, bigState.spec.height / bins + 1);
      }
      ctx.drawImage(bigState.spec, 0, 0, w, h);
    } else if (bigMode === "rta") {
      ctx.clearRect(0, 0, w, h);
      var nb = 31, bw2 = w / nb;
      for (var i = 0; i < nb; i++) {
        var tilt = 0.8 - (i / nb) * 0.6;
        var wob = Math.sin(time * 0.0028 + i * 1.5) * 0.15 + Math.sin(time * 0.0066 + i * 0.8) * 0.1;
        var target = Math.max(0.07, Math.min(0.96, tilt + wob));
        var bar = bigState.bars[i];
        bar.v += (target - bar.v) * 0.2;
        if (bar.v > bar.peak) bar.peak = bar.v; else bar.peak = Math.max(bar.v, bar.peak - 0.005);
        var bh = bar.v * (h - 40);
        var x = i * bw2 + bw2 * 0.15, bwi = bw2 * 0.7;
        var grad = ctx.createLinearGradient(0, h - 24, 0, h - 24 - bh);
        grad.addColorStop(0, "rgba(20,184,166,0.95)");
        grad.addColorStop(1, "rgba(94,234,212,0.9)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, h - 24 - bh, bwi, bh);
        ctx.fillStyle = "rgba(245,176,76,0.92)";
        ctx.fillRect(x, h - 24 - bar.peak * (h - 40) - 3, bwi, 2.5);
      }
      ctx.fillStyle = "rgba(148,163,184,0.5)";
      ctx.font = "10px Inter, sans-serif";
      var labels = ["31.5", "63", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
      labels.forEach(function (lb, i) {
        var x = (i / (labels.length - 1)) * (w - 30) + 15;
        ctx.fillText(lb, x - 8, h - 8);
      });
    } else {
      ctx.clearRect(0, 0, w, h);
      drawTfGraph(ctx, w, h, time, 1);
    }
  }

  /* ══════════ App window tabs ══════════ */
  document.querySelectorAll(".app-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".app-tab").forEach(function (t) {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      appMode = tab.getAttribute("data-mode");
      if (appMode === "spec") appState = null;
    });
  });

  /* Status bar readouts */
  var readF = document.getElementById("readoutF");
  var readL = document.getElementById("readoutL");
  var readC = document.getElementById("readoutC");
  var freqs = [63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000];
  setInterval(function () {
    if (!appVisible() || document.hidden) return;
    var f = freqs[(Math.random() * freqs.length) | 0];
    if (readF) readF.textContent = f >= 1000 ? (f / 1000).toFixed(1) + " kHz" : f + " Hz";
    if (readL) readL.textContent = (72 + Math.random() * 14).toFixed(1) + " dB SPL";
    if (readC) readC.textContent = "ρ " + (0.88 + Math.random() * 0.11).toFixed(2);
  }, 420);

  /* ══════════ Main loop ══════════ */
  function loop(time) {
    if (!document.hidden && !reducedMotion) {
      if (heroVisible()) drawHero(time);
      if (ctaVisible()) drawCTA(time);
      if (appVisible()) drawApp(time);
      if (bigVisible()) drawBig(time);
    }
    requestAnimationFrame(loop);
  }
  if (reducedMotion) {
    drawHero(0);
    drawCTA(0);
    drawApp(0);
    drawBig(0);
  } else {
    requestAnimationFrame(loop);
  }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      appState = null;
      bigState = null;
      if (reducedMotion) {
        drawHero(0); drawCTA(0); drawApp(0); drawBig(0);
      }
    }, 180);
  });
})();
