'use strict';

// Converts microphone audio into 100 ms frames of 16-bit PCM (linear16) and
// reports each frame's loudness for the speech gate and the level meter.
class CaptionCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = options?.processorOptions?.frameSize || 1600;
    this.buffer = new Int16Array(this.frameSize);
    this.offset = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.buffer[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.offset += 1;
      this.energy += sample * sample;
      if (this.offset === this.frameSize) {
        const pcm = this.buffer.buffer.slice(0);
        this.port.postMessage({ pcm, rms: Math.sqrt(this.energy / this.frameSize) }, [pcm]);
        this.offset = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}

registerProcessor('caption-capture', CaptionCapture);
