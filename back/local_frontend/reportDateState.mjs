import { defaultReportDate, reportDateNavigation, shiftIsoDate } from './reportDate.mjs';
import { SERVER_DATE_ERROR_MESSAGE } from './serverDateApi.mjs';

export const initialReportDateState = Object.freeze({
  dateStatus: 'loading',
  dateError: null,
  serverToday: null,
  reportDate: null,
  reportDateTouched: false,
});

export function reportDateReducer(state, action) {
  if (action.type === 'refresh-started') {
    return { ...state, dateStatus: 'loading', dateError: null };
  }
  if (action.type === 'server-date-loaded') {
    const reportDate = state.reportDateTouched && state.reportDate
      ? (state.reportDate > action.today ? action.today : state.reportDate)
      : defaultReportDate(action.today);
    return {
      ...state,
      dateStatus: 'ready',
      dateError: null,
      serverToday: action.today,
      reportDate,
    };
  }
  if (action.type === 'server-date-failed') {
    return {
      ...state,
      dateStatus: 'error',
      dateError: action.message || SERVER_DATE_ERROR_MESSAGE,
    };
  }
  if (action.type === 'shift-report-date') {
    if (state.dateStatus !== 'ready' || !state.reportDate || !state.serverToday) return state;
    const reportDate = shiftIsoDate(state.reportDate, action.days, state.serverToday);
    if (reportDate === state.reportDate) return state;
    return { ...state, reportDate, reportDateTouched: true };
  }
  return state;
}

export function reportDateControls(state) {
  if (state.dateStatus !== 'ready') return { canGoPrevious: false, canGoNext: false };
  return reportDateNavigation(state.reportDate, state.serverToday);
}
