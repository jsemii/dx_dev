package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.wificare.voice.controller.ApiExceptionHandler;
import com.wificare.voice.controller.SharedPhraseController;
import com.wificare.voice.dto.SharedPhrase;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import com.wificare.voice.service.VoiceProfileRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SharedPhraseControllerTests {
    private static final UUID PHRASE_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final Instant CREATED_AT = Instant.parse("2026-09-26T05:00:00Z");
    private final VoiceProfileRepository profiles = mock(VoiceProfileRepository.class);
    private final SharedPhraseController controller = new SharedPhraseController(profiles);

    @Test
    void listUsesOnlyTheRequestedResident() {
        SharedPhrase phrase = new SharedPhrase(PHRASE_ID, "약 드실 시간이에요", CREATED_AT);
        when(profiles.listSharedPhrases("home_23")).thenReturn(List.of(phrase));

        assertThat(controller.list("home_23")).containsExactly(phrase);
        verify(profiles).listSharedPhrases("home_23");
    }

    @Test
    void addTrimsTextAndDifferentResidentsCanStoreTheSameText() {
        SharedPhrase phrase = new SharedPhrase(PHRASE_ID, "약 드실 시간이에요", CREATED_AT);
        when(profiles.addSharedPhrase("home_23", "약 드실 시간이에요")).thenReturn(phrase);
        when(profiles.addSharedPhrase("home_24", "약 드실 시간이에요")).thenReturn(phrase);

        controller.add(new SharedPhraseController.AddRequest("home_23", "  약 드실 시간이에요  "));
        controller.add(new SharedPhraseController.AddRequest("home_24", "약 드실 시간이에요"));

        verify(profiles).addSharedPhrase("home_23", "약 드실 시간이에요");
        verify(profiles).addSharedPhrase("home_24", "약 드실 시간이에요");
    }

    @Test
    void emptyAndOversizedTextAreRejectedBeforeDatabaseAccess() {
        assertThatThrownBy(() -> controller.add(new SharedPhraseController.AddRequest("home_23", " ")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.add(
                new SharedPhraseController.AddRequest("home_23", "가".repeat(501))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void fixedFrontendPhrasesAreNeverStoredAsUserPhrases() {
        assertThatThrownBy(() -> controller.add(
                new SharedPhraseController.AddRequest("home_23", "  밥 먹어요  ")))
                .isInstanceOf(DuplicateSharedPhraseException.class);
        assertThatThrownBy(() -> controller.add(
                new SharedPhraseController.AddRequest("home_23", "약 먹어요")))
                .isInstanceOf(DuplicateSharedPhraseException.class);
        verifyNoInteractions(profiles);
    }

    @Test
    void httpApiKeepsSnakeCaseFieldsAndMapsDuplicateToConflict() throws Exception {
        SharedPhrase phrase = new SharedPhrase(PHRASE_ID, "약 드실 시간이에요", CREATED_AT);
        when(profiles.listSharedPhrases("home_23")).thenReturn(List.of(phrase));
        when(profiles.addSharedPhrase("home_23", "약 드실 시간이에요"))
                .thenThrow(new DuplicateSharedPhraseException());
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(get("/api/voice/shared-phrases").param("home_id", "home_23"))
                .andExpect(status().isOk())
                .andExpect(content().json("""
                        [{"phrase_id":"11111111-1111-4111-8111-111111111111",
                          "text":"약 드실 시간이에요","created_at":"2026-09-26T05:00:00Z"}]
                        """));
        mvc.perform(post("/api/voice/shared-phrases")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"home_id\":\"home_23\",\"text\":\"약 드실 시간이에요\"}"))
                .andExpect(status().isConflict())
                .andExpect(content().json("{\"message\":\"이미 등록된 문구입니다.\"}"));
    }

    @Test
    void databaseFailureKeepsTheExistingSafeServiceUnavailableResponse() throws Exception {
        when(profiles.listSharedPhrases("home_23"))
                .thenThrow(new VoiceStoreUnavailableException(new IllegalStateException("private details")));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler()).build();

        mvc.perform(get("/api/voice/shared-phrases").param("home_id", "home_23"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().json("{\"message\":\"목소리 저장 DB에 연결하지 못했습니다.\"}"));
    }
}
