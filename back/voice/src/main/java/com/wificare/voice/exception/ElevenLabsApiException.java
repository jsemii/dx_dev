package com.wificare.voice.exception;

public class ElevenLabsApiException extends RuntimeException {

	private final int upstreamStatus;

	public ElevenLabsApiException(String message, int upstreamStatus) {
		super(message);
		this.upstreamStatus = upstreamStatus;
	}

	public ElevenLabsApiException(String message, Throwable cause) {
		super(message, cause);
		this.upstreamStatus = 0;
	}

	public int getUpstreamStatus() {
		return upstreamStatus;
	}
}
