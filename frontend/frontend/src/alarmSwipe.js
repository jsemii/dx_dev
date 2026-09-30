export const ALARM_DELETE_WIDTH = 76;
export const ALARM_SWIPE_INTENT_THRESHOLD = 8;
export const ALARM_SWIPE_OPEN_THRESHOLD = 38;

const clampOffset = (value) => Math.max(-ALARM_DELETE_WIDTH, Math.min(0, value));

export function startAlarmSwipe(clientX, clientY, initiallyOpen = false) {
  const initialOffset = initiallyOpen ? -ALARM_DELETE_WIDTH : 0;
  return {
    startX: clientX,
    startY: clientY,
    initialOffset,
    offset: initialOffset,
    axis: 'pending',
  };
}

export function moveAlarmSwipe(gesture, clientX, clientY) {
  if (!gesture || gesture.axis === 'vertical') return gesture;
  const deltaX = clientX - gesture.startX;
  const deltaY = clientY - gesture.startY;
  let axis = gesture.axis;
  if (axis === 'pending') {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < ALARM_SWIPE_INTENT_THRESHOLD) {
      return gesture;
    }
    axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
  }
  if (axis === 'vertical') return { ...gesture, axis };
  return {
    ...gesture,
    axis,
    offset: clampOffset(gesture.initialOffset + deltaX),
  };
}

export function finishAlarmSwipe(gesture) {
  if (!gesture || gesture.axis !== 'horizontal') {
    return {
      open: Boolean(gesture?.initialOffset),
      didSwipe: false,
    };
  }
  return {
    open: gesture.offset <= -ALARM_SWIPE_OPEN_THRESHOLD,
    didSwipe: true,
  };
}
