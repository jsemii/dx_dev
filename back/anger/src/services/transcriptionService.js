import OpenAI, { toFile } from 'openai';
import { unavailable } from '../errors.js';

export class TranscriptionService {
  constructor(apiKey, client = null, timeoutMs = 30_000) {
    this.apiKey = apiKey;
    this.client = client;
    this.timeoutMs = timeoutMs;
  }

  async transcribe(buffer, format) {
    if (!this.apiKey && !this.client) {
      throw unavailable('transcription_unavailable', '음성 인식 서비스를 사용할 수 없습니다.');
    }
    const client = this.client || new OpenAI({
      apiKey: this.apiKey,
      timeout: this.timeoutMs,
      maxRetries: 0,
    });
    try {
      const file = await toFile(buffer, `recording.${format.extension}`, { type: format.mimeType });
      const response = await client.audio.transcriptions.create({
        file,
        model: 'gpt-4o-mini-transcribe',
        language: 'ko',
        response_format: 'json',
      }, { timeout: this.timeoutMs });
      return String(response.text || '').trim();
    } catch (error) {
      throw unavailable('transcription_failed', '음성 인식 중 오류가 발생했습니다.', error);
    }
  }
}
