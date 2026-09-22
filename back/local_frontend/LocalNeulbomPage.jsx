import { useEffect, useState } from 'react';
import TeamNeulbomPage from '../../frontend/frontend/src/NeulbomPage.jsx';
import { applianceUsageMock } from '../../frontend/frontend/src/data/neulbomData.js';
import { REPORT_HOME_ID, mapApplianceData, pendingCards, selectSupportedCards } from './bridgeData.mjs';
import { ReportDateProvider, useReportDate } from './ReportDateContext.jsx';

const supportedCards = selectSupportedCards(applianceUsageMock);

function ConnectedNeulbomPage({ onBack }) {
  const { reportDate } = useReportDate();
  const [result, setResult] = useState({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ home_id: REPORT_HOME_ID, date: reportDate });
    setResult({ kind: 'loading' });
    fetch(`/api/appliances/daily?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API 조회 실패 (HTTP ${response.status})`);
        return response.json();
      })
      .then((body) => setResult({ kind: 'ready', cards: mapApplianceData(body, supportedCards) }))
      .catch((error) => {
        if (error.name !== 'AbortError') setResult({ kind: 'error', message: error.message });
      });
    return () => controller.abort();
  }, [reportDate]);

  const cards = result.kind === 'ready' ? result.cards
    : pendingCards(supportedCards, result.kind === 'loading' ? '조회 중' : '조회 실패');

  return <TeamNeulbomPage onBack={onBack} applianceUsage={cards} />;
}

export default function LocalNeulbomPage({ onBack }) {
  return (
    <ReportDateProvider>
      <ConnectedNeulbomPage onBack={onBack} />
    </ReportDateProvider>
  );
}
