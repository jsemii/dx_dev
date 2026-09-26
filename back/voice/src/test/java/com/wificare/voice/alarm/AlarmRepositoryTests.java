package com.wificare.voice.alarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalTime;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import org.junit.jupiter.api.Test;

class AlarmRepositoryTests {
    private static final UUID ALARM_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private final VoiceDatabase database = mock(VoiceDatabase.class);
    private final Connection connection = mock(Connection.class);
    private final PreparedStatement statement = mock(PreparedStatement.class);
    private final ResultSet result = mock(ResultSet.class);
    private final AlarmRepository repository = new AlarmRepository(database);

    private void query() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
    }

    @Test
    void listFiltersByHomeAndOrdersByTime() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThat(repository.list("demo_solo_house009")).isEmpty();
        verify(connection).prepareStatement(contains(
                "WHERE resident_thinq_id = ? ORDER BY alarm_time, alarm_type, alarm_id"));
        verify(statement).setString(1, "demo_solo_house009");
    }

    @Test
    void patchFiltersByBothIdAndHomeAndReturnsNotFoundForOtherHome() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.setEnabled(ALARM_ID, "other_home", false))
                .isInstanceOf(AlarmNotFoundException.class);
        verify(connection).prepareStatement(contains(
                "WHERE alarm_id = ? AND resident_thinq_id = ?"));
        verify(statement).setBoolean(1, false);
        verify(statement).setObject(2, ALARM_ID);
        verify(statement).setString(3, "other_home");
    }

    @Test
    void insertionBindsLocalTimeWithoutTimezoneConversion() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getObject("alarm_id", UUID.class)).thenReturn(ALARM_ID);
        when(result.getString("resident_thinq_id")).thenReturn("demo_solo_house009");
        when(result.getString("alarm_type")).thenReturn("MEAL");
        when(result.getString("alarm_name")).thenReturn("아침");
        when(result.getObject("alarm_time", LocalTime.class)).thenReturn(LocalTime.of(8, 30));
        when(result.getBoolean("is_enabled")).thenReturn(true);

        AlarmItem saved = repository.add("demo_solo_house009", "meal", "아침", LocalTime.of(8, 30));

        assertThat(saved.alarmId()).isEqualTo(ALARM_ID);
        assertThat(saved.type()).isEqualTo("meal");
        assertThat(saved.time()).isEqualTo("08:30");
        verify(connection).prepareStatement(contains("CAST('MANUAL' AS public.alarm_source_type_enum)"));
        verify(statement).setString(2, "MEAL");
        verify(statement).setObject(4, LocalTime.of(8, 30));
    }

    @Test
    void settingsAreReadFromAlarmSetting() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getBoolean("is_enabled")).thenReturn(true);
        when(result.getBoolean("meal_enabled")).thenReturn(true);
        when(result.getBoolean("medication_enabled")).thenReturn(false);

        assertThat(repository.settings("demo_solo_house009"))
                .isEqualTo(new AlarmSetting("demo_solo_house009", true, true, false));
        verify(connection).prepareStatement(contains("FROM public.alarm_setting"));
    }

    @Test
    void missingSettingReturnsDefaultsEvenWithoutAlarms() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThat(repository.settings("demo_solo_house009"))
                .isEqualTo(new AlarmSetting("demo_solo_house009", false, true, true));
        verify(connection, never()).prepareStatement(contains("public.alarm WHERE"));
    }

    @Test
    void upsertStoresOverallSettingWithoutUpdatingAlarmRows() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getBoolean("is_enabled")).thenReturn(true);
        when(result.getBoolean("meal_enabled")).thenReturn(true);
        when(result.getBoolean("medication_enabled")).thenReturn(true);

        AlarmSetting saved = repository.updateSettings("demo_solo_house009", true, null, null);

        assertThat(saved).isEqualTo(new AlarmSetting("demo_solo_house009", true, true, true));
        verify(connection).prepareStatement(contains("INSERT INTO public.alarm_setting"));
        verify(connection).prepareStatement(contains("updated_at = now()"));
        verify(connection, never()).prepareStatement(startsWith("UPDATE public.alarm "));
        verify(statement).setBoolean(2, true);
        verify(statement).setNull(3, Types.BOOLEAN);
        verify(statement).setNull(4, Types.BOOLEAN);
        verify(statement).setBoolean(5, true);
        verify(statement).setNull(6, Types.BOOLEAN);
        verify(statement).setNull(7, Types.BOOLEAN);
    }

    @Test
    void partialUpsertKeepsMissingValuesAndStoresTypeSettingsIndependently() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getBoolean("is_enabled")).thenReturn(false);
        when(result.getBoolean("meal_enabled")).thenReturn(false);
        when(result.getBoolean("medication_enabled")).thenReturn(true);

        AlarmSetting saved = repository.updateSettings("demo_solo_house009", null, false, true);

        assertThat(saved).isEqualTo(new AlarmSetting("demo_solo_house009", false, false, true));
        verify(connection).prepareStatement(contains(
                "is_enabled = COALESCE(CAST(? AS boolean), alarm_setting.is_enabled)"));
        verify(connection).prepareStatement(contains(
                "meal_enabled = COALESCE(CAST(? AS boolean), alarm_setting.meal_enabled)"));
        verify(connection).prepareStatement(contains(
                "medication_enabled = COALESCE(CAST(? AS boolean), alarm_setting.medication_enabled)"));
        verify(statement).setNull(2, Types.BOOLEAN);
        verify(statement).setBoolean(3, false);
        verify(statement).setBoolean(4, true);
        verify(statement).setNull(5, Types.BOOLEAN);
        verify(statement).setBoolean(6, false);
        verify(statement).setBoolean(7, true);
    }

    @Test
    void settingsDatabaseFailureRemainsUnavailable() throws SQLException {
        when(database.connect()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.settings("demo_solo_house009"))
                .isInstanceOf(AlarmStoreUnavailableException.class)
                .hasMessage("알림 저장소를 사용할 수 없습니다.");
    }

    @Test
    void databaseFailureIsDistinctFromMissingAlarm() throws SQLException {
        when(database.connect()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.list("demo_solo_house009"))
                .isInstanceOf(AlarmStoreUnavailableException.class)
                .hasMessage("알림 저장소를 사용할 수 없습니다.");
    }
}
