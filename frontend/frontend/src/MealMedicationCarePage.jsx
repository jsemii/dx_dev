import { useEffect, useState } from 'react';
import SmoothToggle from './components/SmoothToggle.jsx';
import WheelTimePicker, { to24HourTime } from './components/WheelTimePicker.jsx';
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

function ReminderSection({ sectionKey, section, onToggleSection, onToggleReminder, onAdd }) {
  return (
    <section className={`reminder-section${section.enabled ? '' : ' reminder-section--disabled'}`}>
      <div className="reminder-section-header">
        <h2>{section.title}</h2>
        <SmoothToggle
          checked={section.enabled}
          onChange={(enabled) => onToggleSection(sectionKey, enabled)}
          label={`${section.title} 알림 ${section.enabled ? '사용 중' : '사용 안함'}`}
        />
      </div>
      <div className="reminder-section-divider" />
      <div className="reminder-list">
        {sortRemindersByTime(section.reminders).map((reminder) => (
          <div className="reminder-row" key={reminder.id}>
            <span>{reminder.name}</span>
            <div className="reminder-row-controls">
              <time>{reminder.time}</time>
              <SmoothToggle
                checked={reminder.enabled}
                onChange={(enabled) => onToggleReminder(sectionKey, reminder.id, enabled)}
                label={`${reminder.name} ${reminder.enabled ? '알림 켜짐' : '알림 꺼짐'}`}
                disabled={!section.enabled}
                size="small"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="add-reminder-button"
          onClick={() => onAdd(sectionKey)}
          disabled={!section.enabled}
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

export default function MealMedicationCarePage({ onBack, settings, onSettingsChange, onReminderAdded }) {
  const [editingCategory, setEditingCategory] = useState(null);

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
    <div className="meal-medication-page">
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
