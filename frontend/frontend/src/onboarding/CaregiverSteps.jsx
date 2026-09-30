import { asset } from './assets.js';
import { Notice, Check, DeviceTile } from './shared.jsx';
import { agreementLabels } from './data.js';

export function IntroductionStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<div className="onboarding-intro">
            <img src={asset('intro.png')} alt="집에서 쉬는 생활자와 휴대전화로 안부를 살피는 가족" />
            <div>
              <h2>곁에 있지 않아도 안심할 수 있는<br />ThinQ 늘봄을 시작해보세요</h2>
              <p>평소 생활 패턴을 바탕으로 가족의 일상을 살피고,<br />필요한 순간에는 맞춤 돌봄과 긴급 알림을 제공해요.</p>
            </div>
          </div>);
}

export function PersonStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<form id="onboarding-registration" className="onboarding-registration" onSubmit={(event) => { event.preventDefault(); next(); }}>
            <div className="onboarding-heading">
              <h2>치매 생활자 등록하기</h2>
              <p>치매 생활자가 서비스 이용 동의를 하면<br />늘봄 서비스를 이용할 수 있어요.</p>
            </div>
            <label className="onboarding-field"><span>이름 <b>*</b></span>
              <input required value={person.name} onChange={updatePerson('name')} placeholder="이름을 입력해주세요." autoComplete="off" maxLength={30} />
            </label>
            <label className="onboarding-field"><span>생년월일 <b>*</b></span>
              <span className="onboarding-date-input">
                <span>{person.birth ? `${person.birth.replaceAll('-', '. ')}.` : '생년월일을 선택해주세요.'}</span>
                <img src={asset('calendar.svg')} alt="" />
                <input type="date" aria-label="생년월일" required max={new Date().toLocaleDateString("sv-SE")} value={person.birth} onChange={updatePerson('birth')} />
              </span>
            </label>
            <label className="onboarding-field"><span>휴대전화번호 <b>*</b></span>
              <input type="tel" required value={person.phone} onChange={updatePerson('phone')} placeholder="010-1234-5678" autoComplete="off" maxLength={13} />
            </label>
            <Notice />
          </form>);
}

export function AgreementsStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<div className="onboarding-registration"><div className="onboarding-heading"><h2>서비스 이용 동의</h2></div>            <div className="onboarding-agreements">
              <div className="onboarding-agreement-all">
                <Check all label="전체 동의하기" checked={agreements.every(Boolean)} onChange={(event) => setAgreements(agreements.map(() => event.target.checked))} />
                <button type="button" onClick={() => setShowTerms(true)}>전문보기</button>
              </div>
              {agreementLabels.map((label, index) => <Check key={label} label={label} checked={agreements[index]} onChange={(event) => setAgreements((current) => current.map((value, i) => i === index ? event.target.checked : value))} />)}
            </div>
<Notice /></div>);
}

export function RequestStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<div className="onboarding-stack">
            <div className="onboarding-banner onboarding-banner--sent">
              <div className="onboarding-sent-crop"><img src={asset('sent.png')} alt="" /></div>
              <h2>동의 요청이 완료되었어요!</h2>
              <p>{person.name.trim()} 님의 휴대전화를 확인해주세요.</p>
            </div>
            <section className="onboarding-person">
              <h2>입력한 치매 생활자 정보</h2>
              <dl>
                <div><dt>이름</dt><dd>{person.name.trim()}</dd></div>
                <div><dt>생년월일</dt><dd>{person.birth.replaceAll('-', '. ')}.</dd></div>
                <div><dt>휴대전화번호</dt><dd>{person.phone.replace(/\D/g, '').replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3')}</dd></div>
              </dl>
              <div className="onboarding-person-actions">
                <button onClick={() => setMessage('테스트 동의 요청을 다시 표시했어요.')}><img src={asset('send.svg')} alt="" />재전송</button>
                <button onClick={() => { setMessage(''); setStep(1); }}><img src={asset('edit.svg')} alt="" />정보 수정</button>
              </div>
            </section>
            <Notice />
          </div>);
}

export function ConsentCompleteStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<div className="onboarding-stack">
            <div className="onboarding-banner onboarding-banner--success">
              <img className="onboarding-success" src={asset('success.png')} alt="" />
              <h2>동의가 완료되었어요.</h2>
              <p>이제 늘봄 서비스를 시작할 수 있어요.<br />정확한 돌봄을 위해서 제품 정보를 확인해주세요.</p>
            </div>

          </div>);
}

export function DevicesStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (            <section className="onboarding-devices">
              <h2>{person.name.trim()} 님의 제품 사용 현황</h2>
              <div className="onboarding-device-grid">
                <DeviceTile type="hub" label="ThinQ ON" />
                <DeviceTile type="purifier" label="정수기" />
                <DeviceTile type="refrigerator" label="냉장고" />
                <DeviceTile type="tv" label="TV" />
                <button className="onboarding-device onboarding-add" disabled><img src={asset('add.svg')} alt="" /><span>가전 추가하기</span></button>
              </div>
            </section>);
}

export function PatternsStep({ person, updatePerson, next, agreements, setAgreements, setShowTerms, setMessage, setStep, patterns, setTimeEditor, changePattern }) {
 return (<div className="onboarding-patterns">
            <div className="onboarding-heading">
              <h2>돌봄 생활자 초기 생활 패턴</h2>
              <p>생활자의 초기 생활 패턴은 돌봄 패턴을 만드는 데에 참고하며,<br />30일 후에는 실제 생활 기록을 기준으로 업데이트됩니다.</p>
            </div>
            <div className="onboarding-pattern-list">
              {patterns.map((item) => (
                <fieldset className={`onboarding-pattern${item.id === 'breakfast' ? ' onboarding-pattern--meal' : ''}`} key={item.id}>
                  <legend>{item.label}</legend>
                  <div className="onboarding-pattern-options">
                    <button className={`onboarding-time${item.mode === 'time' ? ' is-selected' : ''}`} aria-pressed={item.mode === 'time'} aria-label={`${item.label} ${item.time} 선택 및 변경`} onClick={() => setTimeEditor({ ...item })}>
                      {Number(item.time.slice(0, 2)) < 12 ? '오전' : '오후'} {item.time}
                    </button>
                    <button className={`onboarding-irregular${item.mode === 'irregular' ? ' is-selected' : ''}`} aria-pressed={item.mode === 'irregular'} onClick={() => changePattern(item.id, { mode: 'irregular' })}>일정하지 않아요.</button>
                  </div>
                </fieldset>
              ))}
            </div>
          </div>);
}

export function SetupCompleteStep() {
 return <div className="onboarding-banner onboarding-banner--success"><img className="onboarding-success" src={asset('success.png')} alt="" /><h2>설정이 완료되었어요.</h2><p>이제 ThinQ 늘봄을 시작해보세요.</p></div>;
}
