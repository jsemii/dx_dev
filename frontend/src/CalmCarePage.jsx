import SmoothToggle from './components/SmoothToggle.jsx';
import './calm-care.css';

const asset = (name) => `/assets/${name}`;

export default function CalmCarePage({
  onBack,
  enabled,
  onEnabledChange,
  onOpenVoice,
  onOpenContent,
}) {
  return (
    <div className="calm-care-page">
      <header className="calm-care-header">
        <button type="button" onClick={onBack} aria-label="ThinQ 늘봄 화면으로 돌아가기">
          <img src={asset('nav-back.svg')} alt="" />
        </button>
        <h1>안정 돌봄</h1>
      </header>

      <div className="calm-care-content">
        <section className="calm-care-intro">
          <div className="calm-care-illustration" aria-hidden="true">
            <img src={asset('calm-care.png')} alt="" />
          </div>
          <div className="calm-care-guide">
            <div className="calm-care-copy">
              <h2>불안하거나 마음이 불편한 순간,<br />익숙한 콘텐츠와 목소리로 편안함을 전해드려요.</h2>
              <p>좋아하는 음악과 영상, 가족의 목소리를 활용해<br />안정을 돕고 편안한 상태를 이어갈 수 있도록 도와드려요.</p>
            </div>
            <div className="calm-care-actions">
              <button type="button" onClick={onOpenVoice}>
                <img src={asset('reminder-add.svg')} alt="" />
                <span>맞춤 목소리 등록하기</span>
              </button>
              <button type="button" onClick={onOpenContent}>
                <img src={asset('reminder-add.svg')} alt="" />
                <span>선호 콘텐츠 등록하기</span>
              </button>
            </div>
          </div>
        </section>

        <section className="calm-care-setting" aria-label="안정 돌봄 사용 설정">
          <span aria-live="polite">{enabled ? '사용 중' : '사용 안함'}</span>
          <SmoothToggle
            checked={enabled}
            onChange={onEnabledChange}
            label={`안정 돌봄 ${enabled ? '사용 중' : '사용 안함'}`}
          />
        </section>
      </div>
    </div>
  );
}
