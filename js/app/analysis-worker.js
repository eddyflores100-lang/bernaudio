/* Local, cancellable IR analysis. Audio capture and UI stay on their threads. */
'use strict';
self.window = self;
importScripts('dsp.js');
function referenceCorrelation(rec, sweep, offset) {
  const n = sweep.length;
  if (!n || !Number.isInteger(offset) || offset < 0 || offset + n > rec.length) return 0;
  let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < n; i++) {
    const x = sweep[i], y = rec[offset + i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    sx += x; sy += y; xx += x * x; yy += y * y; xy += x * y;
  }
  const norm = Math.sqrt(Math.max(0, xx - sx * sx / n) * Math.max(0, yy - sy * sy / n));
  return norm > 0 ? Math.max(-1, Math.min(1, (xy - sx * sy / n) / norm)) : 0;
}
self.onmessage = function (event) {
  try {
    const { rec, sweep, sr } = event.data;
    const length = DSP.nextPow2(rec.length + sweep.length);
    if (length > 1 << 22 || !(sr > 0)) throw new Error('captura demasiado grande o inválida');
    const { ir } = DSP.deconvolveIR(rec, sweep);
    const pk = DSP.findPeak(ir);
    const matched = referenceCorrelation(rec, sweep, pk.idx);
    const rt = DSP.schroederRT60(ir, sr, pk.idx);
    const cc = DSP.clarityC(ir, sr, pk.idx);
    self.postMessage({ ir, pk, referenceCorrelation: matched, rt: { rt60: rt.rt60, detail: rt.detail, edt: rt.edt, t30: rt.t30 }, cc }, [ir.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
