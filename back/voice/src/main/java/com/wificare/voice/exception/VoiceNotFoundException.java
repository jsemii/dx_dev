package com.wificare.voice.exception;

public class VoiceNotFoundException extends RuntimeException {
    public VoiceNotFoundException() {
        super("등록된 목소리를 찾지 못했습니다.");
    }
}
