package com.wificare.voice.controller;

import java.util.Map;

import com.wificare.voice.config.ElevenLabsProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/config")
public class ElevenLabsConfigController {

	private final ElevenLabsProperties properties;

	public ElevenLabsConfigController(ElevenLabsProperties properties) {
		this.properties = properties;
	}

	@GetMapping("/elevenlabs")
	public Map<String, Boolean> elevenLabsConfig() {
		return Map.of("configured", properties.isConfigured());
	}
}
