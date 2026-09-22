package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.controller.RegisteredVoiceController;
import com.wificare.voice.controller.VoiceController;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.VoiceCloneResponse;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import com.wificare.voice.service.ElevenLabsVoiceService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class VoiceRegistrationFlowTests {
    private final ElevenLabsVoiceService cloneService = mock(ElevenLabsVoiceService.class);
    private final VoiceProfileRepository profiles = mock(VoiceProfileRepository.class);
    private final ElevenLabsProperties properties = new ElevenLabsProperties();
    private final MockMultipartFile recording = new MockMultipartFile(
            "file", "voice.webm", "audio/webm", new byte[]{1, 2});

    @Test
    void savesTheActualProviderIdOnlyAfterTheCloneSucceeds() {
        properties.setApiKey("test-key");
        VoiceController controller = new VoiceController(cloneService, profiles, properties);
        RegisteredVoice expected = new RegisteredVoice("real-voice-id", "새 목소리", false, Instant.now());
        when(cloneService.createVoiceClone(recording)).thenReturn(new VoiceCloneResponse("real-voice-id", false));
        when(profiles.save("demo_solo_house009", "real-voice-id", "새 목소리", false)).thenReturn(expected);

        RegisteredVoice actual = controller.createVoiceClone(recording, "demo_solo_house009", " 새 목소리 ");

        assertThat(actual).isEqualTo(expected);
        verify(profiles).ensureReady();
        verify(profiles).save("demo_solo_house009", "real-voice-id", "새 목소리", false);
    }

    @Test
    void databaseFailureStopsThePaidCloneRequest() {
        properties.setApiKey("test-key");
        VoiceController controller = new VoiceController(cloneService, profiles, properties);
        org.mockito.Mockito.doThrow(new VoiceStoreUnavailableException()).when(profiles).ensureReady();

        assertThatThrownBy(() -> controller.createVoiceClone(recording, "demo_solo_house009", "새 목소리"))
                .isInstanceOf(VoiceStoreUnavailableException.class);
        verifyNoInteractions(cloneService);
    }

    @Test
    void invalidHomeOrNameIsRejectedBeforeSendingAudio() {
        VoiceController controller = new VoiceController(cloneService, profiles, properties);
        assertThatThrownBy(() -> controller.createVoiceClone(recording, "other-home!", "새 목소리"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RegisteredVoiceController.validateName(" "))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(cloneService, profiles);
    }
}
