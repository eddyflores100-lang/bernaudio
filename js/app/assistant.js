(() => {
  'use strict';
  const ENDPOINT = 'https://bernaudio-ai.eddyflores100.workers.dev/api/assistant';
  const byId = id => document.getElementById(id);
  const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const sample = (values, count = 18) => {
    if (!values || !values.length) return [];
    const step = Math.max(1, Math.floor(values.length / count));
    const out = [];
    for (let i = 0; i < values.length && out.length < count; i += step) {
      const value = Number(values[i]);
      out.push(Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
    }
    return out;
  };
  function measurementContext() {
    const AE = window.AE, SPL = window.MOD_SPL, RTA = window.MOD_RTA, TF = window.MOD_TF;
    const level = SPL?.snapshot?.() || null;
    const rta = RTA ? {
      resolutionPerOctave: safeNumber(RTA.el?.rtaRes?.value),
      weighting: RTA.el?.rtaWeight?.value || null,
      frequenciesHz: sample((RTA.bands || []).map(b => b.fc), 24),
      levelsDb: sample(RTA.disp, 24)
    } : null;
    const traces = (TF?.traces || []).slice(-2).map(trace => ({
      name: String(trace.name || 'Traza').slice(0, 16),
      sampleRate: safeNumber(trace.sampleRate), fftSize: safeNumber(trace.fftSize),
      reference: String(trace.reference || 'no especificada').slice(0, 20),
      magnitudeDb: sample(trace.mag, 18),
      phaseDeg: sample(trace.phase, 18),
      coherence: sample(trace.coherence, 18)
    }));
    const comparison = TF?._comparisonStats?.();
    return {
      app: 'BernAudio Model 80',
      audio: { running: !!AE?.running, sampleRate: safeNumber(AE?.sampleRate), channels: safeNumber(AE?.realChannels), fftSize: safeNumber(AE?.fftSize) },
      level: level ? {
        currentDb: null, leqDb: safeNumber(level.leqDb),
        minDb: safeNumber(level.minDb), maxDb: safeNumber(level.maxDb), peakDb: safeNumber(level.peakDb),
        durationSeconds: safeNumber(level.durationSeconds),
        calibrated: !!level.calibrated, weighting: level.weighting || null
      } : null,
      spectrum: rta,
      transferFunction: { measuring: !!TF?.measuring, savedTraceCount: TF?.traces?.length || 0, latestTraces: traces,
        comparison: comparison ? { meanDeltaDb: safeNumber(comparison.meanDeltaDb), maxAbsDeltaDb: safeNumber(comparison.maxAbsDeltaDb), meanCoherence: safeNumber(comparison.meanCoherence), bins: comparison.bins } : null },
      note: 'Resumen numérico reducido. No contiene audio, nombres de dispositivos ni identificadores.'
    };
  }
  function init() {
    if (document.querySelector('#baAiLauncher')) return;
    const launcher = document.createElement('button');
    launcher.id = 'baAiLauncher'; launcher.type = 'button'; launcher.className = 'ba-ai-launcher';
    launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'baAiPanel');
    launcher.textContent = '✦ BernAudio AI';
    const panel = document.createElement('section');
    panel.id = 'baAiPanel'; panel.className = 'ba-ai-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Asistente BernAudio AI');
    panel.innerHTML = '<header class="ba-ai-head"><div><strong>BernAudio AI</strong><small>Análisis asistido · Workers AI</small></div><button type="button" class="ba-ai-close" aria-label="Cerrar asistente">×</button></header><div class="ba-ai-note">Comparte solo un resumen numérico de la medición actual. No se envía audio ni se controla tu equipo.</div><div class="ba-ai-messages" id="baAiMessages" aria-live="polite"><p class="ba-ai-welcome">Puedo ayudarte a interpretar el RTA, SPL, transferencia, fase, coherencia y sesiones guardadas. ¿Qué quieres revisar?</p></div><form class="ba-ai-form" id="baAiForm"><label class="sr-only" for="baAiInput">Pregunta para BernAudio AI</label><textarea id="baAiInput" rows="2" maxlength="1200" placeholder="Ej.: ¿Qué indica esta medición?" required></textarea><button id="baAiSend" type="submit">Enviar</button></form><p class="ba-ai-foot">Las recomendaciones son orientativas; verifica con mediciones repetibles y calibración adecuada.</p>';
    const mount = document.body || document.documentElement;
    mount.appendChild(launcher); mount.appendChild(panel);
    const messages = [], feed = byId('baAiMessages'), form = byId('baAiForm'), input = byId('baAiInput'), send = byId('baAiSend');
    const close = () => { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); };
    launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; launcher.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) input.focus(); });
    panel.querySelector('.ba-ai-close').addEventListener('click', close);
    function addMessage(role, content) {
      const item = document.createElement('div'); item.className = 'ba-ai-message ' + role;
      const label = document.createElement('b'); label.textContent = role === 'user' ? 'Tú' : 'BernAudio AI';
      const text = document.createElement('p'); text.textContent = content;
      item.append(label, text); feed.append(item); feed.scrollTop = feed.scrollHeight;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || send.disabled) return;
      messages.push({ role: 'user', content: question });
      if (messages.length > 10) messages.splice(0, messages.length - 10);
      addMessage('user', question); input.value = ''; send.disabled = true; send.textContent = 'Analizando…';
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages, context: measurementContext() })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Servicio temporalmente no disponible.');
        const answer = String(payload.answer || '').slice(0, 7000);
        if (!answer) throw new Error('La IA devolvió una respuesta vacía.');
        messages.push({ role: 'assistant', content: answer }); addMessage('assistant', answer);
      } catch (error) {
        addMessage('assistant', error.message || 'No se pudo conectar con BernAudio AI.');
      } finally { send.disabled = false; send.textContent = 'Enviar'; input.focus(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
