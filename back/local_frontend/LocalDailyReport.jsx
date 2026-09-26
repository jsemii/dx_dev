import { useEffect, useState } from 'react';
import TeamDailyReport from '../../frontend/frontend/src/DailyReport.jsx';
import { REPORT_HOME_ID } from './bridgeData.mjs';
import { loadDailyReport } from './dailyReportApi.mjs';
import { useReportDate } from './ReportDateContext.jsx';
import { mapDailyReport, reportPlaceholder } from './reportTransform.mjs';

export default function LocalDailyReport({ onShare }) {
  const { reportDate, shiftReportDate } = useReportDate();
  const [result, setResult] = useState({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setResult({ kind: 'loading' });
    loadDailyReport(fetch, REPORT_HOME_ID, reportDate)
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
  }, [reportDate]);

  const report = result.kind === 'ready'
    ? result.report
    : reportPlaceholder(reportDate, result.kind === 'loading' ? '리포트를 불러오고 있어요.' : result.message);

  return <TeamDailyReport report={report} onDateChange={shiftReportDate} onShare={onShare} />;
}
