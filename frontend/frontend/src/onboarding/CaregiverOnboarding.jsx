import { useDemoStep } from './useDemoStep.js';
import { useRef, useState } from 'react';
import { asset } from './assets.js';
import { initialPatterns } from './data.js';
import * as Steps from './CaregiverSteps.jsx';
import './caregiver.css';
import './layout.css';

const screens = [Steps.IntroductionStep, Steps.PersonStep, Steps.AgreementsStep, Steps.RequestStep, Steps.ConsentCompleteStep, Steps.DevicesStep, Steps.PatternsStep, Steps.SetupCompleteStep];

// All success screens represent a local demonstration, never persisted consent.
export function CaregiverOnboarding({ onComplete, onCancel, manageHistory = false }) {
  const [step, setStep] = useDemoStep('caregiver', manageHistory);
  const [person, setPerson] = useState({ name: '', birth: '1947-04-29', phone: '' });
  const [agreements, setAgreements] = useState([false, false, false]);
  const [patterns, setPatterns] = useState(() => initialPatterns.map(item => ({ ...item })));
  const [timeEditor, setTimeEditor] = useState(null);
  const [showTerms, setShowTerms] = useState(false);
  const [message, setMessage] = useState('');
  const completed = useRef(false);
  const valid = Boolean(person.name.trim() && person.birth && person.birth <= new Date().toLocaleDateString('sv-SE') && /^010\d{8}$/.test(person.phone.replace(/\D/g, '')));
  const updatePerson = field => event => setPerson(current => ({ ...current, [field]: event.target.value }));
  const changePattern = (id, changes) => { setMessage(''); setPatterns(current => current.map(item => item.id === id ? { ...item, ...changes } : item)); };
  const next = () => {
    if ((step === 1 && !valid) || (step === 2 && !agreements.every(Boolean))) return;
    if (step === 6 && !patterns.every(item => item.mode === 'irregular' || (item.mode === 'time' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)))) {
      setMessage('각 생활 패턴의 시간 또는 일정하지 않아요를 선택해주세요.'); return;
    }
    setMessage('');
    if (step === 7) {
      if (!completed.current) { completed.current = true; onComplete?.({ demoOnly: true, person: { ...person }, agreements: [...agreements], consentStatus: 'demo-complete', patterns: patterns.map(item => ({ ...item })) }); }
    } else setStep(current => current + 1);
  };
  const Screen = screens[step];
  return <section className="neulbom-onboarding onboarding-page">
    <header className="onboarding-header"><button type="button" aria-label="이전 화면" onClick={() => { setMessage(''); completed.current = false; step === 0 ? onCancel?.() : setStep(step - 1); }}><img src={asset('back.svg')} alt="" /></button><h1>ThinQ 늘봄 시작하기</h1></header>
    <div className={`onboarding-body onboarding-body--${step}`} key={step}>
      <Screen {...{ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }} />
    </div>
    {message && <p className="onboarding-toast" role="status">{message}</p>}
    <footer className="onboarding-footer"><button className="onboarding-next" type={step === 1 ? 'submit' : 'button'} form={step === 1 ? 'onboarding-registration' : undefined} disabled={(step === 1 && !valid) || (step === 2 && !agreements.every(Boolean))} onClick={step === 1 ? undefined : next}>{step === 7 ? 'ThinQ 늘봄 시작하기' : '다음 단계로'}</button></footer>
    {timeEditor && <div className="onboarding-modal-backdrop"><dialog open className="onboarding-modal" aria-modal="true" aria-labelledby="time-editor-title" onCancel={event => { event.preventDefault(); setTimeEditor(null); }}>
      <form onSubmit={event => { event.preventDefault(); changePattern(timeEditor.id, { time: timeEditor.time, mode: 'time' }); setTimeEditor(null); }}>
        <h2 id="time-editor-title">{timeEditor.label}</h2><input autoFocus required type="time" aria-label={timeEditor.label} value={timeEditor.time} onChange={event => setTimeEditor({ ...timeEditor, time: event.target.value })} />
        <div className="onboarding-modal-actions"><button type="button" onClick={() => setTimeEditor(null)}>취소</button><button type="submit">확인</button></div>
      </form>
    </dialog></div>}
    {showTerms && <div className="onboarding-modal-backdrop"><dialog open className="onboarding-modal" aria-modal="true" aria-labelledby="terms-title"><h2 id="terms-title">서비스 이용 동의</h2><p>약관 전문이 아직 등록되지 않았습니다.</p><button autoFocus onClick={() => setShowTerms(false)}>닫기</button></dialog></div>}
  </section>;
}
