import { conflict } from '../errors.js';
import { findAngerExpression } from './angerDetectionService.js';
import { parseYouTubeUrl } from '../validation.js';

export class AngerAnalysisService {
  constructor({ safetyCareRepository, preferredContentRepository, transcriptionService, playbackClient }) {
    this.safetyCareRepository = safetyCareRepository;
    this.preferredContentRepository = preferredContentRepository;
    this.transcriptionService = transcriptionService;
    this.playbackClient = playbackClient;
  }

  async analyze({ homeId, buffer, format }) {
    const setting = await this.safetyCareRepository.getOrDefault(homeId);
    if (!setting.enabled) {
      throw conflict('safety_care_disabled', '안정 돌봄이 사용 중이 아닙니다.');
    }

    // A recording must never incur STT cost when no browser Player can receive the result.
    await this.playbackClient.assertReady(homeId);
    const transcript = await this.transcriptionService.transcribe(buffer, format);
    const matched = findAngerExpression(transcript, setting.angerExpressions);
    if (!matched) {
      return { status: 'NOT_DETECTED', detected: false, transcript, can_resume: true };
    }

    const currentSetting = await this.safetyCareRepository.getOrDefault(homeId);
    if (!currentSetting.enabled) {
      throw conflict('safety_care_disabled', '안정 돌봄이 중지되었습니다.');
    }
    // The Player can disconnect during STT, so verify again before any content lookup.
    await this.playbackClient.assertReady(homeId);
    const content = await this.preferredContentRepository.randomYoutube(homeId);
    if (!content) {
      throw conflict('youtube_content_required', '선호 YouTube 콘텐츠를 먼저 등록해 주세요.');
    }
    if (!parseYouTubeUrl(content.contentUrl)) {
      throw conflict('invalid_stored_youtube_url', '저장된 YouTube 링크를 재생할 수 없습니다.');
    }
    const playback = await this.playbackClient.requestPlayback({ homeId, content });
    return {
      status: 'DETECTED',
      detected: true,
      transcript,
      playback: {
        requested: true,
        request_id: playback.requestId,
        content_id: content.contentId,
        content_name: content.contentName,
      },
    };
  }
}
