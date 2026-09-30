package com.wificare.voice.controller;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wificare.voice.dto.SharedPhrase;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.service.VoiceProfileRepository;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;

@RestController
@RequestMapping("/api/voice/shared-phrases")
public class SharedPhraseController {
    private static final Set<String> DEFAULT_PHRASES = Set.of("밥 먹어요", "약 먹어요");
    private final VoiceProfileRepository profiles;

    public SharedPhraseController(VoiceProfileRepository profiles) {
        this.profiles = profiles;
    }

    @GetMapping
    public List<SharedPhrase> list(@RequestParam("home_id") String homeId) {
        RegisteredVoiceController.validateHomeId(homeId);
        return profiles.listSharedPhrases(homeId);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public SharedPhrase add(@RequestBody AddRequest request) {
        if (request == null) throw new IllegalArgumentException("공유 문구 정보가 필요합니다.");
        RegisteredVoiceController.validateHomeId(request.homeId());
        String text = validateText(request.text());
        if (DEFAULT_PHRASES.contains(text)) throw new DuplicateSharedPhraseException();
        return profiles.addSharedPhrase(request.homeId(), text);
    }

    @PatchMapping(value = "/{phraseId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public SharedPhrase update(@PathVariable String phraseId, @RequestBody UpdateRequest request) {
        if (request == null) throw new IllegalArgumentException("공유 문구 정보가 필요합니다.");
        RegisteredVoiceController.validateHomeId(request.homeId());
        UUID parsedPhraseId = validatePhraseId(phraseId);
        String text = validateText(request.text());
        if (DEFAULT_PHRASES.contains(text)) throw new DuplicateSharedPhraseException();
        return profiles.updateSharedPhrase(request.homeId(), parsedPhraseId, text);
    }

    @DeleteMapping("/{phraseId}")
    public ResponseEntity<Void> delete(@PathVariable String phraseId,
            @RequestParam("home_id") String homeId) {
        RegisteredVoiceController.validateHomeId(homeId);
        profiles.deleteSharedPhrase(homeId, validatePhraseId(phraseId));
        return ResponseEntity.noContent().build();
    }

    static UUID validatePhraseId(String phraseId) {
        try {
            UUID parsed = UUID.fromString(phraseId);
            if (!parsed.toString().equalsIgnoreCase(phraseId)) {
                throw new IllegalArgumentException("문구 ID가 올바르지 않습니다.");
            }
            return parsed;
        } catch (IllegalArgumentException | NullPointerException error) {
            throw new IllegalArgumentException("문구 ID가 올바르지 않습니다.");
        }
    }

    static String validateText(String text) {
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("저장할 문구를 입력해주세요.");
        if (trimmed.length() > 500) throw new IllegalArgumentException("문구는 500자 이하로 입력해주세요.");
        return trimmed;
    }

    public record AddRequest(@JsonProperty("home_id") String homeId, String text) {
    }

    public record UpdateRequest(@JsonProperty("home_id") String homeId, String text) {
    }
}
