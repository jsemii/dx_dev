package com.wificare.voice.exception;

public class DuplicateSharedPhraseException extends RuntimeException {
    public DuplicateSharedPhraseException() {
        super("이미 등록된 문구입니다.");
    }
}
