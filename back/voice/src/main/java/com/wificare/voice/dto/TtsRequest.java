package com.wificare.voice.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TtsRequest(
		@NotBlank(message = "voiceId가 필요합니다.")
		@Size(max = 200, message = "voiceId가 너무 깁니다.")
		String voiceId,
		@NotBlank(message = "재생할 문장을 입력해주세요.")
		@Size(max = 500, message = "문장은 500자 이하로 입력해주세요.")
		String text,
		@JsonProperty("home_id")
		@NotBlank(message = "home_id가 필요합니다.")
		@Size(max = 128, message = "home_id가 너무 깁니다.")
		String homeId) {
}
