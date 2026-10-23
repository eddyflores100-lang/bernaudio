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

  /* ---------- Recalculo y lectura accesible ---------- */
  let canvasAvailable = true;
  function recompute() {
    BS.recompute();
    el.loading.hidden = canvasAvailable;
    refreshOutputs();
  }

  function refreshOutputs() {
    const f = BS.FREQS[SA.freqIdx];
    const lam = BS.lambda;
    el.roC.textContent = 'c = ' + fmt(BS.speed, 1) + ' m/s';
    el.roLambda.textContent = '\u03BB @ ' + f + ' Hz = ' + fmt(lam) + ' m';
    el.roSize.textContent = 'arreglo = ' + fmt(BS.arraySize()) + ' m';
    el.roSubs.textContent = BS.subs.length + ' cajas';
    el.outTemp.textContent = SA.temp + ' °C · c = ' + fmt(BS.speed, 1) + ' m/s';
    $('inTemp').setAttribute('aria-valuetext', el.outTemp.textContent);
    updateTable();
    updateHint(f, lam);
    const summary = $('simulationSummary');
    if (summary) {
      const band = SA.broadband && SA.view !== 'waves'
        ? '31–125 Hz, promedio de potencias de 7 frecuencias' : f + ' Hz';
      const polar = SA.view === 'waves' ? null : BS.polarResponse();
      const levelText = db => db <= -30 ? '≤ −30' : fmt(db, 1);
      summary.textContent = BS.subs.length + ' fuentes ideales · ' + band + '. ' +
        (SA.view === 'waves' ? 'Fase monofrecuencia ilustrativa ' + (SA.animate ? 'en movimiento.' : 'en pausa.') :
          'Polar en campo lejano: frente (+Y) ' + levelText(polar.db[0]) +
          ' dB, detrás (−Y) ' + levelText(polar.db[180]) + ' dB respecto al máximo; escala hasta −30 dB.');
    }
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
        '<td>' + fmt(s.delayMs, 3) + '</td>' +
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
        txt = 'Puntería a ' + deg(SA.angle) + ' desde +Y hacia +X: delay relativo X·sen(θ)/c = ' +
              fmt(Math.sin(SA.angle * Math.PI / 180) / BS.speed * 1000) +
              ' ms por metro. Para limitar lóbulos de rejilla al orientar: d ≤ λ/(1 + |sen θ|) = ' +
              fmt(lam / (1 + Math.abs(Math.sin(SA.angle * Math.PI / 180)))) + ' m.';
        break;
      case 'farc': {
        const dphi = SA.n > 1 ? SA.spread / (SA.n - 1) : 0;
        const R = SA.spacing / (2 * Math.sin(Math.max(dphi / 2, 1e-6) * Math.PI / 180));
        txt = 'Apertura ' + deg(SA.spread) + ' \u2192 radio del arco \u2248 ' + fmt(R, 1) +
              ' m (espaciado medido entre centros vecinos). Fuentes omnidireccionales sin delays: la geometría modifica la interferencia; no modela la orientación del gabinete.';
        break;
      }
      case 'endfire':
        txt = 'Espaciado ideal \u03BB/4 = ' + fmt(l4) + ' m @ ' + f +
              ' Hz. La caja trasera dispara primero (0 ms) y la frontal retrasa ' +
              fmt((SA.n - 1) * SA.spacing / BS.speed * 1000, 3) +
              ' ms con el espaciado actual. El rechazo trasero depende de frecuencia y número de cajas.';
        break;
      case 'grad':
      case 'stack':
        txt = 'Separación entre centros en profundidad (eje Y). λ/4 = ' + fmt(l4) + ' m @ ' + f +
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
  const typeCards = Array.from(document.querySelectorAll('.type-card'));
  function selectType(card) {
    typeCards.forEach(c2 => {
      const active = c2 === card;
      c2.classList.toggle('is-active', active);
      c2.setAttribute('aria-checked', String(active));
      c2.tabIndex = active ? 0 : -1;
    });
    SA.type = card.dataset.type;
    syncVisibility();
    recompute();
  }

  function keyboardChoice(event, choices, select) {
    const current = choices.indexOf(event.currentTarget);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % choices.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current + choices.length - 1) % choices.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else return;
    event.preventDefault();
    select(choices[next]);
    choices[next].focus();
  }

  typeCards.forEach(card => {
    card.tabIndex = card.dataset.type === SA.type ? 0 : -1;
    card.addEventListener('click', () => selectType(card));
    card.addEventListener('keydown', event => keyboardChoice(event, typeCards, selectType));
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
      recompute();
      input.setAttribute('aria-valuetext', out.textContent);
    });
    apply(input, out);
    input.setAttribute('aria-valuetext', out.textContent);
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
    recompute();
  });
  $('inPolarity').addEventListener('change', e => {
    SA.showPositions = e.target.checked;
    recompute();
  });

  /* ---------- Preset \u03BB/4 ---------- */
  $('btnLambda4').addEventListener('click', () => {
    const l4 = Math.round(BS.lambda / 4 / 0.05) * 0.05;
    if (SA.type === 'grad' || SA.type === 'stack') {
      $('inRowSep').value = String(l4);
      SA.rowSep = Number($('inRowSep').value);
      el.outRowSep.textContent = fmt(SA.rowSep) + ' m';
      $('inRowSep').setAttribute('aria-valuetext', el.outRowSep.textContent);
    } else {
      $('inSpacing').value = String(l4);
      SA.spacing = Number($('inSpacing').value);
      el.outSpacing.textContent = fmt(SA.spacing) + ' m';
      $('inSpacing').setAttribute('aria-valuetext', el.outSpacing.textContent);
    }
    recompute();
  });

  /* ---------- Tabs de vista ---------- */
  const viewTabs = Array.from(document.querySelectorAll('.stage-tab'));
  function selectView(tab) {
    viewTabs.forEach(t2 => {
      const active = t2 === tab;
      t2.classList.toggle('is-active', active);
      t2.setAttribute('aria-selected', String(active));
      t2.tabIndex = active ? 0 : -1;
    });
    BS.setView(tab.dataset.view);
    $('simulationPanel').setAttribute('aria-labelledby', tab.id);
    $('inBroad').disabled = SA.view === 'waves';
    $('btnPauseWaves').hidden = SA.view !== 'waves';
    refreshOutputs();
  }
  viewTabs.forEach(tab => {
    tab.tabIndex = tab.dataset.view === SA.view ? 0 : -1;
    tab.addEventListener('click', () => selectView(tab));
    tab.addEventListener('keydown', event => keyboardChoice(event, viewTabs, selectView));
  });

  function updatePauseButton() {
    const button = $('btnPauseWaves');
    button.textContent = SA.animate ? 'Pausar ondas' : 'Animar ondas';
    button.setAttribute('aria-pressed', String(!SA.animate));
  }
  if ($('btnPauseWaves')) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) BS.setAnimation(false);
    $('btnPauseWaves').addEventListener('click', () => {
      BS.setAnimation(!SA.animate);
      updatePauseButton();
      refreshOutputs();
    });
    updatePauseButton();
  }

  /* ---------- Exportar CSV ---------- */
  $('btnCsv').addEventListener('click', () => {
    const lines = ['caja,x_m,y_m,delay_ms,muestras_48k,muestras_96k,polaridad'];
    for (const s of BS.subs) {
      lines.push([
        s.label,
        fmt(s.x, 6), fmt(s.y, 6), fmt(s.delayMs, 6),
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
  const initialized = BS.init(el.canvas);
  if (initialized === false) {
    canvasAvailable = false;
    el.loading.hidden = false;
    el.loading.textContent = 'Canvas no disponible. La tabla de delays sigue funcionando.';
  }
  syncVisibility();
  recompute();
})();
