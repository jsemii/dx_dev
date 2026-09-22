package com.wificare.voice.exception;

public class ElevenLabsConfigurationException extends RuntimeException {

	public ElevenLabsConfigurationException() {
		super("ElevenLabs API 설정이 필요합니다.");
	}
}
