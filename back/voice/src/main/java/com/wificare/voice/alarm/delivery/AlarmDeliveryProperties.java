package com.wificare.voice.alarm.delivery;

import java.net.URI;
import java.time.Duration;
import java.time.ZoneId;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AlarmDeliveryProperties {
    public static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final boolean enabled;
    private final Duration grace;
    private final int maxAudioBytes;
    private final URI angerBaseUri;
    private final String internalToken;
    private final Duration requestTimeout;

    public AlarmDeliveryProperties(
            @Value("${alarm.delivery.enabled:false}") boolean enabled,
            @Value("${alarm.delivery.grace-ms:120000}") long graceMs,
            @Value("${alarm.delivery.max-audio-bytes:1048576}") int maxAudioBytes,
            @Value("${alarm.delivery.anger-base-url:http://127.0.0.1:3001}") String angerBaseUrl,
            @Value("${alarm.delivery.internal-token:}") String internalToken,
            @Value("${alarm.delivery.request-timeout-ms:150000}") long requestTimeoutMs) {
        if (graceMs < 1 || maxAudioBytes < 1 || requestTimeoutMs < 1) {
            throw new IllegalArgumentException("알림 실행 설정이 올바르지 않습니다.");
        }
        this.enabled = enabled;
        this.grace = Duration.ofMillis(graceMs);
        this.maxAudioBytes = maxAudioBytes;
        this.angerBaseUri = URI.create(angerBaseUrl);
        this.internalToken = internalToken == null ? "" : internalToken;
        this.requestTimeout = Duration.ofMillis(requestTimeoutMs);
    }

    public boolean enabled() { return enabled; }
    public Duration grace() { return grace; }
    public int maxAudioBytes() { return maxAudioBytes; }
    public URI angerBaseUri() { return angerBaseUri; }
    public String internalToken() { return internalToken; }
    public Duration requestTimeout() { return requestTimeout; }
    public boolean hasValidInternalToken() { return internalToken.length() >= 32; }
}
