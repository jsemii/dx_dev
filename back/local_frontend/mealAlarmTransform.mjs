function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('팀원 식사·복약 화면 구조가 변경됐습니다. 로컬 알림 연결을 확인하세요.');
  }
  return source.replace(before, after);
}

// Keep the upstream layout, but let the local bridge own persistence and pending/error state.
export function connectMealAlarmPage(source) {
  let result = source;
  result = replaceOnce(result,
    'function ReminderSection({ sectionKey, section, onToggleSection, onToggleReminder, onAdd }) {',
    'function ReminderSection({ sectionKey, section, onToggleSection, onToggleReminder, onAdd, pendingIds }) {');
  result = replaceOnce(result, 'disabled={!section.enabled}\n                size="small"',
    'disabled={!section.enabled || pendingIds.includes(reminder.id)}\n                size="small"');
  result = replaceOnce(result,
    'function ReminderEditor({ category, onBack, onAdd }) {',
    'function ReminderEditor({ category, onBack, onAdd, isSaving, error }) {');
  result = replaceOnce(result,
    '      <div className="reminder-editor-bottom-action">\n        <button type="button" onClick={submit} disabled={!name.trim()}>추가하기</button>',
    '      {error && <p className="local-alarm-error local-alarm-editor-error" role="alert">{error}</p>}\n      <div className="reminder-editor-bottom-action">\n        <button type="button" onClick={submit} disabled={!name.trim() || isSaving}>{isSaving ? \'저장 중...\' : \'추가하기\'}</button>');
  result = replaceOnce(result,
    'export default function MealMedicationCarePage({ onBack, settings, onSettingsChange, onReminderAdded }) {',
    'export default function MealMedicationCarePage({ onBack, settings, onSettingsChange, onSaveReminder, onSetReminderEnabled, onClearError, isSaving, pendingIds, error }) {');
  result = replaceOnce(result,
    `  const toggleReminder = (sectionKey, reminderId, enabled) => {
    updateSection(sectionKey, (section) => ({
      ...section,
      reminders: section.reminders.map((reminder) => (
        reminder.id === reminderId ? { ...reminder, enabled } : reminder
      )),
    }));
  };`,
    `  const toggleReminder = (sectionKey, reminderId, enabled) => {
    onSetReminderEnabled(sectionKey, reminderId, enabled);
  };`);
  result = replaceOnce(result,
    `  const addReminder = (reminder) => {
    updateSection(editingCategory, (section) => ({
      ...section,
      reminders: sortRemindersByTime([...section.reminders, reminder]),
    }));
    onReminderAdded?.({ category: editingCategory, ...reminder });
    setEditingCategory(null);
  };`,
    `  const addReminder = async (reminder) => {
    if (await onSaveReminder(editingCategory, reminder)) setEditingCategory(null);
  };`);
  result = replaceOnce(result,
    'onBack={() => setEditingCategory(null)}\n        onAdd={addReminder}',
    'onBack={() => { onClearError(); setEditingCategory(null); }}\n        onAdd={addReminder}\n        isSaving={isSaving}\n        error={error}');
  result = replaceOnce(result,
    '<div className="meal-medication-content">',
    '<div className="meal-medication-content">\n        {error && <p className="local-alarm-error" role="alert">{error}</p>}');
  result = replaceOnce(result,
    'onToggleReminder={toggleReminder}\n                onAdd={setEditingCategory}',
    'onToggleReminder={toggleReminder}\n                pendingIds={pendingIds}\n                onAdd={(category) => { onClearError(); setEditingCategory(category); }}');
  return result;
}
