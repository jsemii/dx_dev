import { useCallback, useEffect, useRef, useState } from 'react';
import TeamNeulbomPage from '../../frontend/frontend/src/NeulbomPage.jsx';
import { applianceUsageMock } from '../../frontend/frontend/src/data/neulbomData.js';
import { dashboardPlaceholder, mapCareDashboard, REPORT_HOME_ID, selectSupportedCards } from './bridgeData.mjs';
import { loadCareDashboard } from './careDashboardApi.mjs';
import { ReportDateProvider, useReportDate } from './ReportDateContext.jsx';

const supportedCards = selectSupportedCards(applianceUsageMock);

function ConnectedNeulbomPage({ onBack }) {
  const { serverToday, dateStatus, dateError } = useReportDate();
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
    return loadCareDashboard(fetch, REPORT_HOME_ID, serverToday, { signal: controller.signal })
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
  }, [serverToday]);

  useEffect(() => {
    if (dateStatus !== 'ready' || !serverToday) {
      controllerRef.current?.abort();
      setResult(dateStatus === 'error'
        ? { kind: 'date-error', message: dateError }
        : { kind: 'loading' });
      return undefined;
    }
    requestDashboard();
    return () => controllerRef.current?.abort();
  }, [dateError, dateStatus, requestDashboard, serverToday]);

  const refreshDashboard = useCallback(() => {
    if (dateStatus !== 'ready' || !serverToday) return Promise.resolve();
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const promise = requestDashboard({ showLoading: false }).finally(() => {
      if (refreshPromiseRef.current === promise) refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = promise;
    return promise;
  }, [dateStatus, requestDashboard, serverToday]);

  const view = result.kind === 'ready'
    ? result.view
    : dashboardPlaceholder(supportedCards, result.kind, result.message);

  return (
    <TeamNeulbomPage
      onBack={onBack}
      applianceUsage={view.cards}
      applianceUsageResetKey={serverToday || 'server-date-unavailable'}
      careOverview={view.overview}
      recentCare={view.recentCare}
      onRefreshCare={refreshDashboard}
      careStatusAriaLabel={serverToday ? `${serverToday} 돌봄 상태` : '서버 날짜 확인 실패'}
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
