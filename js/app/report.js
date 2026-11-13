/* Local printable measurement report. No uploads, raw audio, or precise GPS. */
(function (global) {
  'use strict';

  const esc = value => String(value == null ? '—' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const number = (value, digits = 1) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  const date = value => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? esc(parsed.toLocaleString()) : esc(value);
  };
  const cell = value => '<td>' + esc(value) + '</td>';
  const section = (title, body) => '<section><h2>' + esc(title) + '</h2>' + body + '</section>';
  const table = (headers, rows) => {
    if (!rows.length) return '<p class="empty">No hay datos disponibles para esta sección.</p>';
    return '<div class="table-wrap"><table><thead><tr>' +
      headers.map(value => '<th>' + esc(value) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  };

  function buildHtml(report) {
    const data = report && typeof report === 'object' ? report : {};
    const audio = data.audio || {}, level = data.level || {};
    const spectrum = data.spectrum || null, tf = data.transferFunction || null;
    const field = data.field || null, correction = data.correctionCurve || null;
    const calibrated = !!level.calibrated;
    const levelStatus = calibrated
      ? 'Offset declarado por el usuario; no equivale a calibración metrológica certificada.'
      : 'Nivel estimado sin calibración absoluta declarada.';
    const summaryRows = [
      ['Fecha del informe', date(data.createdAt)],
      ['Frecuencia de muestreo', audio.sampleRate ? number(audio.sampleRate, 0) + ' Hz' : '—'],
      ['Canales detectados', audio.channels ?? '—'],
      ['Motor de captura', audio.captureBackend || '—'],
      ['FFT', audio.fftSize ? number(audio.fftSize, 0) : '—'],
      ['Ponderación SPL', level.weighting || '—'],
      ['Respuesta SPL', level.response || '—'],
      ['Duración analizada', level.durationSeconds != null ? number(level.durationSeconds, 2) + ' s' : '—'],
      ['Estado del nivel', levelStatus]
    ];
    const levelRows = [
      ['Leq', number(level.leqDb, 2) + (level.leqDb == null ? '' : ' dB')],
      ['Mínimo', number(level.minDb, 2) + (level.minDb == null ? '' : ' dB')],
      ['Máximo', number(level.maxDb, 2) + (level.maxDb == null ? '' : ' dB')],
      ['Peak Z', number(level.peakDb, 2) + (level.peakDb == null ? '' : ' dB')]
    ].map(row => '<tr>' + row.map(cell).join('') + '</tr>');

    const spectrumRows = (Array.isArray(spectrum?.bands) ? spectrum.bands : []).slice(0, 300).map(band =>
      '<tr>' + [number(band.centerHz, 2) + ' Hz', number(band.levelDb, 2) + ' dB'].map(cell).join('') + '</tr>');
    const traceRows = (Array.isArray(tf?.traces) ? tf.traces : []).slice(0, 12).map(trace =>
      '<tr>' + [
        trace.name || 'Traza',
        date(trace.createdAt),
        trace.sampleRate ? number(trace.sampleRate, 0) + ' Hz' : '—',
        trace.fftSize ?? '—',
        trace.reference || '—',
        trace.delayAdjustmentMs == null ? '—' : number(trace.delayAdjustmentMs, 3) + ' ms',
        trace.polarityInverted ? 'Invertida' : 'Normal',
        Array.isArray(trace.magnitudeDb) ? trace.magnitudeDb.length : 0
      ].map(cell).join('') + '</tr>');
    const fieldRows = (Array.isArray(field?.points) ? field.points : []).slice(0, 80).map(point => {
      const measured = point.level || {}, conditions = point.environment?.conditions || {};
      return '<tr>' + [
        point.zone || '—', date(point.capturedAt),
        number(measured.leqDb, 2), number(measured.minDb, 2), number(measured.maxDb, 2),
        measured.calibrated ? 'Offset declarado' : 'Estimado',
        conditions.temperatureC == null ? '—' : number(conditions.temperatureC, 1) + ' °C',
        conditions.windKph == null ? '—' : number(conditions.windKph, 1) + ' km/h'
      ].map(cell).join('') + '</tr>';
    });
    const curveRows = (Array.isArray(correction?.frequencies) ? correction.frequencies : []).slice(0, 200).map((frequency, i) =>
      '<tr>' + [number(frequency, 2) + ' Hz', number(correction.db?.[i], 2) + ' dB'].map(cell).join('') + '</tr>');
    const limits = Array.isArray(data.limitations) ? data.limitations :
      ['Las lecturas dependen del micrófono, la ganancia, la ruta de señal y el procedimiento.'];
    const env = data.environment || {};
    const metadataRows = [
      ['Idioma', env.language || '—'],
      ['Plataforma declarada por navegador', env.platform || '—'],
      ['Navegador', env.userAgent || '—']
    ];

    return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe técnico BernAudio</title>' +
      '<style>' +
      ':root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#17212b;font:14px/1.5 Arial,sans-serif}' +
      'main{max-width:1000px;margin:24px auto;background:#fff;padding:36px 42px;box-shadow:0 8px 30px #15253618}' +
      'header{border-bottom:3px solid #c17b35;padding-bottom:18px;margin-bottom:24px}h1{font-size:26px;margin:0 0 5px}h2{font-size:17px;margin:26px 0 10px;color:#263c50}' +
      '.sub,.empty,.muted{color:#596b7b}.notice{padding:12px 14px;background:#fff5e9;border-left:4px solid #c17b35;margin:16px 0}' +
      '.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:12px}th,td{text-align:left;padding:7px 9px;border:1px solid #dbe2e8;vertical-align:top}th{background:#edf2f6}' +
      '.actions{display:flex;gap:10px;margin:0 0 20px}.actions button{border:0;border-radius:5px;padding:10px 16px;background:#263c50;color:#fff;font-weight:700;cursor:pointer}' +
      '.small{font-size:11px;color:#5d6872}footer{border-top:1px solid #dbe2e8;padding-top:14px;margin-top:28px}' +
      '@media print{body{background:#fff}main{max-width:none;margin:0;padding:0;box-shadow:none}.actions{display:none}section{break-inside:avoid}table{font-size:10px}h2{break-after:avoid}}' +
      '@page{size:A4;margin:14mm}' +
      '</style></head><body><main>' +
      '<div class="actions"><button id="print-report" type="button" onclick="window.print()">Imprimir / Guardar como PDF</button></div>' +
      '<header><h1>BernAudio · Informe técnico de medición</h1><div class="sub">Informe local generado en el navegador · ' + date(data.createdAt) + '</div></header>' +
      '<div class="notice">' + esc(levelStatus) + ' No se incluye audio bruto ni coordenadas GPS precisas.</div>' +
      section('1. Configuración de captura', table(['Campo', 'Valor'], summaryRows.map(row => '<tr>' + row.map(cell).join('') + '</tr>'))) +
      section('2. Resumen de nivel', table(['Métrica', 'Resultado'], levelRows)) +
      section('3. Espectro RTA', '<p class="small">Ponderación: ' + esc(spectrum?.weighting || '—') +
        ' · Resolución: ' + esc(spectrum?.resolutionPerOctave ?? '—') + ' bandas/octava · Motor: ' + esc(spectrum?.engine || '—') + '</p>' +
        table(['Frecuencia central', 'Nivel'], spectrumRows)) +
      section('4. Función de transferencia', table(
        ['Traza', 'Fecha', 'Muestreo', 'FFT', 'Referencia', 'Ajuste de retardo', 'Polaridad', 'Puntos'],
        traceRows)) +
      section('5. Zonas de campo', '<p class="small">Evento: ' + esc(field?.eventName || '—') +
        ' · Puntos registrados: ' + esc(Array.isArray(field?.points) ? field.points.length : 0) + '</p>' +
        table(['Zona', 'Captura', 'Leq dB', 'Mín. dB', 'Máx. dB', 'Estado', 'Temp.', 'Viento'], fieldRows)) +
      section('6. Curva de corrección del micrófono', '<p>' +
        (correction ? (correction.enabled ? 'Activa' : 'Importada, desactivada') + ' · ' +
          esc(Array.isArray(correction.frequencies) ? correction.frequencies.length : 0) + ' puntos' : 'No hay curva importada.') +
        '</p>' + table(['Frecuencia', 'Corrección'], curveRows)) +
      section('7. Entorno de ejecución', table(['Dato', 'Valor'], metadataRows.map(row => '<tr>' + row.map(cell).join('') + '</tr>'))) +
      section('8. Límites e interpretación', '<ul>' + limits.map(item => '<li>' + esc(item) + '</li>').join('') +
        '<li>Este informe documenta datos del navegador; no certifica la exactitud metrológica del equipo ni sustituye una validación física.</li></ul>') +
      '<footer class="small">BernAudio · Informe generado localmente. Revisa la configuración y las limitaciones antes de compartirlo.</footer>' +
      '</main></body></html>';
  }

  function open(report) {
    if (typeof global.open !== 'function') return false;
    let view;
    try { view = global.open('', '_blank'); } catch (_) { return false; }
    if (!view || !view.document) return false;
    try {
      view.opener = null;
      view.document.open();
      view.document.write(buildHtml(report));
      view.document.close();
      return true;
    } catch (_) {
      try { view.close(); } catch (_) {}
      return false;
    }
  }

  global.BA_REPORT = { buildHtml, open };
})(window);
