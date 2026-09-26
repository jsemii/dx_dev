package com.wificare.voice.alarm;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

import com.wificare.voice.content.ContentValidation;

public final class AlarmValidation {
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    private AlarmValidation() {
    }

    public static String homeId(String value) {
        return ContentValidation.homeId(value);
    }

    public static String type(String value) {
        if (!"meal".equals(value) && !"medication".equals(value)) {
            throw new IllegalArgumentException("알림 종류는 meal 또는 medication이어야 합니다.");
        }
        return value;
    }

    public static String name(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty() || trimmed.length() > 30) {
            throw new IllegalArgumentException("알림 이름은 1~30자로 입력하세요.");
        }
        return trimmed;
    }

    public static LocalTime time(String value) {
        if (value == null || !value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) {
            throw new IllegalArgumentException("알림 시간은 HH:mm 형식이어야 합니다.");
        }
        return LocalTime.parse(value, TIME_FORMAT);
    }

    public static UUID alarmId(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException | NullPointerException error) {
            throw new IllegalArgumentException("알림 ID가 올바르지 않습니다.");
        }
    }

    public static boolean enabled(Boolean value) {
        if (value == null) throw new IllegalArgumentException("알림 사용 여부가 필요합니다.");
        return value;
    }

    public static String displayTime(LocalTime value) {
        return value.format(TIME_FORMAT);
    }
}
