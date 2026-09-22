package com.wificare.voice.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ElevenLabsTtsRequest(
		String text,
		@JsonProperty("model_id") String modelId) {
}
