import { dailyReportMock } from './data/dailyReportData.js';

const asset = (name) => `/assets/${name}`;

function DateSelector({ date, onDateChange }) {
  return (
    <div className="report-date-selector" aria-label="리포트 날짜">
      <button type="button" onClick={() => onDateChange?.(-1)} aria-label="이전 날짜">
        <img src={asset('date-previous.svg')} alt="" />
      </button>
      <time>{date}</time>
      <button type="button" onClick={() => onDateChange?.(1)} aria-label="다음 날짜">
        <img src={asset('date-next.svg')} alt="" />
      </button>
    </div>
  );
}

function ReportSummary({ summary }) {
  return (
    <section className="report-summary">
      <h2>오늘 하루 요약</h2>
      <p>{summary}</p>
    </section>
  );
}

function LifeTimeline({ entries }) {
  return (
    <section className="report-section">
      <h2>오늘의 생활 흐름</h2>
      <div className="report-timeline">
        {entries.map((entry) => (
          <div className="report-timeline-row" key={entry.id}>
            <time>{entry.time}</time>
            <span>{entry.description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportChanges({ changes }) {
  return (
    <section className="report-section">
      <h2>평소와 다른 점</h2>
      <div className="report-change-list">
        {changes.map((change) => (
          <article className="report-change-card" key={change.id}>
            <h3>{change.title}</h3>
            <p>{change.average}</p>
            <p>{change.current}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function DailyReport({ report = dailyReportMock, onDateChange, onShare }) {
  return (
    <div className="daily-report">
      <DateSelector date={report.date} onDateChange={onDateChange} />
      <ReportSummary summary={report.summary} />
      <LifeTimeline entries={report.timeline || []} />
      <ReportChanges changes={report.changes || []} />
      <button type="button" className="report-share-button" onClick={() => onShare?.(report)}>
        <img src={asset('share.svg')} alt="" />
        <span>공유하기</span>
      </button>
    </div>
  );
}
