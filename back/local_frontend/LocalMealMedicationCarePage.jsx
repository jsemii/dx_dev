import { useEffect, useRef, useState } from 'react';
import TeamMealMedicationCarePage from '../../frontend/frontend/src/MealMedicationCarePage.jsx';
import {
  addAlarm,
  deleteAlarm,
  getAlarmSettings,
  listAlarms,
  removeAlarmFromSettings,
  setAlarmEnabled,
  setAlarmSettings,
  settingsFromAlarms,
} from './alarmApi.mjs';
import './local-alarm.css';

export default function LocalMealMedicationCarePage({ onBack }) {
  const [result, setResult] = useState({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingIds, setPendingIds] = useState([]);
  const [deletingIds, setDeletingIds] = useState([]);
  const mutationInFlightRef = useRef(false);
  const interactionLocked = isSaving || pendingIds.length > 0 || deletingIds.length > 0;

  function beginMutation() {
    if (mutationInFlightRef.current || interactionLocked) return false;
    mutationInFlightRef.current = true;
    return true;
  }

  function finishMutation() {
    mutationInFlightRef.current = false;
  }

  useEffect(() => {
    const controller = new AbortController();
    setResult({ kind: 'loading' });
    Promise.all([listAlarms(controller.signal), getAlarmSettings(controller.signal)])
      .then(([items, preferences]) => setResult({
        kind: 'ready', settings: settingsFromAlarms(items, preferences),
      }))
      .catch((failure) => {
        if (failure.name !== 'AbortError') setResult({ kind: 'error', message: failure.message });
      });
    return () => controller.abort();
  }, [retry]);

  async function saveSettings(updater) {
    if (result.kind !== 'ready' || !beginMutation()) return;
    const requested = updater(result.settings);
    setIsSaving(true);
    setError('');
    try {
      const saved = await setAlarmSettings({
        enabled: requested.enabled,
        mealEnabled: requested.sections.meal.enabled,
        medicationEnabled: requested.sections.medication.enabled,
      });
      setResult((current) => ({ ...current, settings: {
        ...current.settings,
        enabled: saved.enabled,
        sections: {
          ...current.settings.sections,
          meal: { ...current.settings.sections.meal, enabled: saved.mealEnabled },
          medication: { ...current.settings.sections.medication, enabled: saved.medicationEnabled },
        },
      } }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setIsSaving(false);
      finishMutation();
    }
  }

  async function saveReminder(type, reminder) {
    if (!beginMutation()) return false;
    setIsSaving(true);
    setError('');
    try {
      const saved = await addAlarm(type, reminder);
      setResult((current) => ({ ...current, settings: {
        ...current.settings,
        sections: {
          ...current.settings.sections,
          [type]: {
            ...current.settings.sections[type],
            reminders: [...current.settings.sections[type].reminders, saved]
              .sort((a, b) => a.time.localeCompare(b.time)),
          },
        },
      } }));
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setIsSaving(false);
      finishMutation();
    }
  }

  async function toggleReminder(type, id, enabled) {
    if (pendingIds.includes(id) || !beginMutation()) return;
    setPendingIds((current) => [...current, id]);
    setError('');
    try {
      const saved = await setAlarmEnabled(id, enabled);
      if (saved.type !== type) throw new Error('알림 저장 결과가 올바르지 않습니다.');
      setResult((current) => ({ ...current, settings: {
        ...current.settings,
        sections: {
          ...current.settings.sections,
          [type]: {
            ...current.settings.sections[type],
            reminders: current.settings.sections[type].reminders.map((item) => (
              item.id === id ? saved : item
            )),
          },
        },
      } }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPendingIds((current) => current.filter((pending) => pending !== id));
      finishMutation();
    }
  }

  async function removeReminder(type, id) {
    if (result.kind !== 'ready' || !beginMutation()) return false;
    const exists = result.settings.sections[type]?.reminders.some((item) => item.id === id);
    if (!exists) {
      finishMutation();
      return false;
    }
    setDeletingIds([id]);
    setError('');
    try {
      await deleteAlarm(id);
      setResult((current) => ({
        ...current,
        settings: removeAlarmFromSettings(current.settings, type, id),
      }));
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setDeletingIds([]);
      finishMutation();
    }
  }

  if (result.kind !== 'ready') {
    return (
      <div className="meal-medication-page local-alarm-status-page">
        <button type="button" onClick={onBack}>← 뒤로</button>
        <p role={result.kind === 'error' ? 'alert' : 'status'}>
          {result.kind === 'loading' ? '식사·복약 알림 조회 중...' : result.message}
        </p>
        {result.kind === 'error' && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 조회</button>}
      </div>
    );
  }

  return <TeamMealMedicationCarePage
    onBack={onBack}
    settings={result.settings}
    onSettingsChange={saveSettings}
    onSaveReminder={saveReminder}
    onSetReminderEnabled={toggleReminder}
    onDeleteReminder={removeReminder}
    onClearError={() => setError('')}
    isSaving={isSaving}
    pendingIds={pendingIds}
    deletingIds={deletingIds}
    interactionLocked={interactionLocked}
    error={error}
  />;
}
