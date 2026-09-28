import { badRequest } from './errors.js';

export const MIN_AUDIO_BYTES = 1_000;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function startsWith(buffer, bytes) {
  return bytes.every((value, index) => buffer[index] === value);
}

export function detectAudioFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 4 && startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { extension: 'webm', mimeType: 'audio/webm' };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return { extension: 'ogg', mimeType: 'audio/ogg' };
  }
  if (buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { extension: 'm4a', mimeType: 'audio/mp4' };
  }
  return null;
}

export function validateAudio(file) {
  if (!file?.buffer || file.size < MIN_AUDIO_BYTES) {
    throw badRequest('audio_too_small', '녹음 파일이 너무 짧거나 비어 있습니다.');
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new ApiAudioTooLargeError();
  }
  const format = detectAudioFormat(file.buffer);
  if (!format) {
    throw badRequest('unsupported_audio', '지원하지 않는 녹음 파일 형식입니다.');
  }
  return format;
}

export class ApiAudioTooLargeError extends Error {
  constructor() {
    super('녹음 파일이 너무 큽니다.');
    this.name = 'ApiAudioTooLargeError';
    this.status = 413;
    this.code = 'audio_too_large';
  }
}
