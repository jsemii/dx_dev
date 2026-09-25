import './daily-life-care.css';

const asset = (name) => `/assets/${name}`;

const careFeatures = [
  {
    id: 'rhythm',
    title: '하루 리듬 되찾기',
    description: <>달라진 낮과 밤,<br />집이 다시 하루의 흐름을 맞춰드려요.</>,
    image: 'daily-life-rhythm.png',
  },
  {
    id: 'next-action',
    title: '다음 행동 이어가기',
    description: <>멈춘 순간에도 익숙한 일상을<br />자연스럽게 이어가도록 도와드려요.</>,
    image: 'daily-life-next-action.png',
  },
  {
    id: 'wayfinding',
    title: '이동 길잡이',
    description: <>방향이 헷갈리는 순간,<br />연결 가전으로 익숙한 길을 안내해드려요.</>,
    image: 'daily-life-wayfinding.png',
  },
];

export default function DailyLifeCarePage({ onBack }) {
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

        <section className="daily-life-care-features" aria-labelledby="daily-life-care-features-title">
          <h2 id="daily-life-care-features-title">이런 걸 할 수 있어요.</h2>
          <div className="daily-life-care-feature-list">
            {careFeatures.map((feature) => (
              <article className={`daily-life-care-feature daily-life-care-feature--${feature.id}`} key={feature.id}>
                <div className="daily-life-care-feature-copy">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
                <div className="daily-life-care-feature-image" aria-hidden="true">
                  <img src={asset(feature.image)} alt="" />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
