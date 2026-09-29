package com.wificare.voice.alarm.delivery;

public class AlarmPlaybackException extends RuntimeException {
    private final String code;
    private final boolean retryable;

    public AlarmPlaybackException(String code, boolean retryable) {
        super("알림 음성 재생 요청을 완료하지 못했습니다.");
        this.code = code;
        this.retryable = retryable;
    }

    public AlarmPlaybackException(String code, boolean retryable, Throwable cause) {
        super("알림 음성 재생 요청을 완료하지 못했습니다.", cause);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }
}
