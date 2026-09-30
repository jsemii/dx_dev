import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import {
  ALARM_DELETE_WIDTH,
  finishAlarmSwipe,
  moveAlarmSwipe,
  startAlarmSwipe,
} from '../../frontend/frontend/src/alarmSwipe.js';

test('left mouse or touch pointer drag opens only after the horizontal threshold', () => {
  for (const pointerType of ['mouse', 'touch']) {
    let gesture = startAlarmSwipe(200, 100, false);
    gesture = moveAlarmSwipe(gesture, 190, 101);
    assert.equal(finishAlarmSwipe(gesture).open, false, pointerType);
    gesture = moveAlarmSwipe(gesture, 120, 102);
    assert.equal(gesture.offset, -ALARM_DELETE_WIDTH, pointerType);
    assert.deepEqual(finishAlarmSwipe(gesture), { open: true, didSwipe: true }, pointerType);
  }
});

test('right drag closes an open row and vertical movement stays page scrolling', () => {
  let gesture = startAlarmSwipe(100, 100, true);
  gesture = moveAlarmSwipe(gesture, 180, 102);
  assert.equal(gesture.offset, 0);
  assert.deepEqual(finishAlarmSwipe(gesture), { open: false, didSwipe: true });

  gesture = startAlarmSwipe(100, 100, false);
  gesture = moveAlarmSwipe(gesture, 104, 145);
  assert.equal(gesture.axis, 'vertical');
  assert.equal(gesture.offset, 0);
  assert.deepEqual(finishAlarmSwipe(gesture), { open: false, didSwipe: false });
});

test('short taps do not become swipes and offsets never exceed the delete width', () => {
  let gesture = startAlarmSwipe(100, 100, false);
  gesture = moveAlarmSwipe(gesture, 96, 102);
  assert.equal(gesture.axis, 'pending');
  assert.deepEqual(finishAlarmSwipe(gesture), { open: false, didSwipe: false });

  gesture = moveAlarmSwipe(startAlarmSwipe(200, 100, false), -500, 100);
  assert.equal(gesture.offset, -76);
});

test('rendered alarm rows use pointer events, accessible delete and pan-y layout', () => {
  const component = readFileSync(realpathSync('../../frontend/frontend/src/MealMedicationCarePage.jsx'), 'utf8');
  const css = readFileSync(realpathSync('../../frontend/frontend/src/meal-medication-care.css'), 'utf8');
  assert.match(component, /onPointerDown=\{handlePointerDown\}/);
  assert.match(component, /onPointerMove=\{handlePointerMove\}/);
  assert.match(component, /aria-label="알림 삭제"/);
  assert.match(component, /onFocus=\{\(\) => onOpenReminder\(reminder\.id\)\}/);
  assert.match(component, /openReminderId/);
  assert.match(component, /pointerStartedOnControl/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /width: 76px/);
});

test('local bridge removes only after API success and blocks overlapping mutations', () => {
  const source = readFileSync(realpathSync('./LocalMealMedicationCarePage.jsx'), 'utf8');
  assert.match(source, /mutationInFlightRef\.current/);
  assert.match(source, /await deleteAlarm\(id\)/);
  assert.ok(source.indexOf('await deleteAlarm(id)')
    < source.indexOf('settings: removeAlarmFromSettings(current.settings, type, id)'));
  assert.match(source, /catch \(failure\) \{\s*setError\(failure\.message\);\s*return false;/);
});
