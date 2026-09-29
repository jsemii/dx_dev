package com.wificare.voice.alarm.delivery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import org.junit.jupiter.api.Test;

class AlarmDeliveryRepositoryTests {
    private static final Instant START = Instant.parse("2026-09-29T23:59:00Z");
    private static final Instant END = Instant.parse("2026-09-30T00:01:00Z");
    private final VoiceDatabase database = mock(VoiceDatabase.class);
    private final Connection connection = mock(Connection.class);
    private final PreparedStatement statement = mock(PreparedStatement.class);
    private final ResultSet result = mock(ResultSet.class);
    private final AlarmDeliveryRepository repository = new AlarmDeliveryRepository(database);

    private void query() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
    }

    @Test
    void discoveryUsesKstAndAllFourEnableFlagsWithAtomicUniqueInsert() throws SQLException {
        query();
        when(statement.executeUpdate()).thenReturn(1);

        assertThat(repository.discoverDue(START, END, AlarmDeliveryProperties.KST)).isEqualTo(1);

        verify(connection).prepareStatement(contains("AT TIME ZONE 'Asia/Seoul'"));
        verify(connection).prepareStatement(contains("alarm.is_enabled = true"));
        verify(connection).prepareStatement(contains("setting.is_enabled = true"));
        verify(connection).prepareStatement(contains("setting.meal_enabled = true"));
        verify(connection).prepareStatement(contains("setting.medication_enabled = true"));
        verify(connection).prepareStatement(contains("ON CONFLICT (alarm_id, scheduled_for) DO NOTHING"));
        verify(statement).setObject(1, LocalDate.of(2026, 9, 30));
        verify(statement).setObject(2, LocalDate.of(2026, 9, 30));
    }

    @Test
    void claimUsesOneAtomicSkipLockedUpdateForMultipleServers() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        Optional<AlarmDelivery> claimed = repository.claimNext(START, END);

        assertThat(claimed).isEmpty();
        verify(connection).prepareStatement(contains("FOR UPDATE SKIP LOCKED LIMIT 1"));
        verify(connection).prepareStatement(contains("SET status = 'GENERATING'"));
        verify(connection).prepareStatement(contains("WHERE status = 'PENDING'"));
        verify(connection).prepareStatement(contains("RETURNING delivery.delivery_id AS delivery_id"));
        verify(connection).prepareStatement(contains("delivery.request_id AS request_id"));
    }

    @Test
    void pendingDeliveryOutsideGraceIsMarkedFailed() throws SQLException {
        query();
        when(statement.executeUpdate()).thenReturn(1);

        assertThat(repository.expirePendingBefore(START)).isEqualTo(1);

        verify(connection).prepareStatement(contains("WHERE status = 'PENDING' AND scheduled_for < ?"));
        verify(connection).prepareStatement(contains("DELIVERY_GRACE_EXPIRED"));
        verify(statement).setTimestamp(1, java.sql.Timestamp.from(START));
    }

    @Test
    void missingPlayingAckNeverCreatesCareEvent() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult failed = new AlarmPlaybackResult(
                delivery.requestId(), "FAILED", null, END, "PLAYBACK_ACK_TIMEOUT");

        repository.recordPlaybackOutcome(delivery, failed);

        verify(connection, never()).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection, never()).commit();
    }

    @Test
    void playingAckCreatesOneDeliveryLinkedCareEvent() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult completed = new AlarmPlaybackResult(
                delivery.requestId(), "COMPLETED", START, END, null);

        repository.recordPlaybackOutcome(delivery, completed);

        verify(connection).prepareStatement(contains("status = 'PLAYING'"));
        verify(connection).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection).prepareStatement(contains("ON CONFLICT (alarm_delivery_id) DO NOTHING"));
        verify(connection).commit();
    }

    @Test
    void migrationContainsDailyAndCareEventUniqueness() throws Exception {
        String migration = Files.readString(Path.of("db/create_alarm_delivery.sql"));
        assertThat(migration).contains("UNIQUE (alarm_id, scheduled_for)");
        assertThat(migration).contains("CREATE UNIQUE INDEX IF NOT EXISTS care_event_alarm_delivery_key");
        assertThat(migration).contains("timestamptz NOT NULL");
        assertThat(migration).contains("PENDING", "GENERATING", "SENT", "PLAYING", "COMPLETED", "FAILED");
    }

    private static AlarmDelivery delivery() {
        return new AlarmDelivery(
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                UUID.fromString("22222222-2222-4222-8222-222222222222"),
                "home_23", "MEAL", START, "GENERATING",
                UUID.fromString("33333333-3333-4333-8333-333333333333"));
    }
}
