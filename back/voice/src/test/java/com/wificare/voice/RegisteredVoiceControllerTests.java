package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import com.wificare.voice.controller.RegisteredVoiceController;
import com.wificare.voice.controller.ApiExceptionHandler;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.RenameVoiceRequest;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import com.wificare.voice.service.ElevenLabsVoiceService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RegisteredVoiceControllerTests {
    private final VoiceProfileRepository profiles = mock(VoiceProfileRepository.class);
    private final ElevenLabsVoiceService voiceService = mock(ElevenLabsVoiceService.class);
    private final RegisteredVoiceController controller = new RegisteredVoiceController(profiles, voiceService);

    @Test
    void legacyNameOnlyRequestStillUsesTheAtomicUpdateWithNoPhrases() {
        RegisteredVoice updated = new RegisteredVoice(
                "provider-voice-id", "새 이름", false, Instant.parse("2026-09-26T05:00:00Z"));
        when(profiles.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "새 이름", List.of())).thenReturn(updated);

        assertThat(controller.rename("provider-voice-id",
                new RenameVoiceRequest("home_23", " 새 이름 ", null))).isEqualTo(updated);
        verify(profiles).updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "새 이름", List.of());
    }

    @Test
    void updateTrimsAndSendsNameAndNewPhrasesTogether() {
        RegisteredVoice updated = new RegisteredVoice(
                "provider-voice-id", "미미마누 목소리", false, Instant.parse("2026-09-26T05:00:00Z"));
        when(profiles.updateVoiceAndPhrases("home_23", "provider-voice-id", "미미마누 목소리",
                List.of("일어날 시간이에요", "산책할 시간이에요"))).thenReturn(updated);

        assertThat(controller.rename("provider-voice-id", new RenameVoiceRequest(
                "home_23", "미미마누 목소리",
                List.of("  일어날 시간이에요 ", "산책할 시간이에요")))).isEqualTo(updated);
        verify(profiles).updateVoiceAndPhrases("home_23", "provider-voice-id", "미미마누 목소리",
                List.of("일어날 시간이에요", "산책할 시간이에요"));
    }

    @Test
    void duplicateDraftPhrasesAreRejectedBeforeTheDatabaseChanges() {
        assertThatThrownBy(() -> controller.rename("provider-voice-id", new RenameVoiceRequest(
                "home_23", "이름", List.of("같은 문구", " 같은 문구 "))))
                .isInstanceOf(DuplicateSharedPhraseException.class);
        verify(profiles, never()).updateVoiceAndPhrases(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void fixedPhrasesAreRejectedFromTheDatabasePayload() {
        assertThatThrownBy(() -> controller.rename("provider-voice-id", new RenameVoiceRequest(
                "home_23", "이름", List.of("밥 먹어요"))))
                .isInstanceOf(DuplicateSharedPhraseException.class);
        verify(profiles, never()).updateVoiceAndPhrases(
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    }

    @Test
    void httpPatchAcceptsSnakeCaseFieldsAndReturnsTheExistingVoiceShape() throws Exception {
        RegisteredVoice updated = new RegisteredVoice(
                "provider-voice-id", "새 이름", false, Instant.parse("2026-09-26T05:00:00Z"));
        when(profiles.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "새 이름", List.of("새 문구"))).thenReturn(updated);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(patch("/api/voice/registered/{voiceId}", "provider-voice-id")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"home_id":"home_23","name":"새 이름","new_phrases":["새 문구"]}
                                """))
                .andExpect(status().isOk())
                .andExpect(content().json("""
                        {"voiceId":"provider-voice-id","name":"새 이름",
                         "requiresVerification":false,"createdAt":"2026-09-26T05:00:00Z"}
                        """));
    }

    @Test
    void httpPatchKeepsLegacyCamelCaseNameOnlyRequestsCompatible() throws Exception {
        RegisteredVoice updated = new RegisteredVoice(
                "provider-voice-id", "기존 클라이언트", false, Instant.parse("2026-09-26T05:00:00Z"));
        when(profiles.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "기존 클라이언트", List.of())).thenReturn(updated);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(patch("/api/voice/registered/{voiceId}", "provider-voice-id")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"homeId\":\"home_23\",\"name\":\"기존 클라이언트\"}"))
                .andExpect(status().isOk());
        verify(profiles).updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "기존 클라이언트", List.of());
    }

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
    void retryAfterDatabaseCleanupFailureCanFinishAfterProviderReturnsAlreadyAbsent() {
        String homeId = "demo_solo_house009";
        String voiceId = "provider-voice-id";
        when(profiles.requireOwned(homeId, voiceId))
                .thenReturn(new RegisteredVoice(voiceId, "정수쌤", false, Instant.now()));
        doThrow(new VoiceStoreUnavailableException(new java.sql.SQLException("private", "08006")))
                .doNothing().when(profiles).delete(homeId, voiceId);

        assertThatThrownBy(() -> controller.delete(voiceId, homeId))
                .isInstanceOf(VoiceStoreUnavailableException.class);
        assertThat(controller.delete(voiceId, homeId).getStatusCode().value()).isEqualTo(204);

        verify(voiceService, times(2)).deleteVoice(voiceId);
        verify(profiles, times(2)).delete(homeId, voiceId);
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

    @Test
    void databaseFailureRemainsServiceUnavailable() throws Exception {
        when(profiles.list("demo_solo_house009"))
                .thenThrow(new VoiceStoreUnavailableException(new java.sql.SQLException("private", "08006")));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(get("/api/voice/registered").param("home_id", "demo_solo_house009"))
                .andExpect(status().isServiceUnavailable());
    }
}
