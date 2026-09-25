import { useLayoutEffect, useState } from 'react';
import './report-share.css';

const asset = (name) => `/assets/${name}`;

function useResetScreenScroll() {
  useLayoutEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0, left: 0 });
  }, []);
}

function SharePageHeader({ onBack }) {
  return (
    <header className="report-share-header">
      <button type="button" onClick={onBack} aria-label="이전 화면으로 돌아가기">
        <img src={asset('nav-back.svg')} alt="" />
      </button>
      <h1>데일리 리포트 공유하기</h1>
    </header>
  );
}

export function ReportSharePage({ guardians, onBack, onAddGuardian, onShare }) {
  useResetScreenScroll();
  const [selectedGuardianIds, setSelectedGuardianIds] = useState(() => new Set());

  const toggleGuardian = (id) => {
    setSelectedGuardianIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="report-share-page">
      <SharePageHeader onBack={onBack} />

      <main className="report-share-content">
        <section className="report-share-intro">
          <div className="report-share-hero" aria-hidden="true">
            <img src={asset('report-share-hero.png')} alt="" />
          </div>
          <div className="report-share-intro-copy">
            <h2>데일리 리포트를 가족과<br />주변인들에게 공유할 수 있어요.</h2>
            <p>공유할 보호자를 등록하면<br />생활자의 일상과 생활 변화를 함께 살필 수 있어요.</p>
          </div>
          <button type="button" className="report-add-guardian-button" onClick={onAddGuardian}>
            <img src={asset('report-guardian-add.svg')} alt="" />
            <span>보호자 추가하기</span>
          </button>
        </section>

        <section className="report-guardian-card" aria-label="공유할 보호자 목록">
          <div className="report-guardian-list">
            {guardians.map((guardian, index) => {
              const selected = selectedGuardianIds.has(guardian.id);

              return (
                <div className="report-guardian-entry" key={guardian.id}>
                  <button
                    type="button"
                    className={`report-guardian-row${selected ? ' report-guardian-row--selected' : ''}`}
                    onClick={() => toggleGuardian(guardian.id)}
                    aria-pressed={selected}
                  >
                    <span className="report-guardian-check" aria-hidden="true">
                      <img
                        src={asset(selected ? 'report-guardian-checked.svg' : 'report-guardian-checkbox.svg')}
                        alt=""
                      />
                    </span>
                    <span className="report-guardian-identity">
                      <strong>{guardian.name}</strong>
                      <span>({guardian.relationship})</span>
                    </span>
                    <span className="report-guardian-phone">{guardian.phone}</span>
                  </button>
                  {index < guardians.length - 1 && <span className="report-guardian-divider" aria-hidden="true" />}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="report-share-guardians-button"
            onClick={() => onShare?.(guardians.filter((guardian) => selectedGuardianIds.has(guardian.id)))}
            disabled={selectedGuardianIds.size === 0}
          >
            <img src={asset('report-share-action.svg')} alt="" />
            <span>공유하기</span>
          </button>
        </section>
      </main>
    </div>
  );
}

export function GuardianRegistrationPage({ onBack, onRegister }) {
  useResetScreenScroll();
  const [form, setForm] = useState({ name: '', relationship: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const submitGuardian = async (event) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await onRegister?.({
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        phone: form.phone.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-share-page report-share-page--registration">
      <SharePageHeader onBack={onBack} />

      <form className="report-guardian-registration" onSubmit={submitGuardian}>
        <section className="report-guardian-form-card">
          <h2>데일리 리포트를 공유할<br />보호자의 정보를 입력해주세요.</h2>

          <label className="report-guardian-field">
            <span>이름</span>
            <input
              type="text"
              value={form.name}
              onChange={updateField('name')}
              placeholder="이름을 입력해주세요."
              autoComplete="name"
              required
            />
          </label>

          <label className="report-guardian-field">
            <span>관계</span>
            <input
              type="text"
              value={form.relationship}
              onChange={updateField('relationship')}
              placeholder="예: 요양보호사, 배우자 등"
              required
            />
          </label>

          <label className="report-guardian-field">
            <span>휴대전화번호</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={updateField('phone')}
              placeholder="예: 010-1234-5678"
              autoComplete="tel"
              required
            />
          </label>
        </section>

        <button type="submit" className="report-register-guardian-button" disabled={submitting}>
          {submitting ? '등록 중' : '보호자 등록하기'}
        </button>
      </form>
    </div>
  );
}
