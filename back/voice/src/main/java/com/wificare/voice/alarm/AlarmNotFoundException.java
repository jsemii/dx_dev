package com.wificare.voice.alarm;

public class AlarmNotFoundException extends RuntimeException {
    public AlarmNotFoundException() {
        super("해당 가정의 알림을 찾을 수 없습니다.");
    }
}
