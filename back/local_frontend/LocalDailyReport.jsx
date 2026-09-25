import { useEffect, useState } from 'react';
import TeamDailyReport from '../../frontend/frontend/src/DailyReport.jsx';
import { useReportDate } from './ReportDateContext.jsx';
import { mapDailyReport, reportPlaceholder } from './reportTransform.mjs';

export default function LocalDailyReport({ onShare }) {
  const { reportDate, shiftReportDate } = useReportDate();
  const [result, setResult] = useState({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setResult({ kind: 'loading' });
    fetch('/api/v1/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'one_person', report_date: reportDate, force: false }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`리포트 조회 실패 (HTTP ${response.status})`);
        return response.json();
      })
      .then((body) => setResult({ kind: 'ready', report: mapDailyReport(body) }))
      .catch((error) => {
        if (error.name !== 'AbortError') setResult({ kind: 'error', message: error.message });
      });
    return () => controller.abort();
  }, [reportDate]);

  const report = result.kind === 'ready'
    ? result.report
    : reportPlaceholder(reportDate, result.kind === 'loading' ? '리포트를 불러오고 있어요.' : result.message);

  return <TeamDailyReport report={report} onDateChange={shiftReportDate} onShare={onShare} />;
}
