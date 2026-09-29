import { useEffect, useState } from 'react';
import TeamDailyReport from '../../frontend/frontend/src/DailyReport.jsx';
import { REPORT_HOME_ID } from './bridgeData.mjs';
import { loadDailyReport } from './dailyReportApi.mjs';
import { useReportDate } from './ReportDateContext.jsx';
import { mapDailyReport, reportPlaceholder } from './reportTransform.mjs';

export default function LocalDailyReport({ onShare }) {
  const {
    reportDate,
    serverToday,
    dateStatus,
    dateError,
    canGoPrevious,
    canGoNext,
    shiftReportDate,
  } = useReportDate();
  const [result, setResult] = useState({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    if (dateStatus !== 'ready' || !reportDate || !serverToday) {
      setResult(dateStatus === 'error'
        ? { kind: 'date-error', message: dateError }
        : { kind: 'loading' });
      return () => { active = false; };
    }
    setResult({ kind: 'loading' });
    loadDailyReport(fetch, REPORT_HOME_ID, reportDate, serverToday)
      .then((response) => {
        if (!active) return;
        if (response.kind === 'ready') {
          setResult({ kind: 'ready', report: mapDailyReport(response.body) });
          return;
        }
        setResult({ kind: response.kind, message: response.message });
      })
      .catch((error) => {
        if (active) setResult({ kind: 'error', message: error.message });
      });
    return () => { active = false; };
  }, [dateError, dateStatus, reportDate, serverToday]);

  const report = result.kind === 'ready'
    ? result.report
    : reportDate
      ? reportPlaceholder(reportDate, result.kind === 'loading' ? '리포트를 불러오고 있어요.' : result.message)
      : { date: '날짜 확인 필요', summary: result.message || '서버 날짜를 불러오고 있어요.', timeline: [], changes: [] };

  return (
    <TeamDailyReport
      report={report}
      onDateChange={shiftReportDate}
      canGoPrevious={canGoPrevious}
      canGoNext={canGoNext}
      onShare={onShare}
    />
  );
}
