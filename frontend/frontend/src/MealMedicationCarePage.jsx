import { useEffect, useRef, useState } from 'react';
import SmoothToggle from './components/SmoothToggle.jsx';
import WheelTimePicker, { to24HourTime } from './components/WheelTimePicker.jsx';
import {
  ALARM_DELETE_WIDTH,
  finishAlarmSwipe,
  moveAlarmSwipe,
  startAlarmSwipe,
} from './alarmSwipe.js';
import './meal-medication-care.css';

const asset = (name) => `/assets/${name}`;
const sortRemindersByTime = (reminders) => (
  [...reminders].sort((first, second) => first.time.localeCompare(second.time))
);

function PageHeader({ title, onBack }) {
  return (
    <header className="meal-medication-header">
      <button type="button" onClick={onBack} aria-label="이전 화면으로 돌아가기">
        <img src={asset('nav-back.svg')} alt="" />
      </button>
      <h1>{title}</h1>
    </header>
  );
}

function SwipeableReminderRow({
  sectionKey,
  sectionEnabled,
  reminder,
  onToggleReminder,
  onDeleteReminder,
  openReminderId,
  onOpenReminder,
  pending,
  deleting,
  interactionLocked,
}) {
  const gestureRef = useRef(null);
  const pointerIdRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(null);
  const open = openReminderId === reminder.id;
  const offset = dragOffset ?? (open ? -ALARM_DELETE_WIDTH : 0);

  const pointerStartedOnControl = (target) => Boolean(target.closest?.('button, input, [role="switch"]'));

  const handlePointerDown = (event) => {
    if (interactionLocked || pending || deleting || pointerStartedOnControl(event.target)
        || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (openReminderId && !open) onOpenReminder(null);
    gestureRef.current = startAlarmSwipe(event.clientX, event.clientY, open);
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (pointerIdRef.current !== event.pointerId || !gestureRef.current) return;
    const next = moveAlarmSwipe(gestureRef.current, event.clientX, event.clientY);
    gestureRef.current = next;
    if (next.axis === 'horizontal') {
      event.preventDefault();
      setDragOffset(next.offset);
    }
  };

  const finishPointer = (event, cancelled = false) => {
    if (pointerIdRef.current !== event.pointerId || !gestureRef.current) return;
    const completed = cancelled
      ? { open, didSwipe: false }
      : finishAlarmSwipe(gestureRef.current);
    suppressClickRef.current = completed.didSwipe;
    onOpenReminder(completed.open ? reminder.id : null);
    gestureRef.current = null;
    pointerIdRef.current = null;
    setDragOffset(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleClickCapture = (event) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDelete = async (event) => {
    event.stopPropagation();
    const removed = await onDeleteReminder(sectionKey, reminder.id);
    if (removed) onOpenReminder(null);
  };

  return (
    <div className={`reminder-swipe${open ? ' reminder-swipe--open' : ''}${deleting ? ' reminder-swipe--deleting' : ''}`}>
      <button
        type="button"
        className="reminder-delete-button"
        aria-label="알림 삭제"
        disabled={interactionLocked}
        onFocus={() => onOpenReminder(reminder.id)}
        onClick={handleDelete}
      >
        {deleting ? '삭제 중' : '삭제'}
      </button>
      <div
        className={`reminder-row${dragOffset !== null ? ' reminder-row--dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onClickCapture={handleClickCapture}
        aria-busy={deleting || undefined}
      >
        <span>{reminder.name}</span>
        <div className="reminder-row-controls">
          <time>{reminder.time}</time>
          <SmoothToggle
            checked={reminder.enabled}
            onChange={(enabled) => onToggleReminder(sectionKey, reminder.id, enabled)}
            label={`${reminder.name} ${reminder.enabled ? '알림 켜짐' : '알림 꺼짐'}`}
            disabled={!sectionEnabled || interactionLocked || pending || deleting}
            size="small"
          />
        </div>
      </div>
    </div>
  );
}

function ReminderSection({
  sectionKey,
  section,
  onToggleSection,
  onToggleReminder,
  onDeleteReminder,
  onAdd,
  openReminderId,
  onOpenReminder,
  pendingIds = [],
  deletingIds = [],
  interactionLocked = false,
}) {
  return (
    <section className={`reminder-section${section.enabled ? '' : ' reminder-section--disabled'}`}>
      <div className="reminder-section-header">
        <h2>{section.title}</h2>
        <SmoothToggle
          checked={section.enabled}
          onChange={(enabled) => onToggleSection(sectionKey, enabled)}
          label={`${section.title} 알림 ${section.enabled ? '사용 중' : '사용 안함'}`}
          disabled={interactionLocked}
        />
      </div>
      <div className="reminder-section-divider" />
      <div className="reminder-list">
        {sortRemindersByTime(section.reminders).map((reminder) => (
          <SwipeableReminderRow
            key={reminder.id}
            sectionKey={sectionKey}
            sectionEnabled={section.enabled}
            reminder={reminder}
            onToggleReminder={onToggleReminder}
            onDeleteReminder={onDeleteReminder}
            openReminderId={openReminderId}
            onOpenReminder={onOpenReminder}
            pending={pendingIds.includes(reminder.id)}
            deleting={deletingIds.includes(reminder.id)}
            interactionLocked={interactionLocked}
          />
        ))}
        <button
          type="button"
          className="add-reminder-button"
          onClick={() => onAdd(sectionKey)}
          disabled={!section.enabled || interactionLocked}
        >
          <img src={asset('reminder-add.svg')} alt="" />
          <span>알림 추가하기</span>
        </button>
      </div>
    </section>
  );
}

function ReminderEditor({ category, onBack, onAdd }) {
  const [name, setName] = useState('');
  const [time, setTime] = useState({ period: '오전', hour: 8, minute: 30 });
  const placeholder = category === 'meal' ? '예: 아침 식사' : '예: 저녁 약';

  useEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0 });
  }, []);

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onAdd({
      id: `reminder-${Date.now()}`,
      name: trimmedName,
      time: to24HourTime(time),
      enabled: true,
    });
  };

  return (
    <div className="reminder-editor-page">
      <PageHeader title="알림 추가하기" onBack={onBack} />
      <div className="reminder-editor-body">
        <section className="reminder-editor-card">
          <WheelTimePicker value={time} onChange={setTime} />
          <label className="reminder-name-field">
            <span>알림 이름</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder}
              maxLength={30}
              autoComplete="off"
            />
          </label>
        </section>
      </div>
      <div className="reminder-editor-bottom-action">
        <button type="button" onClick={submit} disabled={!name.trim()}>추가하기</button>
      </div>
    </div>
  );
}

export default function MealMedicationCarePage({
  onBack,
  settings,
  onSettingsChange,
  onReminderAdded,
  onDeleteReminder,
  pendingIds = [],
  deletingIds = [],
  interactionLocked = false,
}) {
  const [editingCategory, setEditingCategory] = useState(null);
  const [openReminderId, setOpenReminderId] = useState(null);

  useEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0 });
  }, [editingCategory]);

  const updateSection = (sectionKey, updater) => {
    onSettingsChange((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [sectionKey]: updater(current.sections[sectionKey]),
      },
    }));
  };

  const toggleReminder = (sectionKey, reminderId, enabled) => {
    updateSection(sectionKey, (section) => ({
      ...section,
      reminders: section.reminders.map((reminder) => (
        reminder.id === reminderId ? { ...reminder, enabled } : reminder
      )),
    }));
  };

  const addReminder = (reminder) => {
    updateSection(editingCategory, (section) => ({
      ...section,
      reminders: sortRemindersByTime([...section.reminders, reminder]),
    }));
    onReminderAdded?.({ category: editingCategory, ...reminder });
    setEditingCategory(null);
  };

  if (editingCategory) {
    return (
      <ReminderEditor
        category={editingCategory}
        onBack={() => setEditingCategory(null)}
        onAdd={addReminder}
      />
    );
  }

  return (
    <div
      className="meal-medication-page"
      onPointerDown={(event) => {
        if (openReminderId && !event.target.closest?.('.reminder-swipe')) setOpenReminderId(null);
      }}
    >
      <PageHeader title="식사 및 복약 돌봄" onBack={onBack} />
      <div className="meal-medication-content">
        <section className="meal-medication-intro">
          <div className="meal-medication-illustration" aria-hidden="true">
            <img src={asset('meal-medication-care.png')} alt="" />
          </div>
          <div className="meal-medication-copy">
            <h2>식사와 약 복용 시간을 놓치지 않도록<br />필요한 순간에 알려드려요.</h2>
            <p>음성과 조명으로 식사와 복약을 안내해<br />규칙적인 생활을 이어갈 수 있도록 도와드려요.</p>
          </div>
        </section>

        <section className="meal-medication-master-setting" aria-label="식사 및 복약 돌봄 사용 설정">
          <span aria-live="polite">{settings.enabled ? '사용 중' : '사용 안함'}</span>
          <SmoothToggle
            checked={settings.enabled}
            onChange={(enabled) => onSettingsChange((current) => ({ ...current, enabled }))}
            label={`식사 및 복약 돌봄 ${settings.enabled ? '사용 중' : '사용 안함'}`}
            disabled={interactionLocked}
          />
        </section>

        {settings.enabled && (
          <div className="reminder-sections">
            {Object.entries(settings.sections).map(([sectionKey, section]) => (
              <ReminderSection
                sectionKey={sectionKey}
                section={section}
                onToggleSection={(key, enabled) => updateSection(key, (current) => ({ ...current, enabled }))}
                onToggleReminder={toggleReminder}
                onDeleteReminder={onDeleteReminder}
                openReminderId={openReminderId}
                onOpenReminder={setOpenReminderId}
                pendingIds={pendingIds}
                deletingIds={deletingIds}
                interactionLocked={interactionLocked}
                onAdd={setEditingCategory}
                key={sectionKey}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
