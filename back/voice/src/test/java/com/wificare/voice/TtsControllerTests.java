package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;

import com.wificare.voice.controller.TtsController;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.TtsRequest;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.service.ElevenLabsTextToSpeechService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class TtsControllerTests {
    private final ElevenLabsTextToSpeechService textToSpeech = mock(ElevenLabsTextToSpeechService.class);
    private final VoiceProfileRepository profiles = mock(VoiceProfileRepository.class);
    private final TtsController controller = new TtsController(textToSpeech, profiles);

    @Test
    void residentOwnedVoiceIsVerifiedBeforeTtsGeneration() {
        String voiceId = "owned-voice";
        when(profiles.requireOwned("home_23", voiceId)).thenReturn(new RegisteredVoice(
                voiceId, "딸 목소리", false, Instant.parse("2026-09-26T05:00:00Z")));
        when(textToSpeech.generateSpeech(voiceId, "약 먹어요")).thenReturn(new byte[] { 1, 2, 3 });

        byte[] audio = controller.generateSpeech(
                new TtsRequest(" owned-voice ", " 약 먹어요 ", "home_23")).getBody();

        assertThat(audio).containsExactly(1, 2, 3);
        InOrder order = inOrder(profiles, textToSpeech);
        order.verify(profiles).requireOwned("home_23", voiceId);
        order.verify(textToSpeech).generateSpeech(voiceId, "약 먹어요");
    }

    @Test
    void anotherResidentsVoiceIsRejectedWithoutCallingElevenLabs() {
        when(profiles.requireOwned("home_23", "other-resident-voice"))
                .thenThrow(new VoiceNotFoundException());

        assertThatThrownBy(() -> controller.generateSpeech(
                new TtsRequest("other-resident-voice", "밥 먹어요", "home_23")))
                .isInstanceOf(VoiceNotFoundException.class);

        verify(textToSpeech, never()).generateSpeech("other-resident-voice", "밥 먹어요");
    }

    @Test
    void missingResidentIsRejectedWithoutCallingTheDatabaseOrElevenLabs() {
        assertThatThrownBy(() -> controller.generateSpeech(
                new TtsRequest("legacy-voice", "밥 먹어요", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("올바른 가정 ID가 필요합니다.");

        verify(profiles, never()).requireOwned("home_23", "legacy-voice");
        verify(textToSpeech, never()).generateSpeech("legacy-voice", "밥 먹어요");
    }
}
