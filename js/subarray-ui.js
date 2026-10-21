/* ═══════════════════════════════════════════════════════════════
   BernAudio Subs — Cableado de UI del diseñador de arreglos
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const BS = window.BernSubs;
  if (!BS) return;
  const SA = BS.SA;

  const el = {
    canvas: $('saCanvas'),
    loading: $('stageLoading'),
    hint: $('wbHint'),
    roC: $('roC'), roLambda: $('roLambda'), roSize: $('roSize'), roSubs: $('roSubs'),
    table: $('delayTable').querySelector('tbody'),
    outN: $('outN'), outPerRow: $('outPerRow'), outSpacing: $('outSpacing'),
    outRowSep: $('outRowSep'), outAngle: $('outAngle'), outSpread: $('outSpread'),
    outFreq: $('outFreq'), outTemp: $('outTemp')
  };

  /* ---------- Utilidades ---------- */
  const fmt = (v, n) => v.toFixed(n == null ? 2 : n);
  const deg = v => String(Math.round(v)) + '\u00B0';

  /* ---------- Nav (copia ligera de main.js) ---------- */
  (function initNav() {
    const nav = $('nav'), burger = $('navBurger'), links = $('navLinks');
    if (nav) {
      const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 12);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    if (burger && links) {
      burger.addEventListener('click', () => {
        const open = links.classList.toggle('is-open');
        burger.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      links.addEventListener('click', e => {
        if (e.target.tagName === 'A') {
          links.classList.remove('is-open');
          burger.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
    }
    const year = $('year');
    if (year) year.textContent = String(new Date().getFullYear());
  })();

  /* ---------- Recalculo con indicador ---------- */
  let pend = 0;
  function recompute(withLoading) {
    clearTimeout(pend);
    if (withLoading) {
      el.loading.hidden = false;
      pend = setTimeout(() => {
        BS.recompute();
        el.loading.hidden = true;
        refreshOutputs();
      }, 40);
    } else {
      BS.recompute();
      refreshOutputs();
    }
  }

  function refreshOutputs() {
    const f = BS.FREQS[SA.freqIdx];
    const lam = BS.lambda;
    el.roC.textContent = 'c = ' + fmt(BS.speed, 1) + ' m/s';
    el.roLambda.textContent = '\u03BB @ ' + f + ' Hz = ' + fmt(lam) + ' m';
    el.roSize.textContent = 'arreglo = ' + fmt(BS.arraySize()) + ' m';
    el.roSubs.textContent = BS.subs.length + ' cajas';
    updateTable();
    updateHint(f, lam);
  }

  /* ---------- Tabla de delays ---------- */
  function updateTable() {
    const rows = [];
    for (const s of BS.subs) {
      const ms48 = Math.round(s.delayMs / 1000 * 48000);
      const ms96 = Math.round(s.delayMs / 1000 * 96000);
      rows.push(
        '<tr>' +
        '<td><strong>' + s.label + '</strong></td>' +
        '<td>' + fmt(s.x) + '</td>' +
        '<td>' + fmt(s.y) + '</td>' +
        '<td>' + fmt(s.delayMs) + '</td>' +
        '<td>' + ms48 + '</td>' +
        '<td>' + ms96 + '</td>' +
        '<td class="' + (s.pol < 0 ? 'pol-inv' : 'pol-nor') + '">' +
        (s.pol < 0 ? '\u2212 invertida' : '+ normal') + '</td>' +
        '</tr>'
      );
    }
    el.table.innerHTML = rows.join('');
  }

  /* ---------- Sugerencia contextual ---------- */
  function updateHint(f, lam) {
    const l4 = lam / 4, l2 = lam / 2;
    let txt;
    switch (SA.type) {
      case 'line':
        txt = '\u03BB @ ' + f + ' Hz = ' + fmt(lam) + ' m \u00B7 usa espaciado \u2264 \u03BB/2 = ' +
              fmt(l2) + ' m para evitar l\u00F3bulos de rejilla.';
        break;
      case 'earc':
        txt = 'Steering a ' + deg(SA.angle) + ': cada metro de offset a un lado suma ' +
              fmt(Math.sin(SA.angle * Math.PI / 180) / BS.speed * 1000) +
              ' ms. Espaciado corto (\u2264 \u03BB/2 = ' + fmt(l2) + ' m) evita l\u00F3bulos laterales.';
        break;
      case 'farc': {
        const dphi = SA.n > 1 ? SA.spread / (SA.n - 1) : 0;
        const R = SA.spacing / (2 * Math.sin(Math.max(dphi / 2, 1e-6) * Math.PI / 180));
        txt = 'Apertura ' + deg(SA.spread) + ' \u2192 radio del arco \u2248 ' + fmt(R, 1) +
              ' m. Sin delays: la cobertura la define la geometr\u00EDa.';
        break;
      }
      case 'endfire':
        txt = 'Espaciado ideal \u03BB/4 = ' + fmt(l4) + ' m @ ' + f +
              ' Hz. La caja trasera dispara primero (0 ms) y la frontal retrasa ' +
              fmt((SA.n - 1) * l4 / BS.speed * 1000) + ' ms.';
        break;
      case 'grad':
      case 'stack':
        txt = 'Separaci\u00F3n ideal entre filas: \u03BB/4 = ' + fmt(l4) + ' m @ ' + f +
              ' Hz. Fila trasera: polaridad invertida + ' +
              fmt(SA.rowSep / BS.speed * 1000) + ' ms (usa ' + fmt(l4 / BS.speed * 1000) +
              ' ms si separas filas a \u03BB/4).';
        break;
      default:
        txt = '';
    }
    el.hint.textContent = txt;
  }

  /* ---------- Tarjetas de tipo ---------- */
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.type-card').forEach(c2 => {
        c2.classList.remove('is-active');
        c2.setAttribute('aria-checked', 'false');
      });
      card.classList.add('is-active');
      card.setAttribute('aria-checked', 'true');
      SA.type = card.dataset.type;
      syncVisibility();
      recompute(true);
    });
  });

  function syncVisibility() {
    document.querySelectorAll('.ctrl[data-show]').forEach(ctrl => {
      const types = ctrl.dataset.show.split(' ');
      ctrl.hidden = types.indexOf(SA.type) === -1;
    });
  }

  /* ---------- Sliders ---------- */
  function bindRange(id, out, apply) {
    const input = $(id);
    input.addEventListener('input', () => {
      apply(input, out);
      recompute(false);
    });
    apply(input, out);
  }

  bindRange('inN', el.outN, (i, o) => { SA.n = +i.value; o.textContent = i.value; });
  bindRange('inPerRow', el.outPerRow, (i, o) => { SA.perRow = +i.value; o.textContent = i.value; });
  bindRange('inSpacing', el.outSpacing, (i, o) => { SA.spacing = +i.value; o.textContent = fmt(SA.spacing) + ' m'; });
  bindRange('inRowSep', el.outRowSep, (i, o) => { SA.rowSep = +i.value; o.textContent = fmt(SA.rowSep) + ' m'; });
  bindRange('inAngle', el.outAngle, (i, o) => { SA.angle = +i.value; o.textContent = deg(SA.angle); });
  bindRange('inSpread', el.outSpread, (i, o) => { SA.spread = +i.value; o.textContent = deg(SA.spread); });
  bindRange('inFreq', el.outFreq, (i, o) => {
    SA.freqIdx = +i.value;
    o.textContent = BS.FREQS[SA.freqIdx] + ' Hz';
  });
  bindRange('inTemp', el.outTemp, (i, o) => {
    SA.temp = +i.value;
    o.textContent = SA.temp + ' \u00B0C \u00B7 c = ' + fmt(BS.speed, 1) + ' m/s';
  });

  /* ---------- Checkboxes ---------- */
  $('inBroad').addEventListener('change', e => {
    SA.broadband = e.target.checked;
    recompute(true);
  });
  $('inPolarity').addEventListener('change', e => {
    SA.showPositions = e.target.checked;
    recompute(false);
  });

  /* ---------- Preset \u03BB/4 ---------- */
  $('btnLambda4').addEventListener('click', () => {
    const l4 = Math.round(BS.lambda / 4 / 0.05) * 0.05;
    if (SA.type === 'grad' || SA.type === 'stack') {
      SA.rowSep = l4;
      $('inRowSep').value = String(l4);
      el.outRowSep.textContent = fmt(l4) + ' m';
    } else {
      SA.spacing = l4;
      $('inSpacing').value = String(l4);
      el.outSpacing.textContent = fmt(l4) + ' m';
    }
    recompute(false);
  });

  /* ---------- Tabs de vista ---------- */
  document.querySelectorAll('.stage-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stage-tab').forEach(t2 => {
        t2.classList.remove('is-active');
        t2.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      BS.setView(tab.dataset.view);
    });
  });

  /* ---------- Exportar CSV ---------- */
  $('btnCsv').addEventListener('click', () => {
    const lines = ['caja,x_m,y_m,delay_ms,muestras_48k,muestras_96k,polaridad'];
    for (const s of BS.subs) {
      lines.push([
        s.label,
        fmt(s.x), fmt(s.y), fmt(s.delayMs),
        Math.round(s.delayMs / 1000 * 48000),
        Math.round(s.delayMs / 1000 * 96000),
        s.pol < 0 ? 'invertida' : 'normal'
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bernaudio-delays-' + SA.type + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  });

  /* ---------- Arranque ---------- */
  BS.init(el.canvas);
  syncVisibility();
  recompute(false);
})();
