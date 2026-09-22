package com.wificare.voice.content;

public class ContentNotFoundException extends RuntimeException {
    public ContentNotFoundException() {
        super("해당 이미지를 찾을 수 없습니다.");
    }
}
