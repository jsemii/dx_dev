package com.wificare.voice.exception;

public class SharedPhraseNotFoundException extends RuntimeException {
    public SharedPhraseNotFoundException() {
        super("등록된 문구를 찾지 못했습니다.");
    }
}
