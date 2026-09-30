import { useDemoStep } from './useDemoStep.js';
import { useEffect, useRef, useState } from 'react';
import { residentAsset } from './assets.js';
import { residentAgreements, mockResident } from './data.js';
import { ResidentIdentityStep, ResidentAgreementsStep, ResidentCompleteStep } from './ResidentSteps.jsx';
import './resident.css';
import './layout.css';

// Independent local demo. Never sends consent to the caregiver device.
export function ResidentConsentOnboarding({ onComplete, onCancel, manageHistory = false }) {
  const [step, setStep] = useDemoStep('resident', manageHistory);
  const [checked, setChecked] = useState({});
  const [expandedTerms, setExpandedTerms] = useState(null);
  const completed = useRef(false);
  useEffect(() => { if (step < 2) completed.current = false; }, [step]);
  const canContinue = residentAgreements.filter(item => item.required).every(item => checked[item.id]);
  const Screen = [ResidentIdentityStep, ResidentAgreementsStep, ResidentCompleteStep][step];
  const next = () => {
    if (step === 0) setStep(1);
    else if (step === 1 && canContinue) {
      setStep(2);
      if (!completed.current) {
        completed.current = true;
        onComplete?.({ demoOnly: true, person: { ...mockResident }, agreements: { ...checked }, consentStatus: 'demo-complete' });
      }
    }
  };
  return <section className="neulbom-onboarding guardian-shell">
    <header className="guardian-header"><button aria-label="이전 화면" onClick={() => { completed.current = false; step === 0 ? onCancel?.() : setStep(step - 1); }}><img src={residentAsset('back.svg')} alt="" /></button><h1>ThinQ 늘봄 시작하기</h1></header>
    <div className={`guardian-content guardian-content--${step}`} key={step}><Screen {...{ checked, setChecked, expandedTerms, setExpandedTerms }} /></div>
    <footer className="guardian-footer"><button className="guardian-next" disabled={(step === 1 && !canContinue) || step === 2} onClick={next}>{step === 0 ? '본인이 맞습니다.' : step === 1 ? '설정 마치기' : '설정 완료'}</button></footer>
  </section>;
}
