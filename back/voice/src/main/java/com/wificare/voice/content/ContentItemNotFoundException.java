package com.wificare.voice.content;

public class ContentItemNotFoundException extends RuntimeException {
    public ContentItemNotFoundException() {
        super("해당 가정의 콘텐츠를 찾을 수 없습니다.");
    }
}
