package com.wificare.voice.alarm.delivery;

import java.util.UUID;

public record AlarmDeliveryAttempt(int number, UUID careEventId, String voiceId) {
    public AlarmDeliveryAttempt {
        if (number != 1 && number != 2) {
            throw new IllegalArgumentException("알림 시도 번호는 1 또는 2여야 합니다.");
        }
        if (number == 2 && (careEventId == null || voiceId == null || voiceId.isBlank())) {
            throw new IllegalArgumentException("2차 알림에는 기존 돌봄 사건과 목소리가 필요합니다.");
        }
    }

    public static AlarmDeliveryAttempt first() {
        return new AlarmDeliveryAttempt(1, null, null);
    }

    public static AlarmDeliveryAttempt second(UUID careEventId, String voiceId) {
        return new AlarmDeliveryAttempt(2, careEventId, voiceId);
    }

    public boolean isSecond() {
        return number == 2;
    }
}
