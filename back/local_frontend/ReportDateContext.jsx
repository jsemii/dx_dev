import { createContext, useContext, useMemo, useState } from 'react';
import { DEFAULT_DATE } from './bridgeData.mjs';
import { shiftIsoDate } from './reportDate.mjs';

const ReportDateContext = createContext(null);

export function ReportDateProvider({ children }) {
  const [reportDate, setReportDate] = useState(DEFAULT_DATE);
  const value = useMemo(() => ({
    reportDate,
    shiftReportDate: (days) => setReportDate((current) => shiftIsoDate(current, days)),
  }), [reportDate]);
  return <ReportDateContext.Provider value={value}>{children}</ReportDateContext.Provider>;
}

export function useReportDate() {
  const value = useContext(ReportDateContext);
  if (!value) throw new Error('ReportDateProvider 안에서 사용해야 합니다.');
  return value;
}
