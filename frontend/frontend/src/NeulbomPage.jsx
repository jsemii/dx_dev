import { useCallback, useEffect, useRef, useState } from 'react';
import CalmCarePage from './CalmCarePage.jsx';
import DailyReport from './DailyReport.jsx';
import DailyLifeCarePage from './DailyLifeCarePage.jsx';
import MealMedicationCarePage from './MealMedicationCarePage.jsx';
import PreferredContentPage from './PreferredContentPage.jsx';
import { GuardianRegistrationPage, ReportSharePage } from './ReportSharePage.jsx';
import VoiceTrainingPage from './VoiceTrainingPage.jsx';
import { loadCaregivers, registerCaregiver as saveCaregiver } from './caregiverApi.js';
import {
  applianceUsageMock,
  careFeatures,
  careOverviewMock,
  customCareSettings,
  recentCareMock,
} from './data/neulbomData.js';
import { mealMedicationCareMock } from './data/mealMedicationData.js';
import './neulbom.css';

const asset = (name) => `/assets/${name}`;

function CareIcon({ feature }) {
  return (
    <span className={`care-feature-icon care-feature-icon--${feature.iconClass}`} aria-hidden="true">
      <img src={asset(feature.icon)} alt="" />
    </span>
  );
}

function ApplianceIcon({ name }) {
  return (
    <span className={`appliance-icon appliance-icon--${name}`} aria-hidden="true">
      <span className="appliance-icon__base" />
      {name === 'on' && <span className="appliance-icon__on" />}
      {(name === 'tv' || name === 'light') && <span className="appliance-icon__tv" />}
      {name === 'light' && <span className="appliance-icon__light" />}
    </span>
  );
}

function PageHeader({ onBack }) {
  return (
    <header className="neulbom-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="메뉴 화면으로 돌아가기">
        <img src={asset('nav-back.svg')} alt="" />
      </button>
      <h1>ThinQ 늘봄</h1>
    </header>
  );
}

function PageTabs({ activeTab, onChange }) {
  return (
    <div className={`page-tabs page-tabs--${activeTab}`} role="tablist" aria-label="ThinQ 늘봄 메뉴">
      <span className="page-tabs__indicator" aria-hidden="true" />
      <button
        type="button"
        className={`page-tab${activeTab === 'care' ? ' page-tab--active' : ''}`}
        role="tab"
        aria-selected={activeTab === 'care'}
        onClick={() => onChange('care')}
      >
        돌봄 관리
      </button>
      <button
        type="button"
        className={`page-tab${activeTab === 'report' ? ' page-tab--active' : ''}`}
        role="tab"
        aria-selected={activeTab === 'report'}
        onClick={() => onChange('report')}
      >
        데일리 리포트
      </button>
    </div>
  );
}

