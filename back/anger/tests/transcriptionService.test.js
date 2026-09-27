import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptionService } from '../src/services/transcriptionService.js';

test('OpenAI STT 실패는 원본 오류를 노출하지 않는 안전한 저장소 오류로 변환한다', async () => {
  const service = new TranscriptionService('', {
    audio: {
      transcriptions: {
        async create() { throw new Error('secret key and transcript'); },
      },
    },
  });
  await assert.rejects(
    service.transcribe(Buffer.from('audio'), { extension: 'webm', mimeType: 'audio/webm' }),
    (error) => error.status === 503
      && error.code === 'transcription_failed'
      && !error.message.includes('secret'),
  );
});

test('OpenAI STT 요청에 설정한 timeout을 전달한다', async () => {
  let options;
  const service = new TranscriptionService('', {
    audio: {
      transcriptions: {
        async create(_request, requestOptions) {
          options = requestOptions;
          return { text: '정상 문장' };
        },
      },
    },
  }, 12_345);
  const result = await service.transcribe(
    Buffer.from('audio'),
    { extension: 'webm', mimeType: 'audio/webm' },
  );
  assert.equal(result, '정상 문장');
  assert.deepEqual(options, { timeout: 12_345 });
});
