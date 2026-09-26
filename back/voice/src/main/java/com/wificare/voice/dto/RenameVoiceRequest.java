package com.wificare.voice.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

public record RenameVoiceRequest(
        @JsonProperty("home_id") @JsonAlias("homeId") String homeId,
        String name,
        @JsonProperty("new_phrases") List<String> newPhrases) {
}
