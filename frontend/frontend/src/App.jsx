import { useState } from 'react';
import NeulbomPage from './NeulbomPage.jsx';

const asset = (name) => `/assets/${name}`;

const productManagementItems = [
  { label: '스마트 진단', icon: 'diagnosis' },
  { label: '제품 정보와 보증', icon: 'product-info' },
  { label: '제품 사용설명서', icon: 'manual' },
  { label: 'LG전자 구독', icon: 'subscription' },
];

const appItems = [
  { label: 'ThinQ 늘봄', icon: 'neulbom', enabled: true },
  { label: 'ThinQ PLAY', icon: 'play' },
  { label: '스마트 루틴', icon: 'routine' },
  { label: 'ThinQ 활용하기', icon: 'guide' },
];

function SpriteIcon({ name }) {
  return <span className={`menu-icon menu-icon--${name}`} aria-hidden="true" />;
}

function StatusBar() {
  return (
    <div className="status-bar" aria-label="상태 표시줄">
      <div className="status-time">10:00</div>
      <div className="status-levels" aria-hidden="true">
        <img src={asset('status-cellular.svg')} alt="" />
        <img src={asset('status-wifi.svg')} alt="" />
        <img className="status-battery" src={asset('status-battery.svg')} alt="" />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="app-header">
      <h1>LG ThinQ</h1>
      <div className="header-icons" aria-hidden="true">
        <img src={asset('header-plus.svg')} alt="" />
        <img src={asset('header-settings.svg')} alt="" />
      </div>
    </header>
  );
}

function HouseholdHeader() {
  return (
    <header className="household-header">
      <div className="household-title">
        <h1>우리집</h1>
        <img src={asset('home-chevron-down.svg')} alt="" />
      </div>
      <div className="household-actions" aria-hidden="true">
        <img src={asset('home-add.svg')} alt="" />
        <img src={asset('home-notification.svg')} alt="" />
        <img src={asset('home-more.svg')} alt="" />
      </div>
    </header>
  );
}

function CareHeader() {
  return (
    <header className="care-main-header">
      <h1>9월 리포트</h1>
    </header>
  );
}

function QuickMenu() {
  return (
    <div className="quick-menu" aria-label="빠른 메뉴">
      <div className="quick-menu-card">
        <SpriteIcon name="mypage" />
        <span>마이페이지</span>
      </div>
      <div className="quick-menu-card">
        <SpriteIcon name="support" />
        <span>고객 지원</span>
      </div>
    </div>
  );
}

function EventCard() {
  return (
    <article className="event-card">
      <div className="event-photo" aria-hidden="true">
        <img src={asset('event-photo.png')} alt="" />
      </div>
      <div className="event-copy">
        <h2>LG전자 DX School 6기 성과발표회</h2>
        <p>6개월 간 열심히 한 나 자신 고생했습니다!</p>
        <time>2026. 04. 07. ~ 2026. 10. 02.</time>
      </div>
    </article>
  );
}

function MenuRow({ item, onNeulbom }) {
  const content = (
    <>
      <SpriteIcon name={item.icon} />
      <span>{item.label}</span>
    </>
  );

  if (item.enabled) {
    return (
      <button className="menu-row menu-row--enabled" type="button" onClick={onNeulbom}>
        {content}
      </button>
    );
  }

  return <div className="menu-row">{content}</div>;
}

