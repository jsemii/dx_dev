package com.wificare.voice.alarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.LocalTime;
import java.util.List;

import org.junit.jupiter.api.Test;

class AlarmControllerTests {
    private final AlarmRepository repository = mock(AlarmRepository.class);
    private final AlarmController controller = new AlarmController(repository);

    @Test
    void listsOnlyTheRequestedHomeInRepositoryTimeOrder() {
        AlarmItem first = new AlarmItem(3, "demo_solo_house009", "meal", "아침", "08:30", true);
        AlarmItem second = new AlarmItem(4, "demo_solo_house009", "medication", "약", "09:00", false);
        when(repository.list("demo_solo_house009")).thenReturn(List.of(first, second));

        assertThat(controller.list("demo_solo_house009")).containsExactly(first, second);
        verify(repository).list("demo_solo_house009");
    }

    @Test
    void convertsScreenTimeToSqlTimeAndTrimsName() {
        AlarmItem item = new AlarmItem(5, "demo_solo_house009", "meal", "점심", "13:05", true);
        when(repository.add("demo_solo_house009", "meal", "점심", LocalTime.of(13, 5))).thenReturn(item);

        var response = controller.add(new AlarmController.AddRequest("demo_solo_house009", "meal", " 점심 ", "13:05"));

        assertThat(response.getStatusCode().value()).isEqualTo(201);
        assertThat(response.getBody()).isEqualTo(item);
        verify(repository).add("demo_solo_house009", "meal", "점심", LocalTime.of(13, 5));
    }

    @Test
    void rejectsInvalidInputsBeforeDatabaseAccess() {
        assertThatThrownBy(() -> controller.add(new AlarmController.AddRequest("other-home!", "meal", "식사", "08:30")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.add(new AlarmController.AddRequest("demo_solo_house009", "other", "식사", "08:30")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.add(new AlarmController.AddRequest("demo_solo_house009", "meal", "  ", "08:30")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.add(new AlarmController.AddRequest("demo_solo_house009", "meal", "식사", "24:00")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.setEnabled(1, new AlarmController.EnabledRequest("demo_solo_house009", null)))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(repository);
    }

    @Test
    void patchesOnlyTheRequestedAlarmAndHome() {
        AlarmItem item = new AlarmItem(7, "demo_solo_house009", "medication", "저녁 약", "20:00", false);
        when(repository.setEnabled(7, "demo_solo_house009", false)).thenReturn(item);

        assertThat(controller.setEnabled(7, new AlarmController.EnabledRequest("demo_solo_house009", false)))
                .isEqualTo(item);
        verify(repository).setEnabled(7, "demo_solo_house009", false);
    }

    @Test
    void formatsPostgresTimeAsHourAndMinute() {
        assertThat(AlarmValidation.displayTime(LocalTime.of(8, 30, 42))).isEqualTo("08:30");
        assertThat(AlarmValidation.time("00:00")).isEqualTo(LocalTime.MIDNIGHT);
        assertThatThrownBy(() -> AlarmValidation.time("8:30")).isInstanceOf(IllegalArgumentException.class);
    }
}
