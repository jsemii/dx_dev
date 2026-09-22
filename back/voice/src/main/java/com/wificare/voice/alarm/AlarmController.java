package com.wificare.voice.alarm;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/alarms")
public class AlarmController {
    private final AlarmRepository repository;

    public AlarmController(AlarmRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<AlarmItem> list(@RequestParam("home_id") String homeId) {
        return repository.list(AlarmValidation.homeId(homeId));
    }

    @PostMapping
    public ResponseEntity<AlarmItem> add(@RequestBody AddRequest request) {
        if (request == null) throw new IllegalArgumentException("알림 정보가 필요합니다.");
        AlarmItem item = repository.add(AlarmValidation.homeId(request.homeId()),
                AlarmValidation.type(request.type()), AlarmValidation.name(request.name()),
                AlarmValidation.time(request.time()));
        return ResponseEntity.status(HttpStatus.CREATED).body(item);
    }

    @GetMapping("/settings")
    public AlarmSetting settings(@RequestParam("home_id") String homeId) {
        return repository.settings(AlarmValidation.homeId(homeId));
    }

    @PatchMapping("/settings")
    public AlarmSetting updateSettings(@RequestBody SettingsRequest request) {
        if (request == null) throw new IllegalArgumentException("알림 설정이 필요합니다.");
        if (request.enabled() == null && request.mealEnabled() == null && request.medicationEnabled() == null) {
            throw new IllegalArgumentException("알림 설정 변경 값이 필요합니다.");
        }
        return repository.updateSettings(AlarmValidation.homeId(request.homeId()), request.enabled(),
                request.mealEnabled(), request.medicationEnabled());
    }

    @PatchMapping("/{alarmId}")
    public AlarmItem setEnabled(@PathVariable long alarmId, @RequestBody EnabledRequest request) {
        if (request == null) throw new IllegalArgumentException("알림 정보가 필요합니다.");
        return repository.setEnabled(AlarmValidation.alarmId(alarmId),
                AlarmValidation.homeId(request.homeId()), AlarmValidation.enabled(request.enabled()));
    }

    public record AddRequest(@JsonProperty("home_id") String homeId, String type, String name, String time) {
    }

    public record EnabledRequest(@JsonProperty("home_id") String homeId, Boolean enabled) {
    }

    public record SettingsRequest(@JsonProperty("home_id") String homeId, Boolean enabled,
            @JsonProperty("meal_enabled") Boolean mealEnabled,
            @JsonProperty("medication_enabled") Boolean medicationEnabled) {
    }
}
