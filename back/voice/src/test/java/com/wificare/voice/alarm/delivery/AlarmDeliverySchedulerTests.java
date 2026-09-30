package com.wificare.voice.alarm.delivery;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.service.ElevenLabsTextToSpeechService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AlarmDeliverySchedulerTests {
    private static final Instant NOW = Instant.parse("2026-09-30T00:00:30Z");
    private static final UUID DELIVERY_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID ALARM_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID REQUEST_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");

    private final AlarmDeliveryRepository deliveries = mock(AlarmDeliveryRepository.class);
    private final VoiceProfileRepository voices = mock(VoiceProfileRepository.class);
    private final ElevenLabsTextToSpeechService textToSpeech = mock(ElevenLabsTextToSpeechService.class);
    private final AlarmPlaybackPort playback = mock(AlarmPlaybackPort.class);

    @BeforeEach
    void playerIsReadyByDefault() {
        when(playback.isReady(anyString())).thenReturn(true);
        when(deliveries.resolveAttempt(any(), any())).thenReturn(AlarmDeliveryAttempt.first());
    }

    private AlarmDeliveryScheduler scheduler(AlarmDeliveryProperties properties) {
        return new AlarmDeliveryScheduler(deliveries, voices, textToSpeech, playback,
                properties, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private AlarmDeliveryProperties properties(boolean enabled) {
        return new AlarmDeliveryProperties(enabled, 120_000, 1_024,
                "http://127.0.0.1:3001", "12345678901234567890123456789012", 150_000, 90);
    }

    private AlarmDelivery delivery(String type) {
        return new AlarmDelivery(DELIVERY_ID, ALARM_ID, "home_23", type,
                NOW.minusSeconds(30), "GENERATING", REQUEST_ID);
    }

    private void verifiedVoiceAndAudio() {
        when(voices.findLatestVerified("home_23")).thenReturn(Optional.of(
                new RegisteredVoice("provider-id", "가족 목소리", false, NOW.minusSeconds(60))));
        when(textToSpeech.generateSpeech(anyString(), anyString())).thenReturn(new byte[] { 1, 2, 3 });
    }

    @Test
    void mealUsesOnlyTheServerAllowlistedPhraseAndRecordsAPlayingAck() {
        AlarmDelivery delivery = delivery("MEAL");
        verifiedVoiceAndAudio();
        AlarmPlaybackResult result = new AlarmPlaybackResult(
                REQUEST_ID, "COMPLETED", NOW, NOW.plusSeconds(1), null);
        when(playback.play(eq("home_23"), eq(ALARM_ID), eq(REQUEST_ID), any(), eq("audio/mpeg")))
                .thenReturn(result);

        scheduler(properties(true)).execute(delivery, NOW);

        verify(textToSpeech).generateSpeech("provider-id", "엄마~~ 밥 먹어요~~");
        verify(deliveries).markSent(DELIVERY_ID);
        verify(deliveries).recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id", result, Duration.ofSeconds(90));
    }

    @Test
    void medicationUsesOnlyTheMedicationPhrase() {
        AlarmDelivery delivery = delivery("MEDICATION");
        verifiedVoiceAndAudio();
        AlarmPlaybackResult result = new AlarmPlaybackResult(
                REQUEST_ID, "COMPLETED", NOW, NOW.plusSeconds(1), null);
        when(playback.play(anyString(), any(), any(), any(), anyString())).thenReturn(result);

        scheduler(properties(true)).execute(delivery, NOW);

        verify(textToSpeech).generateSpeech("provider-id", "엄마~~ 약 먹어요~~");
    }

    @Test
    void secondMealDeliveryReusesTheFirstVoiceAndPhraseWithoutSelectingANewVoice() {
        AlarmDelivery delivery = delivery("MEAL");
        UUID careEventId = UUID.fromString("77777777-7777-4777-8777-777777777777");
        AlarmDeliveryAttempt second = AlarmDeliveryAttempt.second(careEventId, "first-provider-id");
        when(deliveries.resolveAttempt(delivery, Duration.ofSeconds(90))).thenReturn(second);
        when(textToSpeech.generateSpeech("first-provider-id", "엄마~~ 밥 먹어요~~"))
                .thenReturn(new byte[] { 1, 2, 3 });
        AlarmPlaybackResult result = new AlarmPlaybackResult(
                REQUEST_ID, "COMPLETED", NOW, NOW.plusSeconds(1), null);
        when(playback.play(anyString(), any(), any(), any(), anyString())).thenReturn(result);

        scheduler(properties(true)).execute(delivery, NOW);

        verify(voices, never()).findLatestVerified(anyString());
        verify(textToSpeech).generateSpeech("first-provider-id", "엄마~~ 밥 먹어요~~");
        verify(deliveries).recordPlaybackOutcome(
                delivery, second, "first-provider-id", result, Duration.ofSeconds(90));
    }

    @Test
    void secondMedicationDeliveryReusesTheFirstVoiceAndMedicationPhrase() {
        AlarmDelivery delivery = delivery("MEDICATION");
        AlarmDeliveryAttempt second = AlarmDeliveryAttempt.second(
                UUID.fromString("77777777-7777-4777-8777-777777777777"), "first-provider-id");
        when(deliveries.resolveAttempt(delivery, Duration.ofSeconds(90))).thenReturn(second);
        when(textToSpeech.generateSpeech(anyString(), anyString())).thenReturn(new byte[] { 1, 2, 3 });
        AlarmPlaybackResult result = new AlarmPlaybackResult(
                REQUEST_ID, "COMPLETED", NOW, NOW.plusSeconds(1), null);
        when(playback.play(anyString(), any(), any(), any(), anyString())).thenReturn(result);

        scheduler(properties(true)).execute(delivery, NOW);

        verify(textToSpeech).generateSpeech("first-provider-id", "엄마~~ 약 먹어요~~");
        verify(voices, never()).findLatestVerified(anyString());
    }

    @Test
    void noVerifiedVoiceFailsWithoutCallingTtsOrPlayer() {
        AlarmDelivery delivery = delivery("MEAL");
        when(voices.findLatestVerified("home_23")).thenReturn(Optional.empty());

        scheduler(properties(true)).execute(delivery, NOW);

        verify(deliveries).fail(DELIVERY_ID, "NO_VERIFIED_VOICE");
        verify(textToSpeech, never()).generateSpeech(anyString(), anyString());
        verify(playback, never()).play(anyString(), any(), any(), any(), anyString());
    }

    @Test
    void ttsFailureCreatesNoPlaybackOutcome() {
        AlarmDelivery delivery = delivery("MEAL");
        when(voices.findLatestVerified("home_23")).thenReturn(Optional.of(
                new RegisteredVoice("provider-id", "가족 목소리", false, NOW)));
        when(textToSpeech.generateSpeech(anyString(), anyString())).thenThrow(new RuntimeException("secret"));

        scheduler(properties(true)).execute(delivery, NOW);

        verify(deliveries).fail(DELIVERY_ID, "TTS_FAILED");
        verify(deliveries, never()).recordPlaybackOutcome(any(), any(), anyString(), any(), any());
    }

    @Test
    void providerMissingVoiceHasADistinctSafeFailureCode() {
        AlarmDelivery delivery = delivery("MEAL");
        when(voices.findLatestVerified("home_23")).thenReturn(Optional.of(
                new RegisteredVoice("stale-provider-id", "삭제된 목소리", false, NOW)));
        when(textToSpeech.generateSpeech(anyString(), anyString()))
                .thenThrow(new ElevenLabsApiException("safe message", 404));

        scheduler(properties(true)).execute(delivery, NOW);

        verify(deliveries).fail(DELIVERY_ID, "VOICE_PROVIDER_NOT_FOUND");
        verify(deliveries, never()).recordPlaybackOutcome(any(), any(), anyString(), any(), any());
    }

    @Test
    void everyNewDeliveryReadsTheLatestVerifiedVoiceAgainWithoutCaching() {
        AlarmDelivery first = delivery("MEAL");
        AlarmDelivery second = new AlarmDelivery(
                UUID.fromString("44444444-4444-4444-8444-444444444444"),
                UUID.fromString("55555555-5555-4555-8555-555555555555"),
                "home_23", "MEDICATION", NOW, "GENERATING",
                UUID.fromString("66666666-6666-4666-8666-666666666666"));
        RegisteredVoice oldVoice = new RegisteredVoice(
                "old-provider-id", "이전 목소리", false, NOW.minusSeconds(60));
        RegisteredVoice newVoice = new RegisteredVoice(
                "new-provider-id", "새 목소리", false, NOW);
        when(voices.findLatestVerified("home_23"))
                .thenReturn(Optional.of(oldVoice), Optional.of(newVoice));
        when(textToSpeech.generateSpeech(anyString(), anyString()))
                .thenReturn(new byte[] { 1, 2, 3 });
        when(playback.play(anyString(), any(), any(), any(), anyString()))
                .thenReturn(new AlarmPlaybackResult(
                        REQUEST_ID, "COMPLETED", NOW, NOW.plusSeconds(1), null));

        AlarmDeliveryScheduler scheduler = scheduler(properties(true));
        scheduler.execute(first, NOW);
        scheduler.execute(second, NOW);

        verify(voices, times(2)).findLatestVerified("home_23");
        verify(textToSpeech).generateSpeech("old-provider-id", "엄마~~ 밥 먹어요~~");
        verify(textToSpeech).generateSpeech("new-provider-id", "엄마~~ 약 먹어요~~");
    }

    @Test
    void playerBusyRetriesInsideGraceAndDoesNotCreateCareEvent() {
        AlarmDelivery delivery = delivery("MEAL");
        verifiedVoiceAndAudio();
        when(playback.isReady("home_23")).thenReturn(false);

        scheduler(properties(true)).execute(delivery, NOW);

        verify(deliveries).retry(DELIVERY_ID, "PLAYBACK_NOT_READY");
        verify(textToSpeech, never()).generateSpeech(anyString(), anyString());
        verify(playback, never()).play(anyString(), any(), any(), any(), anyString());
        verify(deliveries, never()).recordPlaybackOutcome(any(), any(), anyString(), any(), any());
    }

    @Test
    void ambiguousAckFailureIsNotRetriedAndCreatesNoCareEvent() {
        AlarmDelivery delivery = delivery("MEAL");
        verifiedVoiceAndAudio();
        when(playback.play(anyString(), any(), any(), any(), anyString()))
                .thenThrow(new AlarmPlaybackException("PLAYBACK_ACK_TIMEOUT", false));

        scheduler(properties(true)).execute(delivery, NOW);

        verify(deliveries).fail(DELIVERY_ID, "PLAYBACK_ACK_TIMEOUT");
        verify(deliveries, never()).retry(any(), anyString());
        verify(deliveries, never()).recordPlaybackOutcome(any(), any(), anyString(), any(), any());
    }

    @Test
    void schedulerUsesKstGraceWindowAndDoesNothingWhenDisabled() {
        AlarmDelivery delivery = delivery("MEAL");
        when(deliveries.claimNext(NOW.minusSeconds(120), NOW)).thenReturn(Optional.of(delivery));
        when(voices.findLatestVerified("home_23")).thenReturn(Optional.empty());

        scheduler(properties(true)).scan();
        verify(deliveries).expirePendingBefore(NOW.minusSeconds(120));
        verify(deliveries).discoverDue(NOW.minusSeconds(120), NOW, AlarmDeliveryProperties.KST);
        verify(deliveries).claimNext(NOW.minusSeconds(120), NOW);

        AlarmDeliveryRepository disabledRepository = mock(AlarmDeliveryRepository.class);
        new AlarmDeliveryScheduler(disabledRepository, voices, textToSpeech, playback,
                properties(false), Clock.fixed(NOW, ZoneOffset.UTC)).scan();
        verify(disabledRepository, never()).expirePendingBefore(any());
        verify(disabledRepository, never()).discoverDue(any(), any(), any());
    }
}
