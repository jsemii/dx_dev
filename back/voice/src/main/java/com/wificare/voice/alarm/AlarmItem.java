package com.wificare.voice.alarm;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AlarmItem(@JsonProperty("alarm_id") long alarmId,
        @JsonProperty("home_id") String homeId, String type, String name, String time, boolean enabled) {
}
