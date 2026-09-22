import { useState } from 'react';
import SmoothToggle from './components/SmoothToggle.jsx';
import './daily-life-care.css';

const asset = (name) => `/assets/${name}`;

export default function DailyLifeCarePage({
  onBack,
  initialEnabled = false,
  onEnabledChange,
}) {
  const [enabled, setEnabled] = useState(initialEnabled);

  const updateEnabled = (nextEnabled) => {
    setEnabled(nextEnabled);
    onEnabledChange?.(nextEnabled);
  };

  return (
    <div className="daily-life-care-page">
      <header className="daily-life-care-header">
        <button type="button" onClick={onBack} aria-label="ThinQ 늘봄 화면으로 돌아가기">
          <img src={asset('nav-back.svg')} alt="" />
        </button>
        <h1>일상 생활 돌봄</h1>
      </header>

      <div className="daily-life-care-content">
        <section className="daily-life-care-intro">
          <div className="daily-life-care-illustration" aria-hidden="true">
            <img src={asset('daily-life-care.png')} alt="" />
          </div>
          <div className="daily-life-care-copy">
            <h2>익숙한 일상을 편안하게 이어갈 수 있도록<br />필요한 순간에 도움을 드려요.</h2>
            <p>이동이나 생활 중 어려움이 생기면 음성과 조명으로<br />자연스럽게 안내해 일상 활동을 이어갈 수 있도록 도와드려요.</p>
          </div>
        </section>

        <section className="daily-life-care-setting" aria-label="일상 생활 돌봄 사용 설정">
          <span aria-live="polite">{enabled ? '사용 중' : '사용 안함'}</span>
          <SmoothToggle
            checked={enabled}
            onChange={updateEnabled}
            label={`일상 생활 돌봄 ${enabled ? '사용 중' : '사용 안함'}`}
          />
        </section>
      </div>
    </div>
  );
}
