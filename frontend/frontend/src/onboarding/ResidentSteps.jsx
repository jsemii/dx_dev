import { residentAsset } from './assets.js';
import { residentAgreements as agreements, mockResident, mockCaregiver } from './data.js';
export function IdentityCard({ guardian = false }) {
  return <section className={`guardian-identity${guardian ? ' guardian-identity--contact' : ''}`}>
    <h3>{guardian ? '보호자 정보' : '본인이 맞으신가요?'}</h3>
    <dl>
      <div><dt>이름</dt><dd>{guardian ? mockCaregiver.name : mockResident.name}</dd></div>
      {!guardian && <div><dt>생년월일</dt><dd>{mockResident.birth}</dd></div>}
      <div><dt>휴대전화번호</dt><dd>{guardian ? mockCaregiver.phone : mockResident.phone}</dd></div>
    </dl>
  </section>;
}


export function ResidentIdentityStep({ checked, setChecked, expandedTerms, setExpandedTerms }) { return (<>
        <h2>ThinQ 늘봄과 함께,<br />더 안전하고<br />편안한 일상을 시작하세요.</h2>
        <p className="guardian-subtitle">서비스 이용을 위해<br />아래 정보가 본인이 맞는지 확인해주세요.</p>
        <div className="guardian-identities"><IdentityCard /><IdentityCard guardian /></div>
      </>); }

export function ResidentAgreementsStep({ checked, setChecked, expandedTerms, setExpandedTerms }) { return (<>
        <h2>어떤 데이터를 이용하고,<br />어떤 정보를 제공할까요?</h2>
        <p className="guardian-subtitle">아래 내용을 확인하고 동의해주세요.</p>
        <div className="guardian-agreements">
          {agreements.map((item) => <section className="guardian-agreement" key={item.id}>
            <label className="guardian-agreement-label">
              <input type="checkbox" checked={Boolean(checked[item.id])} onChange={(event) => setChecked((current) => ({ ...current, [item.id]: event.target.checked }))} aria-describedby={`${item.id}-description`} />
              <span className={`guardian-checkbox${checked[item.id] ? ' guardian-checkbox--checked' : ''}`} aria-hidden="true">
                {checked[item.id] ? '✓' : <img src={residentAsset('checkbox.svg')} alt="" />}
              </span>
              <span className="guardian-agreement-title">{item.title}</span>
            </label>
            <button className="guardian-terms-button" aria-label={`${item.title} 전문보기`} aria-expanded={expandedTerms === item.id} aria-controls={`${item.id}-terms`} onClick={() => setExpandedTerms((current) => current === item.id ? null : item.id)}>전문보기</button>
            <p id={`${item.id}-description`}>{item.description}</p>
            <p className="guardian-terms-note" id={`${item.id}-terms`} hidden={expandedTerms !== item.id}>약관 전문이 아직 등록되지 않았습니다.</p>
          </section>)}
        </div>
      </>); }

export function ResidentCompleteStep({ checked, setChecked, expandedTerms, setExpandedTerms }) { return (<>
        <h2>동의가 완료되었어요.</h2>
        <p className="guardian-subtitle">이제 ThinQ 늘봄과 함께<br />더 안전하고 편안한 일상을 보내요.</p>
        <img className="guardian-complete-image" src={residentAsset('complete.png')} alt="동의 완료를 나타내는 초록색 체크 표시" />

      </>); }
