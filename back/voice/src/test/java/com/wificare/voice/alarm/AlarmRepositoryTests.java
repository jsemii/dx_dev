package com.wificare.voice.alarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;

import com.wificare.voice.db.VoiceDatabase;
import org.junit.jupiter.api.Test;

class AlarmRepositoryTests {
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
        verify(connection).prepareStatement(org.mockito.ArgumentMatchers.contains(
                "WHERE home_id = ? ORDER BY time, type, alarm_id"));
        verify(statement).setString(1, "demo_solo_house009");
    }

    @Test
    void patchFiltersByBothIdAndHomeAndReturnsNotFoundForOtherHome() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.setEnabled(7, "other_home", false))
                .isInstanceOf(AlarmNotFoundException.class);
        verify(connection).prepareStatement(org.mockito.ArgumentMatchers.contains(
                "WHERE alarm_id = ? AND home_id = ?"));
        verify(statement).setBoolean(1, false);
        verify(statement).setLong(2, 7);
        verify(statement).setString(3, "other_home");
    }

    @Test
    void insertionBindsLocalTimeWithoutTimezoneConversion() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getLong("alarm_id")).thenReturn(8L);
        when(result.getString("home_id")).thenReturn("demo_solo_house009");
        when(result.getString("type")).thenReturn("meal");
        when(result.getString("name")).thenReturn("아침");
        when(result.getObject("time", LocalTime.class)).thenReturn(LocalTime.of(8, 30));
        when(result.getBoolean("enabled")).thenReturn(true);

        AlarmItem saved = repository.add("demo_solo_house009", "meal", "아침", LocalTime.of(8, 30));

        assertThat(saved.time()).isEqualTo("08:30");
        verify(statement).setObject(4, LocalTime.of(8, 30));
    }

    @Test
    void databaseFailureIsDistinctFromMissingAlarm() throws SQLException {
        when(database.connect()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.list("demo_solo_house009"))
                .isInstanceOf(AlarmStoreUnavailableException.class)
                .hasMessage("알림 저장소를 사용할 수 없습니다.");
    }
}