function CareTodayCard({ overview, recentCare, onRefresh, onEmergency }) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshCareStatus = async () => {
    if (refreshing) return;

    setRefreshing(true);

    try {
      await Promise.all([
        Promise.resolve().then(() => onRefresh?.()),
        new Promise((resolve) => setTimeout(resolve, 560)),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="care-today-card" aria-label="오늘의 돌봄 상태" aria-busy={refreshing}>
      <button
        type="button"
        className={`care-today-refresh${refreshing ? ' care-today-refresh--active' : ''}`}
        onClick={refreshCareStatus}
        disabled={refreshing}
        aria-label={refreshing ? '돌봄 상태 새로고침 중' : '돌봄 상태 새로고침'}
      >
        <img src={asset('care-refresh.svg')} alt="" />
      </button>
      <div className="care-today-summary">
        <div className="care-today-copy">
          {onEmergency ? (
            <button
              type="button"
              className="care-today-status care-today-status--interactive"
              onClick={onEmergency}
              aria-label={`${overview.status}: 돌봄 긴급 알림 보기`}
            >
              {overview.status}
            </button>
          ) : (
            <span className="care-today-status">{overview.status}</span>
          )}
          <h2>{overview.message.map((line) => <span key={line}>{line}</span>)}</h2>
          <p>최근 사용 가전: <strong>{overview.lastAppliance}</strong></p>
        </div>
        <img className="care-today-image" src={asset('care-today.png')} alt="" />
      </div>
      <div className="care-today-divider" />
      {expanded && (
        <div className="recent-care-list" id="recent-care-list">
          {recentCare.map((item) => (
            <div className="recent-care-entry" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
              <time>{item.time}</time>
            </div>
          ))}
        </div>
      )}
      {expanded && <div className="care-today-divider" />}
      <button
        type="button"
        className="recent-care-toggle"
        aria-expanded={expanded}
        aria-controls="recent-care-list"
        onClick={() => setExpanded((current) => !current)}
      >
        <span>최근 돌봄 {expanded ? '닫기' : '보기'}</span>
        <img src={asset(expanded ? 'recent-care-up.svg' : 'recent-care-down.svg')} alt="" />
      </button>
    </section>
  );
}

function EmergencyAlertCard({ count, onDetails }) {
  return (
    <section className="care-emergency-card" aria-label={`돌봄 긴급 알림 ${count}건`}>
      <img src={asset('alert-error.svg')} alt="" />
      <h2>확인이 필요한 돌봄 긴급 알림이<br />{count}건 있어요.</h2>
      <button type="button" onClick={onDetails}>자세히 보기</button>
    </section>
  );
}

function CareEmergencyPage({ alert, onBack }) {
  return (
    <div className="neulbom-page neulbom-page--emergency">
      <header className="neulbom-header care-emergency-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="돌봄 관리 화면으로 돌아가기">
          <img src={asset('nav-back.svg')} alt="" />
        </button>
        <h1>돌봄 긴급 알림</h1>
      </header>
      <main className="care-emergency-content">
        <section className="care-emergency-overview" aria-label={`${alert.title} 긴급 알림`}>
          <strong>확인 필요</strong>
          <h2>{alert.title}</h2>
          <p>{alert.description}</p>
        </section>

        <section className="care-emergency-history" aria-labelledby="care-emergency-history-title">
          <h2 id="care-emergency-history-title">대응 이력</h2>
          <div className="care-emergency-history-list">
            {alert.history.map((item) => (
              <div className="care-emergency-history-row" key={item.attempt}>
                <time>{item.time}</time>
                <div>
                  <strong>{item.action}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <div className="care-emergency-call-area">
        <button type="button" className="care-emergency-call">
          <img src={asset('care-emergency-call.svg')} alt="" />
          <span>치매 생활자에게 전화하기</span>
        </button>
      </div>
    </div>
  );
}

function ManagedSummary() {
  return (
    <section className="managed-summary">
      <div className="managed-message">
        <img src={asset('managed-check.svg')} alt="" />
        <p>돌봄 제품의 관리 상태를 확인할 수 있어요.</p>
      </div>
      <div className="managed-metrics">
        <div><span>스마트 진단</span><strong>0</strong></div>
        <div><span>케어 알림</span><strong>0</strong></div>
      </div>
    </section>
  );
}

function SectionTitle({ children }) {
  return <h2 className="care-section-title">{children}</h2>;
}

function CareFeatureList({ onOpenDailyLife, onOpenMealMedication, onOpenCalm }) {
  return (
    <section className="care-section">
      <SectionTitle>돌봄 기능 관리</SectionTitle>
      <div className="care-feature-list">
        {careFeatures.map((feature) => {
          const content = (
            <>
              <div className="care-feature-main">
                <CareIcon feature={feature} />
                <div className="care-feature-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description.map((line) => <span key={line}>{line}</span>)}</p>
                </div>
              </div>
              <img className="row-chevron" src={asset('chevron-right.svg')} alt="" />
            </>
          );

          const onOpen = feature.id === 'daily-life'
            ? onOpenDailyLife
            : feature.id === 'meal-medication'
              ? onOpenMealMedication
              : feature.id === 'calm'
                ? onOpenCalm
                : null;

          if (onOpen) {
            return (
              <button
                type="button"
                className="care-feature-card care-feature-card--enabled"
                onClick={onOpen}
                key={feature.id}
              >
                {content}
              </button>
            );
          }

          return <div className="care-feature-card" key={feature.id}>{content}</div>;
        })}
      </div>
    </section>
  );
}

function DeviceIdentity({ device }) {
  return (
    <div className="device-identity">
      <ApplianceIcon name={device.icon} />
      <div className="device-copy">
        <h3>{device.name}</h3>
        <div className="device-status">
          <img src={asset('status-dot.svg')} alt="" />
          <span>{device.status}</span>
        </div>
      </div>
    </div>
  );
}

function DeviceMetric({ device }) {
  return (
    <div className="device-metric">
      <span>{device.metricLabel}</span>
      <div><strong>{device.value}</strong><em>{device.unit}</em></div>
    </div>
  );
}

function DeviceHistory({ history }) {
  return (
    <div className="device-history">
      {history.map((entry) => (
        <div className="device-history-row" key={`${entry.at}-${entry.value}`}>
          <time>{entry.at}</time>
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function ApplianceCard({ device, expanded, onToggle }) {
  return (
    <article className={`appliance-card${expanded ? ' appliance-card--expanded' : ''}`}>
      <button
        className="appliance-card-toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`${device.id}-history`}
      >
        <div className="appliance-card-main">
          <DeviceIdentity device={device} />
          <DeviceMetric device={device} />
        </div>
        <img className="device-chevron" src={asset(expanded ? 'chevron-up.svg' : 'chevron-down.svg')} alt="" />
      </button>
      {expanded && (
        <div className="device-history-panel" id={`${device.id}-history`}>
          <div className="device-history-divider" />
          <DeviceHistory history={device.history} />
        </div>
      )}
    </article>
  );
}

function ApplianceSection({ devices }) {
  const [expandedDevices, setExpandedDevices] = useState(() => new Set(['purifier', 'refrigerator', 'tv']));

  const toggleDevice = (id) => {
    setExpandedDevices((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <section className="care-section">
      <SectionTitle>제품 사용 현황</SectionTitle>
      <div className="appliance-list">
        <article className="appliance-card appliance-card--hub">
          <div className="hub-content">
            <DeviceIdentity device={{ name: 'ThinQ ON', icon: 'on', status: '정상 작동 중' }} />
            <img className="hub-info" src={asset('info.svg')} alt="제품 정보" />
          </div>
        </article>
        {devices.map((device) => (
          <ApplianceCard
            key={device.id}
            device={device}
            expanded={expandedDevices.has(device.id)}
            onToggle={() => toggleDevice(device.id)}
          />
        ))}
      </div>
    </section>
  );
}

function CustomCareCard({ setting, onOpenVoice, onOpenContent }) {
  const content = (
    <>
      <span className="custom-care-icon" aria-hidden="true">
        <img src={asset(setting.icon)} alt="" />
      </span>
      <div className="custom-care-copy">
        <h3>{setting.title}</h3>
        <p>{setting.description}</p>
      </div>
      <img className="row-chevron" src={asset('chevron-right.svg')} alt="" />
    </>
  );

  const onOpen = setting.id === 'voice' ? onOpenVoice : setting.id === 'content' ? onOpenContent : null;

  if (onOpen) {
    return (
      <button type="button" className="custom-care-card custom-care-card--enabled" onClick={onOpen}>
        {content}
      </button>
    );
  }

  return <div className="custom-care-card">{content}</div>;
}

function CustomCareSection({ onOpenVoice, onOpenContent }) {
  return (
    <section className="care-section">
      <SectionTitle>맞춤 돌봄 설정</SectionTitle>
      <div className="custom-care-list">
        {customCareSettings.map((setting) => (
          <CustomCareCard
            setting={setting}
            onOpenVoice={onOpenVoice}
            onOpenContent={onOpenContent}
            key={setting.id}
          />
        ))}
      </div>
    </section>
  );
}

export default function NeulbomPage({
  onBack,
  onRefreshCare,
  onCheckEmergency,
  onRegisterGuardian,
  onShareGuardians,
  reportHomeId = 'home_23',
  applianceUsage = applianceUsageMock,
  careOverview = careOverviewMock,
  recentCare = recentCareMock,
  emergencyAlerts = [],
}) {
  const [activeTab, setActiveTab] = useState('care');
  const [subPage, setSubPage] = useState('dashboard');
  const [subPageReturn, setSubPageReturn] = useState('dashboard');
  const [showEmergencySummary, setShowEmergencySummary] = useState(false);
  const [showEmergencyDetail, setShowEmergencyDetail] = useState(false);
  const [checkingEmergency, setCheckingEmergency] = useState(false);
  const [mealMedicationSettings, setMealMedicationSettings] = useState(mealMedicationCareMock);
  const [calmCareEnabled, setCalmCareEnabled] = useState(false);
  const [guardians, setGuardians] = useState([]);
  const [guardianStatus, setGuardianStatus] = useState('loading');
  const [guardianError, setGuardianError] = useState('');
  const guardianControllerRef = useRef(null);

  const refreshGuardians = useCallback(() => {
    guardianControllerRef.current?.abort();
    const controller = new AbortController();
    guardianControllerRef.current = controller;
    setGuardianStatus('loading');
    setGuardianError('');
    return loadCaregivers(fetch, reportHomeId, { signal: controller.signal })
      .then((items) => {
        setGuardians(items);
        setGuardianStatus('ready');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setGuardians([]);
        setGuardianStatus('error');
        setGuardianError(error.message || '보호자 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (guardianControllerRef.current === controller) guardianControllerRef.current = null;
      });
  }, [reportHomeId]);

  useEffect(() => {
    refreshGuardians();
    return () => guardianControllerRef.current?.abort();
  }, [refreshGuardians]);

  const openSubPage = (page, returnTo = 'dashboard') => {
    setSubPageReturn(returnTo);
    setSubPage(page);
  };

  const registerGuardian = async (guardian) => {
    const savedGuardian = onRegisterGuardian
      ? await onRegisterGuardian(guardian)
      : await saveCaregiver(fetch, reportHomeId, guardian);
    setGuardians((current) => [
      ...current.filter((item) => item.id !== savedGuardian.id),
      savedGuardian,
    ]);
    setGuardianStatus('ready');
    setGuardianError('');
    setSubPage('report-share');
  };

  const latestEmergency = emergencyAlerts[0] || null;

  const openEmergencySummary = async () => {
    if (checkingEmergency) return;
    if (latestEmergency) {
      setShowEmergencySummary(true);
      return;
    }
    if (!onCheckEmergency) return;
    setCheckingEmergency(true);
    try {
      const refreshed = await onCheckEmergency();
      if (refreshed?.emergencyAlerts?.length) setShowEmergencySummary(true);
    } finally {
      setCheckingEmergency(false);
    }
  };

  useEffect(() => {
    if (!latestEmergency) {
      setShowEmergencySummary(false);
      setShowEmergencyDetail(false);
    }
  }, [latestEmergency]);

  if (showEmergencyDetail && latestEmergency) {
    return <CareEmergencyPage alert={latestEmergency} onBack={() => setShowEmergencyDetail(false)} />;
  }

  if (subPage === 'voice') {
    return <VoiceTrainingPage onBack={() => setSubPage(subPageReturn)} />;
  }

  if (subPage === 'content') {
    return <PreferredContentPage onBack={() => setSubPage(subPageReturn)} />;
  }

  if (subPage === 'daily-life') {
    return <DailyLifeCarePage onBack={() => setSubPage('dashboard')} />;
  }

  if (subPage === 'meal-medication') {
    return (
      <MealMedicationCarePage
        onBack={() => setSubPage('dashboard')}
        settings={mealMedicationSettings}
        onSettingsChange={setMealMedicationSettings}
      />
    );
  }

  if (subPage === 'calm') {
    return (
      <CalmCarePage
        onBack={() => setSubPage('dashboard')}
        enabled={calmCareEnabled}
        onEnabledChange={setCalmCareEnabled}
        onOpenVoice={() => openSubPage('voice', 'calm')}
        onOpenContent={() => openSubPage('content', 'calm')}
      />
    );
  }

  if (subPage === 'report-share') {
    return (
      <ReportSharePage
        guardians={guardians}
        status={guardianStatus}
        error={guardianError}
        onBack={() => setSubPage('dashboard')}
        onAddGuardian={() => setSubPage('guardian-registration')}
        onRetry={refreshGuardians}
        onShare={onShareGuardians}
      />
    );
  }

  if (subPage === 'guardian-registration') {
    return (
      <GuardianRegistrationPage
        onBack={() => setSubPage('report-share')}
        onRegister={registerGuardian}
      />
    );
  }

  const displayedCareOverview = {
    ...careOverview,
    status: '돌봄 중',
    lastAppliance: '냉장고',
  };

  return (
    <div className="neulbom-page">
      <PageHeader onBack={onBack} />
      <div className="neulbom-content">
        <PageTabs activeTab={activeTab} onChange={setActiveTab} />
        {activeTab === 'care' ? (
          <div className="care-content tab-panel tab-panel--care" key="care">
            {showEmergencySummary && latestEmergency ? (
              <EmergencyAlertCard
                count={emergencyAlerts.length}
                onDetails={() => setShowEmergencyDetail(true)}
              />
            ) : (
              <CareTodayCard
                overview={displayedCareOverview}
                recentCare={recentCare}
                onRefresh={onRefreshCare}
                onEmergency={latestEmergency || onCheckEmergency ? openEmergencySummary : undefined}
              />
            )}
            <ManagedSummary />
            <CareFeatureList
              onOpenDailyLife={() => setSubPage('daily-life')}
              onOpenMealMedication={() => setSubPage('meal-medication')}
              onOpenCalm={() => setSubPage('calm')}
            />
            <ApplianceSection devices={applianceUsage} />
            <CustomCareSection
              onOpenVoice={() => openSubPage('voice')}
              onOpenContent={() => openSubPage('content')}
            />
          </div>
        ) : (
          <div className="tab-panel tab-panel--report" key="report">
            <DailyReport onShare={() => setSubPage('report-share')} />
          </div>
        )}
      </div>
    </div>
  );
}
