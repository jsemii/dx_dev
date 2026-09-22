package com.wificare.voice.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ElevenLabsVoiceResponse(
		@JsonProperty("voice_id") String voiceId,
		@JsonProperty("requires_verification") boolean requiresVerification) {
}
