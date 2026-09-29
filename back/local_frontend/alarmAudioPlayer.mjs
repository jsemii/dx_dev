import { decodeBase64Audio } from './tvPlayerProtocol.mjs';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export class AlarmAudioPlayer {
  constructor({ AudioClass = globalThis.Audio, BlobClass = globalThis.Blob,
    createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
    revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL) } = {}) {
    this.AudioClass = AudioClass;
    this.BlobClass = BlobClass;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
  }

  async prepare() {
    if (!this.audio) this.audio = new this.AudioClass();
    this.audio.muted = true;
    this.audio.src = SILENT_WAV;
    try { await this.audio.play(); } catch { /* The command path reports a real autoplay failure. */ }
    this.audio.pause?.();
    this.audio.removeAttribute?.('src');
    this.audio.load?.();
    this.audio.muted = false;
  }

  async play({ audio, mimeType, onPlaying, onEnded, onError }) {
    if (this.objectUrl) throw new Error('Audio playback is already active');
    if (!this.audio) this.audio = new this.AudioClass();
    const blob = new this.BlobClass([decodeBase64Audio(audio)], { type: mimeType });
    const objectUrl = this.createObjectURL(blob);
    this.objectUrl = objectUrl;
    const element = this.audio;
    const finish = (callback) => {
      if (this.objectUrl !== objectUrl) return;
      this.cleanupUrl();
      callback?.();
    };
    element.onplaying = () => onPlaying?.();
    element.onended = () => finish(onEnded);
    element.onerror = () => finish(() => onError?.('AUDIO_PLAYBACK_FAILED'));
    element.src = objectUrl;
    element.muted = false;
    element.volume = 1;
    try {
      await element.play();
    } catch {
      finish(() => onError?.('AUDIO_AUTOPLAY_BLOCKED'));
    }
  }

  stop() {
    this.audio?.pause?.();
    if (this.audio) this.audio.currentTime = 0;
    this.cleanupUrl();
  }

  cleanupUrl() {
    if (this.audio) {
      this.audio.onplaying = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.removeAttribute?.('src');
      this.audio.load?.();
    }
    if (this.objectUrl) this.revokeObjectURL?.(this.objectUrl);
    this.objectUrl = null;
  }

  dispose() {
    this.stop();
    this.audio = null;
  }
}
