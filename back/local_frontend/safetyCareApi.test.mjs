import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import viteConfig from './vite.config.mjs';
import {
  analyzeAnger, getPlaybackStatus, getSafetyCareSetting, setSafetyCareEnabled,
} from './safetyCareApi.mjs';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('GET 설정 응답을 생활자 기준으로 검증한다', async () => {
  const calls = [];
  const setting = await getSafetyCareSetting(async (url, options) => {
    calls.push({ url, options });
    return response(200, { home_id: 'home_23', enabled: false, content_selection_scope: 'YOUTUBE_ONLY' });
  }, 'home_23');
  assert.equal(setting.enabled, false);
  assert.equal(calls[0].url, '/api/safety-care/settings?home_id=home_23');
  assert.equal(calls[0].options.method, 'GET');
});

test('ON PATCH 성공 응답 뒤에만 상태를 반환한다', async () => {
  let requestBody;
  const setting = await setSafetyCareEnabled(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return response(200, { home_id: 'home_23', enabled: true, content_selection_scope: 'YOUTUBE_ONLY' });
  }, 'home_23', true);
  assert.deepEqual(requestBody, { home_id: 'home_23', enabled: true });
  assert.equal(setting.enabled, true);
});

test('분석 요청은 home_id, UUID session_id, audio만 multipart로 보낸다', async () => {
  let captured;
  const audio = new Blob(['audio'], { type: 'audio/webm' });
  const result = await analyzeAnger(async (url, options) => {
    captured = { url, options };
    return response(200, { status: 'NOT_DETECTED', detected: false, transcript: '좋아요', can_resume: true });
  }, 'home_23', '11111111-1111-4111-8111-111111111111', audio);
  assert.equal(result.status, 'NOT_DETECTED');
  assert.equal(captured.url, '/api/anger/analyze');
  assert.equal(captured.options.body.get('home_id'), 'home_23');
  assert.equal(captured.options.body.get('session_id'), '11111111-1111-4111-8111-111111111111');
  assert.equal(captured.options.headers, undefined);
});

test('Player 상태 응답은 준비 수와 제어 URL을 검증한다', async () => {
  const status = await getPlaybackStatus(async (url, options) => {
    assert.equal(url, '/api/anger/playback-status?home_id=home_23');
    assert.equal(options.method, 'GET');
    return response(200, {
      status: 'NOT_READY', available: true, ready: false, ready_players: 0,
      control_url: '/player',
    });
  }, 'home_23');
  assert.equal(status.ready, false);
  assert.equal(status.control_url, '/player');
});

test('PLAYBACK_NOT_READY 오류 코드와 안전 문구를 보존한다', async () => {
  await assert.rejects(
    analyzeAnger(async () => response(409, {
      error: { code: 'PLAYBACK_NOT_READY', message: 'YouTube 재생 화면을 먼저 준비해 주세요.' },
    }), 'home_23', '11111111-1111-4111-8111-111111111111', new Blob(['audio'])),
    (error) => error.code === 'PLAYBACK_NOT_READY'
      && error.status === 409
      && error.message === 'YouTube 재생 화면을 먼저 준비해 주세요.',
  );
});

test('프론트는 원본 팀 파일을 수정하지 않고 로컬 안정 돌봄 페이지를 연결한다', async () => {
  const source = await readFile(new URL('./LocalCalmCarePage.jsx', import.meta.url), 'utf8');
  assert.match(source, /분노 감지 안됨/);
  assert.match(source, /disabled>분노 감지 안됨/);
  assert.match(source, /분노 표현 감지됨/);
  assert.match(source, /생활자 화면에서 안정 콘텐츠를 재생하고 있어요/);
  assert.match(source, /감지 재개/);
  assert.match(source, /실시간 마이크 음량 파형/);
  assert.doesNotMatch(source, /<strong>YouTube 재생 상태<\/strong>/);
  assert.doesNotMatch(source, />YouTube 재생 화면 준비<\/button>/);
  assert.doesNotMatch(source, /openControl\(url\)/);
  assert.match(source, /감지를 시작할 수 있습니다/);
  assert.match(source, /getPlaybackStatus/);
  assert.match(source, /blockForPlayer/);
  assert.match(source, /status\.status !== 'BUSY'/);
  assert.match(source, /const setting = await getSafetyCareSetting\(fetch, SAFETY_CARE_HOME_ID\)/);
  assert.doesNotMatch(source, /if \(setting\.enabled\) await monitorRef\.current\.start\(\)/);
  const resumeFlow = source.match(/const resumeDetection = useCallback\([\s\S]*?\}, \[enabled, onEnabledChange, saving\]\);/)?.[0] || '';
  assert.match(resumeFlow, /getSafetyCareSetting/);
  assert.doesNotMatch(resumeFlow, /setSafetyCareEnabled/);
  assert.equal(viteConfig.server.proxy['/api/safety-care'].target, 'http://127.0.0.1:3001');
  assert.equal(viteConfig.server.proxy['/api/anger'].target, 'http://127.0.0.1:3001');
});
