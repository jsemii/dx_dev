import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { initialReportDateState, reportDateControls, reportDateReducer } from './reportDateState.mjs';
import { loadServerDate } from './serverDateApi.mjs';

const ReportDateContext = createContext(null);

export function ReportDateProvider({ children }) {
  const [state, dispatch] = useReducer(reportDateReducer, initialReportDateState);
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const refreshServerDate = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    controllerRef.current = controller;
    dispatch({ type: 'refresh-started' });
    return loadServerDate(fetch, { signal: controller.signal })
      .then((today) => {
        if (requestId === requestIdRef.current) {
          dispatch({ type: 'server-date-loaded', today });
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && requestId === requestIdRef.current) {
          dispatch({ type: 'server-date-failed', message: error.message });
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) controllerRef.current = null;
      });
  }, []);

  useEffect(() => {
    refreshServerDate();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshServerDate();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [refreshServerDate]);

  const value = useMemo(() => ({
    ...state,
    ...reportDateControls(state),
    shiftReportDate: (days) => dispatch({ type: 'shift-report-date', days }),
    refreshServerDate,
  }), [refreshServerDate, state]);
  return <ReportDateContext.Provider value={value}>{children}</ReportDateContext.Provider>;
}

export function useReportDate() {
  const value = useContext(ReportDateContext);
  if (!value) throw new Error('ReportDateProvider 안에서 사용해야 합니다.');
  return value;
}
