/* Paired channels share one AudioContext frame origin. No audio leaves the device. */
class BernAudioCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.size = options.processorOptions?.blockSize || 2048;
    this.buffers = null; this.pos = 0; this.start = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0].length) return true;
    if (!this.buffers || this.buffers.length !== channels.length) {
      this.buffers = channels.map(() => new Float32Array(this.size)); this.pos = 0;
    }
    for (let i = 0; i < channels[0].length; i++) {
      if (this.pos === 0) this.start = currentFrame + i;
      for (let c = 0; c < channels.length; c++) this.buffers[c][this.pos] = channels[c][i];
      if (++this.pos === this.size) {
        this.port.postMessage({ channels: this.buffers, startFrame: this.start }, this.buffers.map(b => b.buffer));
        this.buffers = channels.map(() => new Float32Array(this.size)); this.pos = 0;
      }
    }
    return true;
  }
}
registerProcessor('bernaudio-capture', BernAudioCapture);
