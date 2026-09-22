import { useEffect, useRef, useState } from 'react';
import {
  recordingScript,
  voiceSamplePhrases,
  voiceSteps,
} from '../../frontend/frontend/src/data/voiceTrainingData.js';
import { DEFAULT_HOME_ID } from './bridgeData.mjs';
import '../../frontend/frontend/src/voice-training.css';
import './local-voice.css';

const asset = (name) => `/assets/${name}`;

function VoiceHeader({ onBack, title = '맞춤 목소리', onDelete }) {
  return (
    <header className="voice-header">
      <button type="button" onClick={onBack} aria-label="이전 화면으로 돌아가기">
        <img src={asset('nav-back.svg')} alt="" />
      </button>
      <h1>{title}</h1>
      {onDelete && (
        <button className="voice-header-delete" type="button" onClick={onDelete} aria-label="목소리 삭제">
          <img src={asset('delete-red.svg')} alt="" />
        </button>
      )}
    </header>
  );
}

function VoiceOverview({ voices, onRegister, onSelectVoice, message }) {
  return (
    <div className="voice-overview">
      <section className="voice-intro-card">
        <div className="voice-family-image" aria-hidden="true">
          <img src={asset('voice-family.png')} alt="" />
        </div>
        <div className="voice-intro-copy">
          <h2>가족의 익숙한 목소리를 등록해<br />더욱 친근한 돌봄 환경을 만들어보세요.</h2>
          <p>목소리를 등록하면 가족의 음성으로<br />다양한 돌봄 안내를 들려드릴 수 있어요.</p>
        </div>
        <button type="button" className="voice-secondary-button" onClick={onRegister}>
          목소리 등록하기
        </button>
      </section>

      <section className="registered-voices">
        <h2>등록된 목소리</h2>
        <div className="registered-voice-list">
          {message && <p role="status" className="local-voice-message">{message}</p>}
          {!message && voices.length === 0 && <p className="local-voice-message">아직 등록된 목소리가 없어요.</p>}
          {voices.map((voice, index) => (
            <div className="registered-voice-entry" key={voice.id}>
              <button type="button" className="registered-voice-row" onClick={() => onSelectVoice(voice)}>
                <span>{voice.name}{voice.requiresVerification ? ' · 추가 인증 필요' : ''}</span>
                <img src={asset('chevron-right.svg')} alt="" />
              </button>
              {index < voices.length - 1 && <div className="registered-voice-divider" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StepProgress({ activeStep }) {
  return (
    <ol className="voice-step-progress" aria-label={`목소리 등록 ${activeStep}단계`}>
      {voiceSteps.map((step) => {
        const active = step.id === activeStep;
        return (
          <li className={active ? 'voice-step voice-step--active' : 'voice-step'} key={step.id}>
            <img
              src={asset(`voice-step-${step.id}-${active ? 'active' : 'inactive'}.svg`)}
              alt={`${step.id}단계`}
            />
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StartStep({ consent, onConsent }) {
  return (
    <section className="voice-start-card">
      <h2>목소리를 녹음할 준비가 되었나요?</h2>
      <div>
        <h3>원할한 목소리 학습을 위해 아래 사항을 주의해주세요.</h3>
        <ul>
          <li>조용한 곳에서 녹음해주세요.</li>
          <li>평소 말하는 목소리 톤으로 말해주세요.</li>
          <li>1분 가량의 녹음이 필요하며 천천히, 또렷하게 말해주세요.</li>
        </ul>
      </div>
      <label className="local-voice-consent">
        <input type="checkbox" checked={consent} onChange={(event) => onConsent(event.target.checked)} />
        녹음본을 목소리 등록을 위해 ElevenLabs에 전송하는 데 동의합니다.
      </label>
    </section>
  );
}

function formatSeconds(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function AudioControl({ mode, seconds, isRecording, isPlaying, onToggle, disabled }) {
  const isRecordMode = mode === 'record';
  const isActive = isRecordMode ? isRecording : isPlaying;
  return (
    <div className="voice-audio-control">
      <button
        type="button"
        className={`voice-audio-button${isRecording ? ' voice-audio-button--recording' : ''}${isPlaying ? ' voice-audio-button--playing' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label={isRecordMode ? (isRecording ? '녹음 중지' : '녹음 시작') : (isPlaying ? '녹음본 재생 중지' : '녹음본 재생')}
        aria-pressed={isActive}
      >
        {isPlaying
          ? <span className="voice-stop-large" aria-hidden="true" />
          : <img src={asset(isRecordMode ? 'voice-microphone.svg' : 'voice-play-large.svg')} alt="" />}
      </button>
      <div className="voice-timer"><strong>{formatSeconds(seconds)}</strong><span>/</span><strong>01:00</strong></div>
      <p>{isRecordMode ? '1분을 넘기면 자동으로 중단돼요.' : '재생 버튼을 통해 녹음본을 확인해주세요.'}</p>
    </div>
  );
}

function RecordStep({ seconds, isRecording, onToggle, disabled }) {
  return (
    <div className="voice-record-step">
      <AudioControl mode="record" seconds={seconds} isRecording={isRecording} onToggle={onToggle} disabled={disabled} />
      <section className="voice-script-section">
        <h2>마이크 버튼을 누르고 아래 대본을 천천히 또박또박 읽어주세요.</h2>
        <div className="voice-script-card">
          {recordingScript.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </section>
    </div>
  );
}

function ReviewStep({ seconds, isPlaying, onReplay, onRetry }) {
  return (
    <div className="voice-review-step">
      <AudioControl mode="play" seconds={seconds} isPlaying={isPlaying} onToggle={onReplay} />
      <section className="voice-review-card">
        <div>
          <h2>녹음이 완료되었어요.</h2>
          <p>목소리가 또렷하고 자연스럽게 들리는지 확인해주세요.<br />마음에 들지 않는 경우, 아래 버튼을 통해 다시 녹음할 수 있어요.</p>
        </div>
        <button type="button" className="voice-secondary-button" onClick={onRetry}>다시 녹음하기</button>
      </section>
    </div>
  );
}

function CompleteStep({
  voiceName,
  onVoiceNameChange,
  onPreviewSample,
  requiresVerification,
  playingPhrase,
  previewBusy,
}) {
  return (
    <section className="voice-complete-card">
      <div>
        <h2>{requiresVerification ? '목소리 추가 인증이 필요해요.' : '목소리 등록이 완료되었어요.'}</h2>
        <p>{requiresVerification ? '인증이 끝나기 전에는 돌봄 안내에 사용할 수 없어요.' : '이제 등록된 목소리로 돌봄 안내를 할 수 있어요.'}</p>
      </div>
      <label className="voice-name-field">
        <span>목소리 이름 설정</span>
        <input
          type="text"
          value={voiceName}
          onChange={(event) => onVoiceNameChange(event.target.value)}
          placeholder="예: 딸 목소리"
          maxLength={20}
          autoComplete="off"
        />
      </label>
      <div className="voice-sample-list">
        {voiceSamplePhrases.map((phrase) => {
          const isPlaying = playingPhrase === phrase;
          return (
            <button type="button" key={phrase} disabled={requiresVerification || previewBusy}
              onClick={() => onPreviewSample?.(phrase)}
              aria-label={`${phrase} ${isPlaying ? '재생 중지' : '재생'}`} aria-pressed={isPlaying}>
              {isPlaying
                ? <span className="voice-stop-small" aria-hidden="true" />
                : <img src={asset('voice-play-small.svg')} alt="" />}
              <span>{phrase}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

async function apiResponse(response) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || `음성 API 요청 실패 (HTTP ${response.status})`);
}

function VoiceDetail({ voice, onBack, onUpdated, onDeleted }) {
  const [name, setName] = useState(voice.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playingPhrase, setPlayingPhrase] = useState('');
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setPlayingPhrase('');
  };

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const previewSample = async (phrase) => {
    if (voice.requiresVerification || busy) return;
    if (playingPhrase === phrase) {
      stopAudio();
      return;
    }
    let text = phrase.replace(/[“”]/g, '');
    if (phrase === '직접 입력하기') {
      text = window.prompt('재생할 문장을 입력해주세요 (500자 이내)', '')?.trim() || '';
    }
    if (!text) return;
    setBusy(true);
    setError('');
    stopAudio();
    try {
      const response = await apiResponse(await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.voiceId, text }),
      }));
      audioUrlRef.current = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrlRef.current);
      audioRef.current = audio;
      audio.onended = stopAudio;
      setPlayingPhrase(phrase);
      await audio.play();
    } catch (cause) {
      stopAudio();
      setError(cause.message || '목소리 미리듣기에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiResponse(await fetch(
        `/api/voice/registered/${encodeURIComponent(voice.voiceId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeId: DEFAULT_HOME_ID, name: trimmedName }),
        },
      ));
      const updated = await response.json();
      onUpdated({ ...updated, id: updated.voiceId });
    } catch (cause) {
      setError(cause.message || '목소리 정보를 저장하지 못했습니다.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !window.confirm('이 목소리를 ElevenLabs와 WiFi Care에서 영구 삭제할까요?')) return;
    setBusy(true);
    setError('');
    stopAudio();
    try {
      const params = new URLSearchParams({ home_id: DEFAULT_HOME_ID });
      await apiResponse(await fetch(
        `/api/voice/registered/${encodeURIComponent(voice.voiceId)}?${params}`,
        { method: 'DELETE' },
      ));
      onDeleted(voice.voiceId);
    } catch (cause) {
      setError(cause.message || '목소리를 삭제하지 못했습니다.');
      setBusy(false);
    }
  };

  return (
    <div className="voice-detail-page">
      <VoiceHeader title="목소리 수정하기" onBack={busy ? undefined : onBack} onDelete={remove} />
      <div className="voice-detail-body">
        <section className="voice-detail-card">
          <div className="voice-sample-list">
            {voiceSamplePhrases.map((phrase) => {
              const isPlaying = playingPhrase === phrase;
              return (
                <button type="button" key={phrase} onClick={() => previewSample(phrase)}
                  disabled={voice.requiresVerification || busy}
                  aria-label={`${phrase} ${isPlaying ? '재생 중지' : '재생'}`} aria-pressed={isPlaying}>
                  {isPlaying
                    ? <span className="voice-stop-small" aria-hidden="true" />
                    : <img src={asset('voice-play-small.svg')} alt="" />}
                  <span>{phrase}</span>
                </button>
              );
            })}
          </div>
          <label className="voice-name-field">
            <span>목소리 이름</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)}
              maxLength={20} autoComplete="off" disabled={busy} />
          </label>
          {voice.requiresVerification && <p className="voice-detail-error">추가 인증 전에는 미리듣기를 사용할 수 없어요.</p>}
          {error && <p className="voice-detail-error" role="alert">{error}</p>}
        </section>
      </div>
      <div className="voice-detail-actions">
        <button type="button" onClick={onBack} disabled={busy}>취소</button>
        <button type="button" onClick={save} disabled={!name.trim() || busy}>
          {busy ? '처리 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

function VoiceFlow({ onExit, onSaved }) {
  const [step, setStep] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(null);
  const [registered, setRegistered] = useState(null);
  const [voiceName, setVoiceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isReviewPlaying, setIsReviewPlaying] = useState(false);
  const [playingPhrase, setPlayingPhrase] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const leavingRef = useRef(false);
  const recordSessionRef = useRef(0);
  const [recordStarting, setRecordStarting] = useState(false);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const releaseAudio = () => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  };

  const stopPlayback = () => {
    releaseAudio();
    setIsReviewPlaying(false);
    setPlayingPhrase('');
  };

  useEffect(() => {
    // StrictMode runs setup → cleanup → setup in development. The second
    // setup must make this live again or getUserMedia resolves into a discard.
    leavingRef.current = false;

    return () => {
      leavingRef.current = true;
      recordSessionRef.current += 1;
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      releaseStream();
      releaseAudio();
    };
  }, []);

  useEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0 });
  }, [step]);

  const stopRecording = (discard = false) => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      if (discard) recorder.onstop = () => releaseStream();
      recorder.stop();
    } else {
      releaseStream();
    }
    setIsRecording(false);
  };

  useEffect(() => {
    if (!isRecording) return undefined;
    const timer = window.setInterval(() => {
      const elapsed = Math.min(60, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setSeconds(elapsed);
      if (elapsed >= 60) stopRecording();
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const startRecording = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('이 브라우저에서 마이크 녹음을 사용할 수 없습니다.');
      return;
    }
    const attempt = ++recordSessionRef.current;
    setRecordStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (leavingRef.current || attempt !== recordSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      releaseAudio();
      setRecording(null);
      setSeconds(0);
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        releaseStream();
        setIsRecording(false);
        if (leavingRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const duration = Math.min(60, Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
        setSeconds(duration);
        if (blob.size === 0) setError('녹음된 소리가 없습니다. 다시 녹음해주세요.');
        else setRecording(blob);
      };
      startedAtRef.current = Date.now();
      recorder.start(250);
      setIsRecording(true);
    } catch {
      if (leavingRef.current || attempt !== recordSessionRef.current) return;
      releaseStream();
      setError('마이크 권한을 허용하고 다시 시도해주세요.');
    } finally {
      if (!leavingRef.current && attempt === recordSessionRef.current) setRecordStarting(false);
    }
  };

  const replay = async () => {
    if (!recording) return;
    if (isReviewPlaying) {
      stopPlayback();
      return;
    }
    try {
      stopPlayback();
      audioUrlRef.current = URL.createObjectURL(recording);
      const audio = new Audio(audioUrlRef.current);
      audioRef.current = audio;
      const finish = () => {
        if (audioRef.current !== audio) return;
        releaseAudio();
        setIsReviewPlaying(false);
      };
      audio.onended = finish;
      audio.onerror = finish;
      setIsReviewPlaying(true);
      await audio.play();
    } catch {
      stopPlayback();
      setError('녹음본을 재생하지 못했습니다.');
    }
  };

  const resetRecording = () => {
    stopPlayback();
    setRecording(null);
    setSeconds(0);
    setError('');
    setStep(2);
  };

  const previewSample = async (phrase) => {
    if (!registered?.voiceId || registered.requiresVerification || busy || previewBusy) return;
    if (playingPhrase === phrase) {
      stopPlayback();
      return;
    }
    let text = phrase.replace(/[“”]/g, '');
    if (phrase === '직접 입력하기') {
      text = window.prompt('재생할 문장을 입력해주세요 (500자 이내)', '')?.trim() || '';
    }
    if (!text) return;
    setPreviewBusy(true);
    setError('');
    stopPlayback();
    try {
      const response = await apiResponse(await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: registered.voiceId, text }),
      }));
      audioUrlRef.current = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrlRef.current);
      audioRef.current = audio;
      const finish = () => {
        if (audioRef.current !== audio) return;
        releaseAudio();
        setPlayingPhrase('');
      };
      audio.onended = finish;
      audio.onerror = finish;
      setPlayingPhrase(phrase);
      await audio.play();
    } catch (cause) {
      stopPlayback();
      setError(cause.message || '목소리 미리듣기에 실패했습니다.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const goBack = () => {
    if (busy || previewBusy) return;
    setError('');
    stopPlayback();
    if (step === 1) onExit();
    else {
      if (step === 4) { onExit(); return; }
      if (step === 2) {
        recordSessionRef.current += 1;
        setRecordStarting(false);
        if (isRecording) stopRecording(true);
      }
      setStep((current) => current - 1);
    }
  };

  const goNext = async () => {
    setError('');
    if (step === 1) {
      if (!consent) { setError('음성 전송에 동의해야 등록할 수 있습니다.'); return; }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!recording || isRecording) { setError('녹음을 마친 뒤 다음 단계로 이동해주세요.'); return; }
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!recording || busy) return;
      stopPlayback();
      setBusy(true);
      try {
        const body = new FormData();
        body.append('home_id', DEFAULT_HOME_ID);
        body.append('name', '새 목소리');
        body.append('file', recording, recording.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
        const response = await apiResponse(await fetch('/api/voice/clone', { method: 'POST', body }));
        const voice = await response.json();
        if (!voice.voiceId) throw new Error('등록된 목소리 ID가 없습니다.');
        setRegistered(voice);
        setStep(4);
      } catch (cause) {
        setError(cause.message || '목소리 등록에 실패했습니다.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!voiceName.trim() || !registered?.voiceId || busy || previewBusy) return;
    stopPlayback();
    setBusy(true);
    try {
      await apiResponse(await fetch(`/api/voice/registered/${encodeURIComponent(registered.voiceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId: DEFAULT_HOME_ID, name: voiceName.trim() }),
      }));
      onSaved();
    } catch (cause) {
      setError(cause.message || '목소리 이름 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="voice-flow">
      <VoiceHeader onBack={goBack} title="맞춤 목소리 등록하기" />
      <div className="voice-flow-content">
        <StepProgress activeStep={step} />
        {step === 1 && <StartStep consent={consent} onConsent={setConsent} />}
        {step === 2 && (
          <RecordStep
            seconds={seconds}
            isRecording={isRecording}
            onToggle={() => (isRecording ? stopRecording() : startRecording())}
            disabled={recordStarting}
          />
        )}
        {step === 3 && (
          <ReviewStep seconds={seconds} isPlaying={isReviewPlaying} onReplay={replay} onRetry={resetRecording} />
        )}
        {step === 4 && (
          <CompleteStep
            voiceName={voiceName}
            onVoiceNameChange={setVoiceName}
            onPreviewSample={previewSample}
            requiresVerification={registered?.requiresVerification}
            playingPhrase={playingPhrase}
            previewBusy={previewBusy}
          />
        )}
        {error && <p role="alert" className="local-voice-error">{error}</p>}
      </div>
      <div className="voice-bottom-action">
        <button type="button" onClick={goNext}
          disabled={busy || previewBusy || (step === 1 && !consent) || (step === 2 && (isRecording || recordStarting || !recording))
            || (step === 4 && !voiceName.trim())}>
          {busy || previewBusy ? '처리 중...' : step === 4 ? '목소리 저장하기' : step === 3 ? '녹음 사용하기' : '다음 단계로'}
        </button>
      </div>
    </div>
  );
}

export default function LocalVoiceTrainingPage({ onBack }) {
  const [mode, setMode] = useState('overview');
  const [registeredVoices, setRegisteredVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [message, setMessage] = useState('등록된 목소리를 조회 중이에요.');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/voice/registered?home_id=${encodeURIComponent(DEFAULT_HOME_ID)}`,
      { signal: controller.signal })
      .then(apiResponse)
      .then((response) => response.json())
      .then((voices) => {
        setRegisteredVoices(voices.map((voice) => ({ ...voice, id: voice.voiceId })));
        setMessage('');
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setMessage(cause.message || '등록된 목소리를 조회하지 못했습니다.');
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    document.querySelector('.screen-scroll')?.scrollTo({ top: 0 });
  }, [mode]);

  if (mode === 'flow') {
    return <VoiceFlow onExit={() => { setMode('overview'); setRevision((value) => value + 1); }}
      onSaved={() => { setMode('overview'); setRevision((value) => value + 1); }} />;
  }

  if (mode === 'detail' && selectedVoice) {
    return <VoiceDetail
      voice={selectedVoice}
      onBack={() => { setSelectedVoice(null); setMode('overview'); }}
      onUpdated={(updated) => {
        setRegisteredVoices((current) => current.map((voice) => (
          voice.voiceId === updated.voiceId ? updated : voice
        )));
        setSelectedVoice(null);
        setMode('overview');
      }}
      onDeleted={(voiceId) => {
        setRegisteredVoices((current) => current.filter((voice) => voice.voiceId !== voiceId));
        setSelectedVoice(null);
        setMode('overview');
      }}
    />;
  }

  return (
    <div className="voice-page">
      <VoiceHeader onBack={onBack} />
      <VoiceOverview voices={registeredVoices} message={message} onRegister={() => setMode('flow')}
        onSelectVoice={(voice) => { setSelectedVoice(voice); setMode('detail'); }} />
    </div>
  );
}
