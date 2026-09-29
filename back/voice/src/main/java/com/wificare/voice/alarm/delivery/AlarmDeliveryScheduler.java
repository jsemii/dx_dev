package com.wificare.voice.alarm.delivery;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.service.ElevenLabsTextToSpeechService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AlarmDeliveryScheduler {
    private static final Logger log = LoggerFactory.getLogger(AlarmDeliveryScheduler.class);
    private static final String AUDIO_MIME_TYPE = "audio/mpeg";
    private static final Map<String, String> PHRASES = Map.of(
            "MEAL", "밥 먹어요",
            "MEDICATION", "약 먹어요");
    private static final Set<String> RETRYABLE_PLAYBACK_CODES = Set.of(
            "PLAYBACK_NOT_READY", "PLAYER_BUSY", "PLAYER_OFFLINE");

    private final AlarmDeliveryRepository deliveries;
    private final VoiceProfileRepository voices;
    private final ElevenLabsTextToSpeechService textToSpeech;
    private final AlarmPlaybackPort playback;
    private final AlarmDeliveryProperties properties;
    private final Clock clock;

    public AlarmDeliveryScheduler(AlarmDeliveryRepository deliveries, VoiceProfileRepository voices,
            ElevenLabsTextToSpeechService textToSpeech, AlarmPlaybackPort playback,
            AlarmDeliveryProperties properties, Clock clock) {
        this.deliveries = deliveries;
        this.voices = voices;
        this.textToSpeech = textToSpeech;
        this.playback = playback;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${alarm.delivery.scan-interval-ms:5000}")
    public void scan() {
        if (!properties.enabled()) return;
        Instant now = clock.instant();
        Instant windowStart = now.minus(properties.grace());
        try {
            deliveries.expirePendingBefore(windowStart);
            deliveries.discoverDue(windowStart, now, AlarmDeliveryProperties.KST);
            deliveries.claimNext(windowStart, now).ifPresent(delivery -> execute(delivery, now));
        } catch (RuntimeException error) {
            log.warn("Alarm delivery scan failed: code=DELIVERY_SCAN_FAILED");
        }
    }

    void execute(AlarmDelivery delivery, Instant now) {
        String phrase = PHRASES.get(delivery.alarmType());
        if (phrase == null) {
            deliveries.fail(delivery.deliveryId(), "UNSUPPORTED_ALARM_TYPE");
            return;
        }
        RegisteredVoice voice;
        try {
            voice = voices.findLatestVerified(delivery.residentThinQId()).orElse(null);
        } catch (RuntimeException error) {
            deliveries.fail(delivery.deliveryId(), "VOICE_STORE_FAILED");
            log.warn("Alarm delivery failed: delivery_id={}, code=VOICE_STORE_FAILED",
                    delivery.deliveryId());
            return;
        }
        if (voice == null) {
            deliveries.fail(delivery.deliveryId(), "NO_VERIFIED_VOICE");
            log.info("Alarm delivery skipped: delivery_id={}, code=NO_VERIFIED_VOICE",
                    delivery.deliveryId());
            return;
        }
        if (!playback.isReady(delivery.residentThinQId())) {
            retryOrFail(delivery, now, "PLAYBACK_NOT_READY");
            return;
        }

        byte[] audio;
        try {
            audio = textToSpeech.generateSpeech(voice.voiceId(), phrase);
        } catch (RuntimeException error) {
            deliveries.fail(delivery.deliveryId(), "TTS_FAILED");
            log.warn("Alarm delivery failed: delivery_id={}, code=TTS_FAILED", delivery.deliveryId());
            return;
        }
        if (audio == null || audio.length < 1 || audio.length > properties.maxAudioBytes()) {
            deliveries.fail(delivery.deliveryId(),
                    audio != null && audio.length > properties.maxAudioBytes()
                            ? "AUDIO_TOO_LARGE" : "INVALID_AUDIO_DATA");
            return;
        }

        deliveries.markSent(delivery.deliveryId());
        try {
            AlarmPlaybackResult result = playback.play(
                    delivery.residentThinQId(), delivery.alarmId(), delivery.requestId(), audio, AUDIO_MIME_TYPE);
            if (result.startedAt() == null && !"COMPLETED".equals(result.status())) {
                retryOrFail(delivery, now, result.failureCode());
                return;
            }
            deliveries.recordPlaybackOutcome(delivery, result);
        } catch (AlarmPlaybackException error) {
            deliveries.fail(delivery.deliveryId(), error.code());
            log.warn("Alarm playback request failed: delivery_id={}, code={}",
                    delivery.deliveryId(), error.code());
        } catch (RuntimeException error) {
            retryOrFail(delivery, now, "PLAYBACK_REQUEST_FAILED");
            log.warn("Alarm playback request failed: delivery_id={}, code=PLAYBACK_REQUEST_FAILED",
                    delivery.deliveryId());
        }
    }

    private void retryOrFail(AlarmDelivery delivery, Instant now, String failureCode) {
        if (!RETRYABLE_PLAYBACK_CODES.contains(failureCode)) {
            deliveries.fail(delivery.deliveryId(), "PLAYBACK_FAILED");
            return;
        }
        String safeCode = failureCode;
        if (!now.isAfter(delivery.scheduledFor().plus(properties.grace()))) {
            deliveries.retry(delivery.deliveryId(), safeCode);
        } else {
            deliveries.fail(delivery.deliveryId(), safeCode);
        }
    }
}
