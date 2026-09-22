const upstreamCatch = `} catch {
      setSaveError('콘텐츠를 저장하지 못했어요. 다시 시도해주세요.');
    }`;

export function forwardContentSaveError(source) {
  if (!source.includes(upstreamCatch)) {
    throw new Error('팀원 선호 콘텐츠 저장 오류 처리 코드가 변경됐습니다. 로컬 연결을 확인하세요.');
  }
  let result = source.replace(upstreamCatch, `} catch (error) {
      setSaveError(error?.message || '콘텐츠를 저장하지 못했어요. 다시 시도해주세요.');
    }`);
  const optimisticInsert = `await onSubmitContent?.(content);
      setRegisteredContents((current) => [content, ...current]);`;
  if (!result.includes(optimisticInsert)) {
    throw new Error('팀원 선호 콘텐츠 추가 코드가 변경됐습니다. 로컬 연결을 확인하세요.');
  }
  result = result.replace(optimisticInsert, `const savedContent = await onSubmitContent?.(content);
      setRegisteredContents((current) => [savedContent || content, ...current]);`);
  const deleteWithoutConfirmation = `const remove = async () => {
    if (isSaving) return;`;
  if (!result.includes(deleteWithoutConfirmation)) {
    throw new Error('팀원 선호 콘텐츠 삭제 코드가 변경됐습니다. 로컬 연결을 확인하세요.');
  }
  return result.replace(deleteWithoutConfirmation, `const remove = async () => {
    if (isSaving || !window.confirm('이 콘텐츠를 영구 삭제할까요?')) return;`);
}

export async function contentApiError(response, action = '요청') {
  const body = await response.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message : '';
  const knownMessage = (response.status === 400 && /^(이미지|JPEG|콘텐츠|가정 ID)/.test(message))
    || (response.status === 404 && /^해당 가정의 콘텐츠/.test(message))
    || (response.status === 413 && /^이미지/.test(message))
    || (response.status === 503 && /^(이미지 저장소|선호 콘텐츠 저장소)/.test(message));
  const safeMessage = knownMessage
    ? message.slice(0, 120)
    : '서버 응답을 확인해주세요.';
  return new Error(`콘텐츠 ${action} 실패 (HTTP ${response.status}): ${safeMessage}`);
}

export const contentSaveError = (response) => contentApiError(response, '저장');
