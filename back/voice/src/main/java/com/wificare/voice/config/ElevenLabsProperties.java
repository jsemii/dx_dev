package com.wificare.voice.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "elevenlabs")
public class ElevenLabsProperties {

	public static final String PLACEHOLDER = "PUT_YOUR_ELEVENLABS_API_KEY_HERE";

	private String apiKey = "";

	public String getApiKey() {
		return apiKey;
	}

	public void setApiKey(String apiKey) {
		this.apiKey = apiKey;
	}

	public boolean isConfigured() {
		return apiKey != null && !apiKey.isBlank() && !PLACEHOLDER.equals(apiKey.trim());
	}

	@Override
	public String toString() {
		return "ElevenLabsProperties{configured=" + isConfigured() + '}';
	}
}
