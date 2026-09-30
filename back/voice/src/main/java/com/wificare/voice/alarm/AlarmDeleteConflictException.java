package com.wificare.voice.alarm;

public class AlarmDeleteConflictException extends RuntimeException {
    public AlarmDeleteConflictException() {
        super("알림이 재생 중이라 삭제할 수 없습니다. 잠시 후 다시 시도해주세요.");
    }
}
