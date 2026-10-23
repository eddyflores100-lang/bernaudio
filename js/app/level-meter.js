/* BernAudio — persistent frequency weighting for captured audio samples.
   Approximate digital A/C filters; this is not an IEC-certified sound meter. */
(function (global) {
  'use strict';

  /* Factor the analog responses into first-order high/low-pass sections:
     A(s) = s^4 w4^2 / ((s+w1)^2 (s+w2) (s+w3) (s+w4)^2)
     C(s) = s^2 w4^2 / ((s+w1)^2 (s+w4)^2), wi = 2 pi fi.
     Source: Rimell et al., Industrial Health 2015, doi:10.2486/indhealth.2013-0003.
     https://www.jstage.jst.go.jp/article/indhealth/53/1/53_2013-0003/_article

     Each section uses s = 2 fs (1-z^-1)/(1+z^-1), then the complete response is
     normalized to 0 dB at 1 kHz. Real-pole sections avoid the poor conditioning
     of a single sixth-order polynomial at high sample rates. A persistent
     polyphase sinc interpolator raises the working rate to at least 192 kHz,
     limiting bilinear frequency warping to about 0.5 dB at 20 kHz. The filter
     remains approximate and does not establish IEC compliance.
     https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.bilinear.html
  */
  class WeightingFilter {
    constructor(sampleRate, weighting = 'A') {
      if (!Number.isFinite(sampleRate) || sampleRate <= 2000) {
        throw new RangeError('WeightingFilter: sampleRate must be greater than 2000 Hz');
      }
      if (!['A', 'C', 'Z'].includes(weighting)) {
        throw new RangeError('WeightingFilter: weighting must be A, C, or Z');
      }
      this.sampleRate = sampleRate;
      this.weighting = weighting;
      this._sections = [];
      this._gain = 1;
      this._factor = weighting === 'Z' ? 1 : Math.max(1, Math.ceil(192000 / sampleRate));
      this._history = null;
      this._kernels = [];
      this._historyPosition = 0;
      if (weighting === 'Z') return;

      if (this._factor > 1) this._makeInterpolator();
      const internalRate = sampleRate * this._factor;
      const k = 2 * internalRate;
      const reference = k * Math.tan(Math.PI * 1000 / internalRate);
      const addSection = (frequency, highpass) => {
        const w = 2 * Math.PI * frequency;
        this._sections.push({
          highpass,
          coefficient: (highpass ? k : w) / (k + w),
          pole: (k - w) / (k + w),
          x1: 0,
          y1: 0,
        });
        // This is also the exact digital magnitude at 1 kHz after substitution.
        this._gain *= Math.hypot(reference, w) / (highpass ? reference : w);
      };
      addSection(20.6, true);
      addSection(20.6, true);
      if (weighting === 'A') {
        addSection(107.7, true);
        addSection(737.9, true);
      }
      addSection(12194, false);
      addSection(12194, false);
    }

    _makeInterpolator() {
      // 48 samples of input delay; 96 taps per fractional phase. The Blackman
      // window keeps the 20 kHz passband flat even at 44.1 kHz input. Interpolation
      // suppresses spectral images before weighting. The IIR is linear and adds
      // no frequencies, so the same suppression also bounds aliases when its
      // output is sampled back at the input rate; a second FIR is unnecessary.
      const delay = 48, taps = 2 * delay;
      this._delay = delay;
      this._historyLength = taps + 1;
      // Duplicate the ring to make every dot product a contiguous reverse read.
      this._history = new Float64Array(2 * this._historyLength);
      for (let phase = 1; phase < this._factor; phase++) {
        const kernel = new Float64Array(taps);
        let sum = 0;
        for (let tap = 0; tap < taps; tap++) {
          const t = tap + phase / this._factor - delay;
          const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
          const window = 0.42 + 0.5 * Math.cos(Math.PI * t / delay) +
            0.08 * Math.cos(2 * Math.PI * t / delay);
          kernel[tap] = sinc * window;
          sum += kernel[tap];
        }
        for (let tap = 0; tap < taps; tap++) kernel[tap] /= sum;
        this._kernels.push(kernel);
      }
    }

    reset() {
      for (const section of this._sections) section.x1 = section.y1 = 0;
      if (this._history) this._history.fill(0);
      this._historyPosition = 0;
    }

    /* Preserve state across consecutive audio callbacks. Only reset for a new
       capture or a deliberate measurement reset. Z is an exact bypass and does
       not remove DC. A/C interpolation adds 48 input samples of delay when the
       input rate is below 192 kHz. With no output argument, return a new
       Float64Array; a caller may reuse a sufficiently large output buffer
       (including the input itself). */
    processBlock(samples, output) {
      const out = output === undefined ? new Float64Array(samples.length) : output;
      if (out.length < samples.length) {
        throw new RangeError('WeightingFilter: output is shorter than the input');
      }
      const sections = this._sections, gain = this._gain;
      const history = this._history, historyLength = this._historyLength;
      let historyPosition = this._historyPosition;
      for (let i = 0; i < samples.length; i++) {
        if (history) {
          history[historyPosition] = history[historyPosition + historyLength] = samples[i];
        }
        const current = historyPosition + historyLength;
        for (let phase = 0; phase < this._factor; phase++) {
          let value;
          if (!history) value = samples[i];
          else if (phase === 0) value = history[current - this._delay];
          else {
            const kernel = this._kernels[phase - 1];
            value = 0;
            for (let tap = 0; tap < kernel.length; tap++) value += kernel[tap] * history[current - tap];
          }
          for (let j = 0; j < sections.length; j++) {
            const section = sections[j];
            const next = section.coefficient * (section.highpass ? value - section.x1 : value + section.x1) +
              section.pole * section.y1;
            section.x1 = value;
            section.y1 = next;
            value = next;
          }
          if (phase === 0) out[i] = gain * value;
        }
        if (history && ++historyPosition === historyLength) {
          historyPosition = 0;
        }
      }
      this._historyPosition = historyPosition;
      return out;
    }
  }

  const LevelMeter = { WeightingFilter };
  if (typeof module !== 'undefined' && module.exports) module.exports = LevelMeter;
  else global.LevelMeter = LevelMeter;
})(typeof window !== 'undefined' ? window : globalThis);
