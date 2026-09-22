package com.wificare.voice.dto;

import java.time.Instant;

public record RegisteredVoice(String voiceId, String name, boolean requiresVerification, Instant createdAt) {
}
