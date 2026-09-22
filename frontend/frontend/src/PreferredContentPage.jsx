import { useEffect, useRef, useState } from 'react';
import { registeredContentMock } from './data/preferredContentData.js';
import './preferred-content.css';

const asset = (name) => `/assets/${name}`;

function PreferredContentHeader({ title, onBack, onDelete }) {
  return (
    <header className="preferred-content-header">
      <button type="button" onClick={onBack} aria-label="이전 화면으로 돌아가기">
        <img src={asset('nav-back.svg')} alt="" />
      </button>
      <h1>{title}</h1>
      {onDelete && (
        <button className="preferred-content-header-delete" type="button" onClick={onDelete} aria-label="콘텐츠 삭제">
          <img src={asset('delete-red.svg')} alt="" />
        </button>
      )}
    </header>
  );
}

function ContentThumbnail({ content, large = false }) {
  const source = content.previewUrl || content.thumbnailUrl;

  return (
    <div className={large ? 'content-thumbnail content-thumbnail--large' : 'content-thumbnail'}>
      {source && <img src={source} alt="" />}
    </div>
  );
}

function RegisteredContents({ contents, onSelectContent }) {
  return (
    <section className="registered-contents">
      <h2>등록된 콘텐츠</h2>
      <div className="registered-content-list">
        {contents.map((content, index) => (
          <div className="registered-content-entry" key={content.id}>
            <button type="button" className="registered-content-row" onClick={() => onSelectContent(content)}>
              <div className="registered-content-main">
                <ContentThumbnail content={content} />
                <span>{content.name}</span>
              </div>
              <img className="registered-content-chevron" src={asset('chevron-right.svg')} alt="" />
            </button>
            {index < contents.length - 1 && <div className="registered-content-divider" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function ContentOverview({ contents, onChooseImage, onChooseYoutube, onSelectContent }) {
  return (
    <div className="preferred-content-overview">
      <section className="preferred-content-intro">
        <div className="preferred-content-hero" aria-hidden="true">
          <img src={asset('preferred-content-hero.png')} alt="" />
        </div>
        <div className="preferred-content-guide">
          <div className="preferred-content-copy">
            <h2>평소 좋아하는 음악과 영상을 등록해<br />맞춤형 돌봄 콘텐츠를 준비해보세요.</h2>
            <p>익숙하고 좋아하는 콘텐츠는<br />안정과 정서적 편안함을 도와드려요.</p>
          </div>
          <div className="content-source-actions">
            <button type="button" onClick={onChooseImage}>
              <img src={asset('content-image-upload.svg')} alt="" />
              <span>이미지 업로드</span>
            </button>
            <button type="button" onClick={onChooseYoutube}>
              <span className="youtube-upload-icon" aria-hidden="true">
                <img src={asset('content-youtube.png')} alt="" />
              </span>
              <span>유튜브 링크 업로드</span>
            </button>
          </div>
        </div>
      </section>
      <RegisteredContents contents={contents} onSelectContent={onSelectContent} />
    </div>
  );
}

function parseYoutubeVideoId(value) {
  const normalized = value.trim();
  if (!normalized) return null;

  try {
    const candidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;

    if (url.pathname === '/watch') return url.searchParams.get('v');
    const [kind, videoId] = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(kind)) return videoId || null;
  } catch {
    return null;
  }

  return null;
}

function YoutubeLinkDialog({ open, onClose, onSubmit }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setLink('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    const videoId = parseYoutubeVideoId(link);
    if (!videoId) {
      setError('올바른 유튜브 링크를 입력해주세요.');
      return;
    }
    onSubmit({
      type: 'youtube',
      sourceUrl: link.trim(),
      youtubeVideoId: videoId,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  };

  return (
    <div className="youtube-link-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="youtube-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-link-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="youtube-link-dialog-copy">
          <h2 id="youtube-link-title">유튜브 링크 등록</h2>
          <p>등록할 영상의 유튜브 링크를 입력해주세요.</p>
        </div>
        <label>
          <span>유튜브 링크</span>
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
              setError('');
            }}
            placeholder="https://youtu.be/..."
            autoFocus
          />
        </label>
        {error && <p className="youtube-link-error" role="alert">{error}</p>}
        <div className="youtube-link-dialog-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="submit" disabled={!link.trim()}>등록하기</button>
        </div>
      </form>
    </div>
  );
}

function ContentRegistration({ draft, name, onNameChange, onBack, onSave, isSaving, error }) {
  const isYoutube = draft.type === 'youtube';

  return (
    <div className="preferred-content-register-page">
      <PreferredContentHeader title="선호 콘텐츠 등록하기" onBack={onBack} />
      <div className="preferred-content-register-body">
        <section className="preferred-content-register-card">
          <div className="preferred-content-upload-result">
            <h2>{isYoutube ? '유튜브 링크가 업로드 되었어요.' : '이미지가 업로드 되었어요.'}</h2>
            <ContentThumbnail content={draft} large />
          </div>
          <label className="preferred-content-name-field">
            <span>콘텐츠 이름 설정</span>
            <input
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={isYoutube ? '예: 좋아하는 음악' : '예: 가족 사진'}
              maxLength={30}
              autoComplete="off"
            />
          </label>
          {error && <p className="preferred-content-save-error" role="alert">{error}</p>}
        </section>
      </div>
      <div className="preferred-content-bottom-action">
        <button type="button" onClick={onSave} disabled={!name.trim() || isSaving}>
          {isSaving ? '저장 중...' : '콘텐츠 저장하기'}
        </button>
      </div>
    </div>
  );
}

function ContentDetail({ content, onBack, onSave, onDelete }) {
  const [name, setName] = useState(content.name);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      await onSave({ ...content, name: trimmedName });
    } catch {
      setError('콘텐츠 정보를 저장하지 못했어요. 다시 시도해주세요.');
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      await onDelete(content);
    } catch {
      setError('콘텐츠를 삭제하지 못했어요. 다시 시도해주세요.');
      setIsSaving(false);
    }
  };

  return (
    <div className="preferred-content-detail-page">
      <PreferredContentHeader title="콘텐츠 수정하기" onBack={onBack} onDelete={remove} />
      <div className="preferred-content-detail-body">
        <section className="preferred-content-detail-card">
          <ContentThumbnail content={content} large />
          <label className="preferred-content-name-field">
            <span>콘텐츠 이름</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={30}
              autoComplete="off"
            />
          </label>
          {error && <p className="preferred-content-save-error" role="alert">{error}</p>}
        </section>
      </div>
      <div className="preferred-content-detail-actions">
        <button type="button" onClick={onBack} disabled={isSaving}>취소</button>
        <button type="button" onClick={save} disabled={!name.trim() || isSaving}>
          {isSaving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

export default function PreferredContentPage({
  onBack,
  contents = registeredContentMock,
  onSubmitContent,
  onUpdateContent,
  onDeleteContent,
}) {
  const [registeredContents, setRegisteredContents] = useState(contents);
  const [draft, setDraft] = useState(null);
  const [contentName, setContentName] = useState('');
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [selectedContent, setSelectedContent] = useState(null);
  const fileInputRef = useRef(null);
  const objectUrlsRef = useRef(new Set());

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0 });
  }, [draft, selectedContent]);

  const openDraft = (nextDraft) => {
    setDraft(nextDraft);
    setContentName('');
    setSaveError('');
  };

  const handleImageSelected = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;

    const previewUrl = URL.createObjectURL(file);
    objectUrlsRef.current.add(previewUrl);
    openDraft({ type: 'image', file, previewUrl });
  };

  const discardDraft = () => {
    if (draft?.type === 'image' && draft.previewUrl) {
      URL.revokeObjectURL(draft.previewUrl);
      objectUrlsRef.current.delete(draft.previewUrl);
    }
    setDraft(null);
    setContentName('');
    setSaveError('');
  };

  const saveContent = async () => {
    const name = contentName.trim();
    if (!draft || !name || isSaving) return;

    setIsSaving(true);
    setSaveError('');
    const content = {
      ...draft,
      id: `content-${Date.now()}`,
      name,
    };

    try {
      await onSubmitContent?.(content);
      setRegisteredContents((current) => [content, ...current]);
      setDraft(null);
      setContentName('');
    } catch {
      setSaveError('콘텐츠를 저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  };

  if (draft) {
    return (
      <ContentRegistration
        draft={draft}
        name={contentName}
        onNameChange={setContentName}
        onBack={discardDraft}
        onSave={saveContent}
        isSaving={isSaving}
        error={saveError}
      />
    );
  }

  if (selectedContent) {
    return (
      <ContentDetail
        content={selectedContent}
        onBack={() => setSelectedContent(null)}
        onSave={async (updatedContent) => {
          await onUpdateContent?.(updatedContent);
          setRegisteredContents((current) => current.map((content) => (
            content.id === updatedContent.id ? updatedContent : content
          )));
          setSelectedContent(null);
        }}
        onDelete={async (contentToDelete) => {
          await onDeleteContent?.(contentToDelete);
          setRegisteredContents((current) => current.filter((content) => content.id !== contentToDelete.id));
          setSelectedContent(null);
        }}
      />
    );
  }

  return (
    <div className="preferred-content-page">
      <PreferredContentHeader title="선호 콘텐츠" onBack={onBack} />
      <input
        ref={fileInputRef}
        className="preferred-content-file-input"
        type="file"
        accept="image/*"
        onChange={handleImageSelected}
      />
      <ContentOverview
        contents={registeredContents}
        onChooseImage={() => fileInputRef.current?.click()}
        onChooseYoutube={() => setYoutubeDialogOpen(true)}
        onSelectContent={setSelectedContent}
      />
      <YoutubeLinkDialog
        open={youtubeDialogOpen}
        onClose={() => setYoutubeDialogOpen(false)}
        onSubmit={(youtubeDraft) => {
          setYoutubeDialogOpen(false);
          openDraft(youtubeDraft);
        }}
      />
    </div>
  );
}
