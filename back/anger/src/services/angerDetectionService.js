export function normalizeSpeech(text = '') {
  return String(text).toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function findAngerExpression(text, expressions) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;
  return expressions.find((expression) => {
    const candidate = normalizeSpeech(expression);
    return candidate && normalized.includes(candidate);
  }) || null;
}
