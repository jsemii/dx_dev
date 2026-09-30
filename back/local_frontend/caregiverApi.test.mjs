import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCaregivers, registerCaregiver } from '../../frontend/frontend/src/caregiverApi.js';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const guardian = {
  id: 'caregiver_share_son',
  name: '곽호철',
  relationship: '아들',
  phone: '010-4827-1936',
  role: 'ADDITIONAL',
};

test('ADDITIONAL 보호자 목록만 API 응답으로 사용한다', async () => {
  const calls = [];
  const result = await loadCaregivers(async (url, options) => {
    calls.push({ url, options });
    return response(200, { guardians: [guardian] });
  }, 'home_23');

  assert.deepEqual(result, [guardian]);
  assert.equal(calls[0].url, '/api/caregivers?home_id=home_23');
  assert.equal(calls[0].options.signal, undefined);
});

test('PRIMARY 또는 다른 형식의 응답을 정상 목록처럼 표시하지 않는다', async () => {
  await assert.rejects(
    loadCaregivers(async () => response(200, {
      guardians: [{ ...guardian, role: 'PRIMARY' }],
    }), 'home_23'),
    /응답 형식/,
  );
});

test('등록은 정리한 필드를 한 번만 POST하고 저장된 행을 반환한다', async () => {
  const calls = [];
  const saved = await registerCaregiver(async (url, options) => {
    calls.push({ url, options });
    return response(201, { guardian });
  }, 'home_23', {
    name: ' 곽호철 ', relationship: ' 아들 ', phone: ' 010-4827-1936 ',
  });

  assert.deepEqual(saved, guardian);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/caregivers');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    home_id: 'home_23', name: '곽호철', relationship: '아들', phone: '010-4827-1936',
  });
});

test('중복 전화번호와 조회 실패를 mock 데이터로 대체하지 않는다', async () => {
  await assert.rejects(
    registerCaregiver(async () => response(409, {
      error: { code: 'duplicate_phone', message: '이미 등록된 휴대전화번호입니다.' },
    }), 'home_23', { name: '곽호철', relationship: '아들', phone: '010-4827-1936' }),
    (error) => error.status === 409 && error.code === 'duplicate_phone',
  );
  await assert.rejects(
    loadCaregivers(async () => response(503, {
      error: { code: 'database_unavailable', message: '보호자 목록을 불러올 수 없습니다.' },
    }), 'home_23'),
    /불러올 수 없습니다/,
  );
});

test('배포 원본은 reportGuardiansMock을 정상 데이터로 import하지 않는다', () => {
  const source = readFileSync('../../frontend/frontend/src/NeulbomPage.jsx', 'utf8');
  assert.doesNotMatch(source, /reportGuardiansMock/);
  assert.match(source, /loadCaregivers/);
  assert.match(source, /registerCaregiver/);
  assert.match(source, /useEffect\(\(\) => \{\s*refreshGuardians\(\)/);
  assert.match(source, /const savedGuardian = [\s\S]*await saveCaregiver[\s\S]*setGuardians/);
  assert.ok(source.indexOf('await saveCaregiver') < source.indexOf("setSubPage('report-share')"));
});
