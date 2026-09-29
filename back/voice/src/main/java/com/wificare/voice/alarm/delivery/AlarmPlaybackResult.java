package com.wificare.voice.alarm.delivery;

import java.time.Instant;
import java.util.UUID;

public record AlarmPlaybackResult(
        UUID requestId,
        String status,
        Instant startedAt,
        Instant endedAt,
        String failureCode) {
}
