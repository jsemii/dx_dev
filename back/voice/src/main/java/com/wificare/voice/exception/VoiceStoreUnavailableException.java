package com.wificare.voice.exception;

public class VoiceStoreUnavailableException extends RuntimeException {
    public VoiceStoreUnavailableException(Throwable cause) {
        super("목소리 저장 DB에 연결하지 못했습니다.", cause);
    }

    public VoiceStoreUnavailableException() {
        super("목소리 저장 DB 설정이 필요합니다.");
    }
}
