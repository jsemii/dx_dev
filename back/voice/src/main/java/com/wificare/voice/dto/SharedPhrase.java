package com.wificare.voice.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SharedPhrase(@JsonProperty("phrase_id") UUID phraseId, String text,
        @JsonProperty("created_at") Instant createdAt) {
}
