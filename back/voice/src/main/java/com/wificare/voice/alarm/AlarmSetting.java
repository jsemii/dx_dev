package com.wificare.voice.alarm;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AlarmSetting(@JsonProperty("home_id") String homeId, boolean enabled,
        @JsonProperty("meal_enabled") boolean mealEnabled,
        @JsonProperty("medication_enabled") boolean medicationEnabled) {
}
