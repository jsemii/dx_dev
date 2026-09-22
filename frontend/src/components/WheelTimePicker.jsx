import { useEffect, useRef } from 'react';
import './wheel-time-picker.css';

const ITEM_HEIGHT = 40;

function WheelColumn({ label, options, value, onChange, format = (option) => option }) {
  const listRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const selectedIndex = Math.max(0, options.indexOf(value));

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = selectedIndex * ITEM_HEIGHT;
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => window.clearTimeout(scrollTimerRef.current), []);

  const selectIndex = (index, behavior = 'smooth') => {
    const nextIndex = Math.min(options.length - 1, Math.max(0, index));
    const nextValue = options[nextIndex];
    onChange(nextValue);
    listRef.current?.scrollTo({ top: nextIndex * ITEM_HEIGHT, behavior });
  };

  const handleScroll = (event) => {
    window.clearTimeout(scrollTimerRef.current);
    const list = event.currentTarget;
    scrollTimerRef.current = window.setTimeout(() => {
      const nextIndex = Math.min(
        options.length - 1,
        Math.max(0, Math.round(list.scrollTop / ITEM_HEIGHT)),
      );
      selectIndex(nextIndex);
    }, 80);
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    selectIndex(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
  };

  return (
    <div className="wheel-time-column">
      <div
        ref={listRef}
        className="wheel-time-list"
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {options.map((option, index) => (
          <button
            type="button"
            role="option"
            aria-selected={option === value}
            className={option === value ? 'wheel-time-option wheel-time-option--selected' : 'wheel-time-option'}
            onClick={() => selectIndex(index)}
            key={option}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

const periods = ['오전', '오후'];
const hours = Array.from({ length: 12 }, (_, index) => index + 1);
const minutes = Array.from({ length: 60 }, (_, index) => index);

export function to24HourTime({ period, hour, minute }) {
  const hour24 = period === '오전' ? hour % 12 : (hour % 12) + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export default function WheelTimePicker({ value, onChange }) {
  return (
    <div className="wheel-time-picker" aria-label="알림 시간 선택">
      <div className="wheel-time-selection" aria-hidden="true" />
      <WheelColumn
        label="오전 또는 오후"
        options={periods}
        value={value.period}
        onChange={(period) => onChange({ ...value, period })}
      />
      <WheelColumn
        label="시"
        options={hours}
        value={value.hour}
        onChange={(hour) => onChange({ ...value, hour })}
        format={(hour) => `${hour}시`}
      />
      <WheelColumn
        label="분"
        options={minutes}
        value={value.minute}
        onChange={(minute) => onChange({ ...value, minute })}
        format={(minute) => `${String(minute).padStart(2, '0')}분`}
      />
    </div>
  );
}
