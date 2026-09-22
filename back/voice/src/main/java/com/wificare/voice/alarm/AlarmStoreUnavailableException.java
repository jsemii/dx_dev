package com.wificare.voice.alarm;

public class AlarmStoreUnavailableException extends RuntimeException {
    public AlarmStoreUnavailableException(Throwable cause) {
        super("알림 저장소를 사용할 수 없습니다.", cause);
    }
}
