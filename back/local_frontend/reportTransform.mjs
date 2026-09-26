import { formatKoreanDate } from './reportDate.mjs';

export function sanitizeReportText(value) {
  const withoutReferences = String(value || '')
    .replace(/\s*\([^)]*(?:row(?:_id)?|행)\s*\d+[^)]*\)/gi, '')
    .replace(/\brow(?:_id)?\s*\d+(?:\s*[,;]\s*row(?:_id)?\s*\d+)*/gi, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return (withoutReferences.match(/[^.!?]+[.!?]?/g) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => !/(행동\s*이벤트\s*수|원본\s*행\s*수|레코드\s*수|metric_code)/i.test(sentence))
    .join(' ');
}

export function mapDailyReport(response) {
  if (!response?.content || !Array.isArray(response.content.timeline)
      || !Array.isArray(response.content.highlights)
      || typeof response.report_date !== 'string'
      || typeof response.content.summary !== 'string') {
    throw new Error('데일리 리포트 API 응답 형식이 올바르지 않습니다.');
  }
  return {
    date: formatKoreanDate(response.report_date),
    summary: sanitizeReportText(response.content.summary),
    timeline: response.content.timeline.map((entry, index) => {
      const title = sanitizeReportText(entry.title);
      const description = sanitizeReportText(entry.description);
      // description은 서버가 확정한 화면 문장이다. title은 문장이 없을 때만 사용해
      // 같은 생활 사건을 두 번 표시하지 않는다.
      const visibleText = description || title;
      return {
        id: `timeline-${index}-${entry.time}`,
        time: entry.time,
        description: visibleText,
      };
    }),
    changes: response.content.highlights.map((entry, index) => ({
      id: `highlight-${index}`,
      title: sanitizeReportText(entry.title),
      average: sanitizeReportText(entry.baseline || entry.description),
      current: sanitizeReportText(entry.today),
    })),
  };
}

export function reportPlaceholder(isoDate, message) {
  return { date: formatKoreanDate(isoDate), summary: message, timeline: [], changes: [] };
}
