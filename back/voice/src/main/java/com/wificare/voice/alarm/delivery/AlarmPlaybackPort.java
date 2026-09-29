package com.wificare.voice.alarm.delivery;

import java.util.UUID;

public interface AlarmPlaybackPort {
    boolean isReady(String homeId);

    AlarmPlaybackResult play(String homeId, UUID alarmId, UUID requestId, byte[] audio, String mimeType);
}
