import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import {
  addAlarm, getAlarmSettings, listAlarms, setAlarmEnabled, setAlarmSettings, settingsFromAlarms,
} from './alarmApi.mjs';
import { connectMealAlarmPage } from './mealAlarmTransform.mjs';
import viteConfig from './vite.config.mjs';

const homeId = 'home_23';
const row = (alarm_id, type, enabled = true) => ({
  alarm_id, home_id: homeId, type, name: type === 'meal' ? '아침' : '약', time: '08:30', enabled,
});

test('meal page retains upstream layout but waits for API before updating', () => {
  const source = readFileSync(realpathSync('../../frontend/frontend/src/MealMedicationCarePage.jsx'), 'utf8');
  const transformed = connectMealAlarmPage(source);
  assert.match(transformed, /await onSaveReminder\(editingCategory, reminder\)/);
  assert.match(transformed, /onSetReminderEnabled\(sectionKey, reminderId, enabled\)/);
  assert.doesNotMatch(transformed, /checked=\{settings.enabled\}\s+disabled/);
  assert.doesNotMatch(transformed, /checked=\{section.enabled\}\s+disabled/);
  assert.doesNotMatch(transformed, /개별 알림만 저장됩니다/);
  assert.doesNotMatch(transformed, /전체 설정 미지원/);
  assert.match(transformed, /\{settings\.enabled \? '사용 중' : '사용 안함'\}/);
  assert.throws(() => connectMealAlarmPage('changed upstream'), /변경됐습니다/);
});

test('alarm route uses the voice backend and preserves LAN Host', () => {
  assert.equal(viteConfig.server.proxy['/api/alarms'].target, 'http://127.0.0.1:8081');
  assert.equal(viteConfig.server.proxy['/api/alarms'].changeOrigin, false);
});

test('list separates meal and medication without mock reminders', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(url, /^\/api\/alarms\?home_id=home_23$/);
    return new Response(JSON.stringify([row(1, 'meal'), row(2, 'medication', false)]));
  };
  try {
    const settings = settingsFromAlarms(await listAlarms(), {
      enabled: true, mealEnabled: true, medicationEnabled: false,
    });
    assert.deepEqual(settings.sections.meal.reminders.map((item) => item.id), ['alarm-1']);
    assert.deepEqual(settings.sections.medication.reminders.map((item) => item.id), ['alarm-2']);
    assert.equal(settings.sections.medication.reminders[0].enabled, false);
    assert.equal(settings.sections.medication.enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('master and group settings are loaded and persisted through the API', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
    return new Response(JSON.stringify({
      home_id: homeId, enabled: false, meal_enabled: true, medication_enabled: false,
    }));
  };
  try {
    const loaded = await getAlarmSettings();
    const saved = await setAlarmSettings(loaded);
    assert.deepEqual(saved, loaded);
    assert.deepEqual(calls, [
      { url: '/api/alarms/settings?home_id=home_23', method: 'GET', body: undefined },
      { url: '/api/alarms/settings', method: 'PATCH', body: {
        home_id: homeId, enabled: false, meal_enabled: true, medication_enabled: false,
      } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create and patch send the selected home and accept only saved response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(row(9, 'meal', options.method === 'POST')), {
      status: options.method === 'POST' ? 201 : 200,
    });
  };
  try {
    const added = await addAlarm('meal', { name: '아침', time: '08:30' });
    const patched = await setAlarmEnabled('alarm-9', false);
    assert.equal(added.id, 'alarm-9');
    assert.equal(patched.enabled, false);
    assert.deepEqual(calls, [
      { url: '/api/alarms', method: 'POST', body: { home_id: homeId, type: 'meal', name: '아침', time: '08:30' } },
      { url: '/api/alarms/9', method: 'PATCH', body: { home_id: homeId, enabled: false } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed save and cross-home response cannot appear as a saved alarm', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '알림 저장소를 사용할 수 없습니다.' }), { status: 503 });
  try {
    await assert.rejects(addAlarm('meal', { name: '아침', time: '08:30' }), /HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ ...row(9, 'meal'), home_id: 'other_home' }), { status: 201 });
  try {
    await assert.rejects(addAlarm('meal', { name: '아침', time: '08:30' }), /응답 형식/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
