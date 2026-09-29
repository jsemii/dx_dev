package com.wificare.voice.alarm.delivery;

import java.time.Instant;
import java.util.UUID;

public record AlarmDelivery(
        UUID deliveryId,
        UUID alarmId,
        String residentThinQId,
        String alarmType,
        Instant scheduledFor,
        String status,
        UUID requestId) {
}
