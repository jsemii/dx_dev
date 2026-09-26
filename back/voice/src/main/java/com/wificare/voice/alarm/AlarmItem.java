package com.wificare.voice.alarm;

import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AlarmItem(@JsonProperty("alarm_id") UUID alarmId,
        @JsonProperty("home_id") String homeId, String type, String name, String time, boolean enabled) {
}
