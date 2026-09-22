package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import com.wificare.voice.controller.RegisteredVoiceController;
import com.wificare.voice.controller.ApiExceptionHandler;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.service.ElevenLabsVoiceService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RegisteredVoiceControllerTests {
    private final VoiceProfileRepository profiles = mock(VoiceProfileRepository.class);
    private final ElevenLabsVoiceService voiceService = mock(ElevenLabsVoiceService.class);
    private final RegisteredVoiceController controller = new RegisteredVoiceController(profiles, voiceService);

    @Test
    void deletesProviderVoiceBeforeItsOwnedDatabaseRow() {
        String homeId = "demo_solo_house009";
        String voiceId = "provider-voice-id";
        when(profiles.requireOwned(homeId, voiceId))
                .thenReturn(new RegisteredVoice(voiceId, "정수쌤", false, Instant.now()));

        var response = controller.delete(voiceId, homeId);

        assertThat(response.getStatusCode().value()).isEqualTo(204);
        InOrder order = inOrder(profiles, voiceService);
        order.verify(profiles).requireOwned(homeId, voiceId);
        order.verify(voiceService).deleteVoice(voiceId);
        order.verify(profiles).delete(homeId, voiceId);
    }

    @Test
    void anotherHomesVoiceIsNeverSentToTheProviderDeletionApi() {
        when(profiles.requireOwned("other_home", "provider-voice-id"))
                .thenThrow(new VoiceNotFoundException());

        assertThatThrownBy(() -> controller.delete("provider-voice-id", "other_home"))
                .isInstanceOf(VoiceNotFoundException.class);
        verify(voiceService, never()).deleteVoice("provider-voice-id");
        verify(profiles, never()).delete("other_home", "provider-voice-id");
    }

    @Test
    void providerFailureKeepsTheDatabaseRowForRetry() {
        String homeId = "demo_solo_house009";
        String voiceId = "provider-voice-id";
        when(profiles.requireOwned(homeId, voiceId))
                .thenReturn(new RegisteredVoice(voiceId, "정수쌤", false, Instant.now()));
        org.mockito.Mockito.doThrow(new ElevenLabsApiException("provider unavailable", 500))
                .when(voiceService).deleteVoice(voiceId);

        assertThatThrownBy(() -> controller.delete(voiceId, homeId))
                .isInstanceOf(ElevenLabsApiException.class);
        verify(profiles, never()).delete(homeId, voiceId);
    }

    @Test
    void exposesTheDeleteHttpRouteWithHomeOwnershipParameter() throws Exception {
        String homeId = "demo_solo_house009";
        String voiceId = "provider-voice-id";
        when(profiles.requireOwned(homeId, voiceId))
                .thenReturn(new RegisteredVoice(voiceId, "정수쌤", false, Instant.now()));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(delete("/api/voice/registered/{voiceId}", voiceId).param("home_id", homeId))
                .andExpect(status().isNoContent());
    }
}
