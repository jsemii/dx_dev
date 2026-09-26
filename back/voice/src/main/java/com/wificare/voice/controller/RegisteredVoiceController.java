package com.wificare.voice.controller;

import java.util.List;
import java.util.LinkedHashSet;
import java.util.Set;

import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.RenameVoiceRequest;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.service.VoiceProfileRepository;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.wificare.voice.service.ElevenLabsVoiceService;

@RestController
@RequestMapping("/api/voice/registered")
public class RegisteredVoiceController {
    private static final Set<String> DEFAULT_PHRASES = Set.of("밥 먹어요", "약 먹어요");
    private final VoiceProfileRepository profiles;
    private final ElevenLabsVoiceService voiceService;

    public RegisteredVoiceController(VoiceProfileRepository profiles, ElevenLabsVoiceService voiceService) {
        this.profiles = profiles;
        this.voiceService = voiceService;
    }

    public static void validateHomeId(String homeId) {
        if (homeId == null || !homeId.matches("[A-Za-z0-9_]{1,128}")) {
            throw new IllegalArgumentException("올바른 가정 ID가 필요합니다.");
        }
    }

    public static String validateName(String name) {
        if (name == null || name.trim().isEmpty() || name.trim().length() > 20) {
            throw new IllegalArgumentException("목소리 이름은 1~20자여야 합니다.");
        }
        return name.trim();
    }

    @GetMapping
    public List<RegisteredVoice> list(@RequestParam("home_id") String homeId) {
        validateHomeId(homeId);
        return profiles.list(homeId);
    }

    @PatchMapping(value = "/{voiceId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public RegisteredVoice rename(@PathVariable String voiceId, @RequestBody RenameVoiceRequest request) {
        if (request == null) throw new IllegalArgumentException("목소리 설정이 필요합니다.");
        validateHomeId(request.homeId());
        if (!voiceId.matches("[A-Za-z0-9_-]{1,200}")) {
            throw new IllegalArgumentException("올바른 목소리 ID가 필요합니다.");
        }
        return profiles.updateVoiceAndPhrases(request.homeId(), voiceId, validateName(request.name()),
                validateNewPhrases(request.newPhrases()));
    }

    static List<String> validateNewPhrases(List<String> phrases) {
        if (phrases == null) return List.of();
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String phrase : phrases) {
            String text = SharedPhraseController.validateText(phrase);
            if (DEFAULT_PHRASES.contains(text) || !normalized.add(text)) {
                throw new DuplicateSharedPhraseException();
            }
        }
        return List.copyOf(normalized);
    }

    @DeleteMapping("/{voiceId}")
    public ResponseEntity<Void> delete(@PathVariable String voiceId,
            @RequestParam("home_id") String homeId) {
        validateHomeId(homeId);
        if (!voiceId.matches("[A-Za-z0-9_-]{1,200}")) {
            throw new IllegalArgumentException("올바른 목소리 ID가 필요합니다.");
        }
        profiles.requireOwned(homeId, voiceId);
        voiceService.deleteVoice(voiceId);
        profiles.delete(homeId, voiceId);
        return ResponseEntity.noContent().build();
    }
}
