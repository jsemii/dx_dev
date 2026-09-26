import { useCallback, useEffect, useRef, useState } from 'react';
import TeamNeulbomPage from '../../frontend/frontend/src/NeulbomPage.jsx';
import { applianceUsageMock } from '../../frontend/frontend/src/data/neulbomData.js';
import { dashboardPlaceholder, mapCareDashboard, REPORT_HOME_ID, selectSupportedCards } from './bridgeData.mjs';
import { loadCareDashboard } from './careDashboardApi.mjs';
import { ReportDateProvider, useReportDate } from './ReportDateContext.jsx';

const supportedCards = selectSupportedCards(applianceUsageMock);

function ConnectedNeulbomPage({ onBack }) {
  const { reportDate } = useReportDate();
  const [result, setResult] = useState({ kind: 'loading' });
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const refreshPromiseRef = useRef(null);

  const requestDashboard = useCallback(({ showLoading = true } = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    controllerRef.current = controller;
    if (showLoading) setResult({ kind: 'loading' });
    return loadCareDashboard(fetch, REPORT_HOME_ID, reportDate, { signal: controller.signal })
      .then((body) => {
        if (requestId === requestIdRef.current) setResult({ kind: 'ready', view: mapCareDashboard(body, supportedCards) });
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && requestId === requestIdRef.current) {
          setResult({ kind: 'error', message: error.message });
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) controllerRef.current = null;
      });
  }, [reportDate]);

  useEffect(() => {
    requestDashboard();
    return () => controllerRef.current?.abort();
  }, [requestDashboard]);

  const refreshDashboard = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const promise = requestDashboard({ showLoading: false }).finally(() => {
      if (refreshPromiseRef.current === promise) refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = promise;
    return promise;
  }, [requestDashboard]);

  const view = result.kind === 'ready' ? result.view : dashboardPlaceholder(supportedCards, result.kind);

  return (
    <TeamNeulbomPage
      onBack={onBack}
      applianceUsage={view.cards}
      applianceUsageResetKey={reportDate}
      careOverview={view.overview}
      recentCare={view.recentCare}
      onRefreshCare={refreshDashboard}
      careStatusAriaLabel={`${reportDate} 돌봄 상태`}
    />
  );
}

export default function LocalNeulbomPage({ onBack }) {
  return (
    <ReportDateProvider>
      <ConnectedNeulbomPage onBack={onBack} />
    </ReportDateProvider>
  );
}
