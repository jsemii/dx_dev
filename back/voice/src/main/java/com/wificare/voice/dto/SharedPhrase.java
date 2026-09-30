package com.wificare.voice.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

public record SharedPhrase(@JsonProperty("phrase_id") UUID phraseId, String text,
        @JsonProperty("created_at") Instant createdAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) @JsonProperty("updated_at") Instant updatedAt) {
    public SharedPhrase(UUID phraseId, String text, Instant createdAt) {
        this(phraseId, text, createdAt, null);
    }
}
