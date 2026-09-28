import test from 'node:test';
import assert from 'node:assert/strict';
import { AngerAnalysisService } from '../src/services/angerAnalysisService.js';
import { SessionResultCache } from '../src/services/sessionResultCache.js';

function service({ transcript = '오늘은 좋아', enabled = true, content = null, ready = [true, true] } = {}) {
  const calls = { settings: 0, playback: 0, content: 0, stt: 0, readiness: 0 };
  const instance = new AngerAnalysisService({
    safetyCareRepository: {
      async getOrDefault() {
        calls.settings += 1;
        return { enabled, angerExpressions: ['짜증 나'] };
      },
    },
    preferredContentRepository: {
      async randomYoutube() {
        calls.content += 1;
        return content;
      },
    },
    transcriptionService: { async transcribe() { calls.stt += 1; return transcript; } },
    playbackClient: {
      async assertReady(homeId) {
        assert.equal(homeId, 'home_23');
        const value = ready[Math.min(calls.readiness, ready.length - 1)];
        calls.readiness += 1;
        if (!value) {
          const error = new Error('YouTube 재생 화면을 먼저 준비해 주세요.');
          error.code = 'PLAYBACK_NOT_READY';
          error.status = 409;
          throw error;
        }
      },
      async requestPlayback() { calls.playback += 1; return { requestId: '11111111-1111-4111-8111-111111111111' }; },
    },
  });
  return { instance, calls };
}

test('미감지면 콘텐츠 조회와 재생을 요청하지 않는다', async () => {
  const { instance, calls } = service();
  const result = await instance.analyze({ homeId: 'home_23', buffer: Buffer.alloc(1), format: {} });
  assert.deepEqual(result, {
    status: 'NOT_DETECTED', detected: false, transcript: '오늘은 좋아', can_resume: true,
  });
  assert.equal(calls.content, 0);
  assert.equal(calls.playback, 0);
  assert.equal(calls.stt, 1);
});

test('감지면 생활자의 DB 콘텐츠를 선택해 재생 요청한다', async () => {
  const content = {
    contentId: '11111111-1111-4111-8111-111111111111',
    contentName: '좋아하는 영상',
    contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  };
  const { instance, calls } = service({ transcript: '정말 짜증 나', content });
  const result = await instance.analyze({ homeId: 'home_23', buffer: Buffer.alloc(1), format: {} });
  assert.equal(result.status, 'DETECTED');
  assert.equal(result.playback.content_id, content.contentId);
  assert.equal(calls.settings, 2);
  assert.equal(calls.content, 1);
  assert.equal(calls.playback, 1);
  assert.equal(calls.readiness, 2);
});

test('비활성 상태에서는 STT 이전에 차단한다', async () => {
  const { instance, calls } = service({ enabled: false });
  await assert.rejects(
    instance.analyze({ homeId: 'home_23', buffer: Buffer.alloc(1), format: {} }),
    (error) => error.code === 'safety_care_disabled' && error.status === 409,
  );
  assert.equal(calls.stt, 0);
  assert.equal(calls.readiness, 0);
});

test('Player가 준비되지 않으면 STT·콘텐츠·재생 전에 HTTP 409 오류로 차단한다', async () => {
  const { instance, calls } = service({ ready: [false] });
  await assert.rejects(
    instance.analyze({ homeId: 'home_23', buffer: Buffer.alloc(1), format: {} }),
    (error) => error.code === 'PLAYBACK_NOT_READY' && error.status === 409,
  );
  assert.deepEqual(calls, {
    settings: 1, playback: 0, content: 0, stt: 0, readiness: 1,
  });
});

test('STT 중 Player 연결이 끊기면 콘텐츠 조회와 재생 직전에 차단한다', async () => {
  const content = {
    contentId: '11111111-1111-4111-8111-111111111111',
    contentName: '좋아하는 영상',
    contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  };
  const { instance, calls } = service({ transcript: '짜증 나', content, ready: [true, false] });
  await assert.rejects(
    instance.analyze({ homeId: 'home_23', buffer: Buffer.alloc(1), format: {} }),
    (error) => error.code === 'PLAYBACK_NOT_READY' && error.status === 409,
  );
  assert.equal(calls.stt, 1);
  assert.equal(calls.readiness, 2);
  assert.equal(calls.content, 0);
  assert.equal(calls.playback, 0);
});

test('같은 session_id의 동시 요청은 한 번만 수행한다', async () => {
  const cache = new SessionResultCache();
  let calls = 0;
  const operation = async () => { calls += 1; return { detected: true }; };
  const first = cache.run('session', operation);
  const second = cache.run('session', operation);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