function MenuSection({ title, items, onNeulbom }) {
  return (
    <section className="menu-section">
      <h2>{title}</h2>
      <div className="menu-card">
        {items.map((item, index) => (
          <div className="menu-entry" key={item.label}>
            <MenuRow item={item} onNeulbom={onNeulbom} />
            {index < items.length - 1 && <div className="menu-divider" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function MenuScreen({ onNeulbom }) {
  return (
    <>
      <Header />
      <div className="main-tab-body main-tab-body--scrollable">
        <div className="screen-body">
          <div className="overview">
            <QuickMenu />
            <EventCard />
          </div>
          <div className="menu-groups">
            <MenuSection title="제품 사용과 관리" items={productManagementItems} />
            <MenuSection
              title="제품 및 앱 활용"
              items={appItems}
              onNeulbom={onNeulbom}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function ProductPreview({ variant }) {
  return (
    <div className={`home-product-preview home-product-preview--${variant}`} aria-hidden="true">
      <div className="home-product-source">
        <img src={asset('home-products.png')} alt="" />
      </div>
    </div>
  );
}

function HomeScreen() {
  return (
    <>
      <HouseholdHeader />
      <div className="main-tab-body main-tab-body--fixed home-main-body">
        <section className="home-promo-card home-promo-card--connect">
          <ProductPreview variant="products" />
          <div className="home-promo-copy">
            <p>ThinQ와 함께하는 스마트 홈,<br />제품을 연결해 새로운 일상을 만나보세요.</p>
            <button type="button">더 알아보기</button>
          </div>
        </section>

        <section className="home-promo-card home-promo-card--view">
          <ProductPreview variant="view" />
          <div className="home-promo-copy">
            <p>3D 홈뷰로 우리집과 제품의 실시간<br />상태를 한눈에 확인해보세요.</p>
            <button type="button">3D 홈뷰 만들기</button>
          </div>
        </section>

        <h2 className="home-section-title home-section-title--favorite">즐겨 찾는 제품</h2>
        <section className="home-favorite-empty">
          <p>제품을 추가하고 즐겨 찾는 제품으로 배치하면 홈 화면에서<br />바로 사용할 수 있어요.</p>
          <button type="button">
            <img src={asset('home-add-circle.svg')} alt="" />
            <span>제품 추가</span>
          </button>
        </section>

        <section className="home-play-banner">
          <img src={asset('home-thinq-play.png')} alt="" />
          <div>
            <strong>ThinQ PLAY</strong>
            <span>앱을 다운로드하여 제품과 공간을 업그레이드 해보세요.</span>
          </div>
        </section>

        <div className="home-routine-heading">
          <h2>스마트 루틴</h2>
          <img src={asset('home-next.svg')} alt="" />
        </div>
        <button type="button" className="home-routine-card">
          <img src={asset('home-routine.svg')} alt="" />
          <span>루틴 알아보기</span>
        </button>
      </div>
    </>
  );
}

function DeviceScreen() {
  return (
    <>
      <HouseholdHeader />
      <div className="main-tab-body main-tab-body--fixed captured-tab-body captured-tab-body--device">
        <img src={asset('device-body.png')} alt="제품 추가 안내 화면" />
      </div>
    </>
  );
}

function CareScreen() {
  return (
    <>
      <CareHeader />
      <div className="main-tab-body main-tab-body--fixed captured-tab-body captured-tab-body--care">
        <img src={asset('care-body.png')} alt="제품 케어 리포트 화면" />
      </div>
    </>
  );
}

const navigationItems = [
  { id: 'home', label: '홈' },
  { id: 'device', label: '디바이스' },
  { id: 'care', label: '케어' },
  { id: 'menu', label: '메뉴' },
];

function BottomNavigation({ activeTab, onSelect }) {
  return (
    <nav className="bottom-navigation" aria-label="주요 메뉴">
      {navigationItems.map((item) => {
        const active = item.id === activeTab;
        return (
          <button
            type="button"
            className={active ? 'bottom-navigation-item bottom-navigation-item--active' : 'bottom-navigation-item'}
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
            key={item.id}
          >
            <img src={asset(`nav-${item.id}-${active ? 'active' : 'inactive'}.svg`)} alt="" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [screen, setScreen] = useState('menu');

  const renderMainTab = () => {
    if (screen === 'home') return <HomeScreen />;
    if (screen === 'device') return <DeviceScreen />;
    if (screen === 'care') return <CareScreen />;
    return <MenuScreen onNeulbom={() => setScreen('neulbom')} />;
  };

  return (
    <main className="app-shell">
      <StatusBar />
      {screen === 'neulbom' ? (
        <div className="screen-scroll" key={screen}>
          <NeulbomPage onBack={() => setScreen('menu')} />
        </div>
      ) : (
        <div className="main-tabs">
          {renderMainTab()}
          <BottomNavigation activeTab={screen} onSelect={setScreen} />
        </div>
      )}
    </main>
  );
}
