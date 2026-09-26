package com.wificare.voice.controller;

import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wificare.voice.dto.SharedPhrase;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.service.VoiceProfileRepository;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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

    static String validateText(String text) {
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("저장할 문구를 입력해주세요.");
        if (trimmed.length() > 500) throw new IllegalArgumentException("문구는 500자 이하로 입력해주세요.");
        return trimmed;
    }

    public record AddRequest(@JsonProperty("home_id") String homeId, String text) {
    }
}
