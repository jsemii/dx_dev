import { asset } from './assets.js';
export function Notice() {
  return (
    <aside className="onboarding-notice">
      <h3><img src={asset('notice.svg')} alt="" />꼭 확인해주세요.</h3>
      <ul>
        <li>입력한 휴대전화번호로 알림톡(카카오톡)이 발송됩니다.</li>
        <li>동의 링크는 24시간 동안 유효합니다.</li>
        <li>치매 생활자가 직접 동의해야 서비스 이용이 가능합니다.</li>
        <li>동의가 완료되면 치매 생활자의 ThinQ 기기 정보가 늘봄 서비스와 연동됩니다.</li>
      </ul>
    </aside>
  );
}

export function Check({ checked, onChange, label, all = false }) {
  return (
    <label className={`onboarding-check${all ? ' onboarding-check--all' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="onboarding-check-icon" aria-hidden="true">
        {checked ? <span className="onboarding-checkmark">✓</span> : <img src={asset(all ? 'checkbox-all.svg' : 'checkbox.svg')} alt="" />}
      </span>
      <span>{label}</span>
    </label>
  );
}

export function DeviceTile({ type, label }) {
  return (
    <div className="onboarding-device">
      <div className={`onboarding-device-art onboarding-device-art--${type}`} aria-hidden="true">
        <img className="onboarding-device-base" src={asset('devices.png')} alt="" />
        {type === 'hub' && <img className="onboarding-device-hub" src={asset('hub.png')} alt="" />}
        {type === 'tv' && <span className="onboarding-tv-crop"><img src={asset('tv.png')} alt="" /></span>}
      </div>
      <span>{label}</span>
    </div>
  );
}
