import { useEffect, useState } from 'react';
import TeamPreferredContentPage from '../../frontend/frontend/src/PreferredContentPage.jsx';
import { DEFAULT_HOME_ID } from './bridgeData.mjs';
import { contentApiError, contentSaveError } from './contentUploadErrors.mjs';

const CONTENT_ID_PATTERN = /^(image|youtube)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function contentIdentity(content) {
  const match = CONTENT_ID_PATTERN.exec(content?.id || '');
  if (!match || match[1] !== content.type) throw new Error('콘텐츠 ID가 올바르지 않습니다.');
  return { type: match[1], itemId: match[2] };
}

export default function LocalPreferredContentPage({ onBack }) {
  const [result, setResult] = useState({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ home_id: DEFAULT_HOME_ID });
    fetch(`/api/content?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`목록 조회 실패 (HTTP ${response.status})`);
        return response.json();
      })
      .then((body) => {
        if (!Array.isArray(body?.contents)) throw new Error('목록 응답 형식이 올바르지 않습니다.');
        body.contents.forEach(contentIdentity);
        setResult({ kind: 'ready', contents: body.contents });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setResult({ kind: 'error', message: error.message });
      });
    return () => controller.abort();
  }, [retry]);

  async function saveContent(content) {
    let response;
    if (content.type === 'image') {
      const form = new FormData();
      form.set('home_id', DEFAULT_HOME_ID);
      form.set('name', content.name);
      form.set('file', content.file);
      response = await fetch('/api/content/images', { method: 'POST', body: form });
    } else if (content.type === 'youtube') {
      response = await fetch('/api/content/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId: DEFAULT_HOME_ID, name: content.name, sourceUrl: content.sourceUrl }),
      });
    } else {
      throw new Error('지원하지 않는 콘텐츠 종류입니다.');
    }
    if (!response.ok) throw await contentSaveError(response);
    const saved = await response.json();
    contentIdentity(saved);
    return saved;
  }

  async function updateContent(content) {
    const { type, itemId } = contentIdentity(content);
    const response = await fetch(`/api/content/items/${type}/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home_id: DEFAULT_HOME_ID, name: content.name }),
    });
    if (!response.ok) throw await contentApiError(response, '수정');
    const saved = await response.json();
    const savedIdentity = contentIdentity(saved);
    if (savedIdentity.type !== type || savedIdentity.itemId !== itemId) {
      throw new Error('콘텐츠 저장 결과가 올바르지 않습니다.');
    }
    return saved;
  }

  async function deleteContent(content) {
    const { type, itemId } = contentIdentity(content);
    const params = new URLSearchParams({ home_id: DEFAULT_HOME_ID });
    const response = await fetch(`/api/content/items/${type}/${itemId}?${params}`, { method: 'DELETE' });
    if (!response.ok) throw await contentApiError(response, '삭제');
  }

  if (result.kind !== 'ready') {
    return (
      <div className="preferred-content-page" style={{ padding: '24px' }}>
        <button type="button" onClick={onBack}>← 뒤로</button>
        <p role="status">{result.kind === 'loading' ? '선호 콘텐츠 조회 중...' : result.message}</p>
        {result.kind === 'error' && (
          <button type="button" onClick={() => {
            setResult({ kind: 'loading' });
            setRetry((current) => current + 1);
          }}>다시 조회</button>
        )}
      </div>
    );
  }

  // Mount only after GET completes: the teammate page copies `contents` into state once.
  return <TeamPreferredContentPage onBack={onBack} contents={result.contents}
    onSubmitContent={saveContent} onUpdateContent={updateContent} onDeleteContent={deleteContent} />;
}
