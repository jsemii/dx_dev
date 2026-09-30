package com.wificare.voice.alarm.delivery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import com.wificare.voice.alarm.AlarmStoreUnavailableException;
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
    void claimBeforeTheSecondScheduledTimeReturnsNothingAndUsesAnInclusiveDueBoundary() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        Optional<AlarmDelivery> claimed = repository.claimNext(START, END);

        assertThat(claimed).isEmpty();
        verify(connection).prepareStatement(contains("FOR UPDATE SKIP LOCKED LIMIT 1"));
        verify(connection).prepareStatement(contains("SET status = 'GENERATING'"));
        verify(connection).prepareStatement(contains("WHERE status = 'PENDING'"));
        verify(connection).prepareStatement(contains("scheduled_for >= ? AND scheduled_for <= ?"));
        verify(connection).prepareStatement(contains("RETURNING delivery.delivery_id AS delivery_id"));
        verify(connection).prepareStatement(contains("delivery.request_id AS request_id"));
        verify(statement).setTimestamp(2, java.sql.Timestamp.from(END));
    }

    @Test
    void claimAtTheSecondScheduledTimeReturnsTheDueDelivery() throws SQLException {
        query();
        AlarmDelivery due = delivery();
        when(result.next()).thenReturn(true);
        when(result.getObject("delivery_id", UUID.class)).thenReturn(due.deliveryId());
        when(result.getObject("alarm_id", UUID.class)).thenReturn(due.alarmId());
        when(result.getString("resident_thinq_id")).thenReturn(due.residentThinQId());
        when(result.getString("alarm_type")).thenReturn(due.alarmType());
        when(result.getTimestamp("scheduled_for")).thenReturn(java.sql.Timestamp.from(END));
        when(result.getString("status")).thenReturn("GENERATING");
        when(result.getObject("request_id", UUID.class)).thenReturn(due.requestId());

        Optional<AlarmDelivery> claimed = repository.claimNext(START, END);

        assertThat(claimed).isPresent();
        assertThat(claimed.orElseThrow().scheduledFor()).isEqualTo(END);
        verify(statement).setTimestamp(2, java.sql.Timestamp.from(END));
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

        repository.recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id", failed, Duration.ofSeconds(90));

        verify(connection, never()).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.reporting_data"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.alarm_delivery"));
        verify(connection).commit();
    }

    @Test
    void firstSuccessfulPlaybackCreatesCareReportingAndExactlyOneSecondDelivery() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult completed = new AlarmPlaybackResult(
                delivery.requestId(), "COMPLETED", START, END, null);
        UUID careEventId = UUID.fromString("44444444-4444-4444-8444-444444444444");
        UUID secondDeliveryId = UUID.fromString("55555555-5555-4555-8555-555555555555");
        when(result.next()).thenReturn(true, true);
        when(result.getObject("care_event_id", UUID.class)).thenReturn(careEventId);
        when(result.getObject("delivery_id", UUID.class)).thenReturn(secondDeliveryId);

        repository.recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id", completed, Duration.ofSeconds(90));

        verify(connection).prepareStatement(contains("status = 'PLAYING'"));
        verify(connection).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection).prepareStatement(contains("INSERT INTO public.reporting_data"));
        verify(connection).prepareStatement(contains("data_status, evidence)"));
        verify(connection).prepareStatement(contains("CAST(md5(? || ':alarm-attempt-1') AS uuid)"));
        verify(connection).prepareStatement(contains("ON CONFLICT (reporting_id) DO NOTHING"));
        verify(statement).setString(7, "care_guidance_sent_event");
        verify(connection).prepareStatement(contains("INSERT INTO public.alarm_delivery"));
        verify(connection).prepareStatement(contains("CAST(? AS public.alarm_type_enum)"));
        verify(connection).prepareStatement(contains(
                "ON CONFLICT (alarm_id, scheduled_for) DO NOTHING RETURNING delivery_id"));
        verify(statement).setTimestamp(4, java.sql.Timestamp.from(START.plusSeconds(90)));
        verify(connection).commit();
    }

    @Test
    void duplicateSchedulingReusesOnlyTheSameDeterministicSecondDelivery() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        UUID careEventId = UUID.fromString("44444444-4444-4444-8444-444444444444");
        UUID existingSecond = UUID.fromString("55555555-5555-4555-8555-555555555555");
        when(result.next()).thenReturn(true, false, true);
        when(result.getObject("care_event_id", UUID.class)).thenReturn(careEventId);
        when(result.getObject("delivery_id", UUID.class)).thenReturn(existingSecond);

        repository.recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id",
                new AlarmPlaybackResult(delivery.requestId(), "COMPLETED", START, END, null),
                Duration.ofSeconds(90));

        verify(connection).prepareStatement(contains(
                "WHERE alarm_id = ? AND scheduled_for = ? AND request_id = ?"));
        verify(connection).commit();
    }

    @Test
    void conflictingDeliveryAtTheEscalationTimeRollsBackInsteadOfBeingHidden() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        UUID careEventId = UUID.fromString("44444444-4444-4444-8444-444444444444");
        when(result.next()).thenReturn(true, false, false);
        when(result.getObject("care_event_id", UUID.class)).thenReturn(careEventId);

        assertThatThrownBy(() -> repository.recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id",
                new AlarmPlaybackResult(delivery.requestId(), "COMPLETED", START, END, null),
                Duration.ofSeconds(90)))
                .isInstanceOf(AlarmStoreUnavailableException.class);

        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void failedFirstPlaybackAfterStartingStillCreatesNoSecondDelivery() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult failed = new AlarmPlaybackResult(
                delivery.requestId(), "FAILED", START, END, "PLAYER_FAILED");

        repository.recordPlaybackOutcome(
                delivery, AlarmDeliveryAttempt.first(), "provider-id", failed, Duration.ofSeconds(90));

        verify(connection, never()).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.reporting_data"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.alarm_delivery"));
        verify(connection).commit();
    }

    @Test
    void failedSecondPlaybackDoesNotCreateEmergencyOrThirdDelivery() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult failed = new AlarmPlaybackResult(
                delivery.requestId(), "FAILED", START, END, "PLAYER_FAILED");
        AlarmDeliveryAttempt second = AlarmDeliveryAttempt.second(
                UUID.fromString("44444444-4444-4444-8444-444444444444"), "provider-id");

        repository.recordPlaybackOutcome(
                delivery, second, "provider-id", failed, Duration.ofSeconds(90));

        verify(connection, never()).prepareStatement(contains("care_status = 'EMERGENCY'"));
        verify(connection, never()).prepareStatement(contains("care_emergency_alert_sent_event"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.alarm_delivery"));
        verify(connection).commit();
    }

    @Test
    void successfulSecondPlaybackUpdatesEmergencyAndCreatesNoThirdDelivery() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        AlarmPlaybackResult completed = new AlarmPlaybackResult(
                delivery.requestId(), "COMPLETED", START, END, null);
        AlarmDeliveryAttempt second = AlarmDeliveryAttempt.second(
                UUID.fromString("44444444-4444-4444-8444-444444444444"), "provider-id");
        when(result.next()).thenReturn(true);
        when(result.getBoolean("emergency")).thenReturn(true);

        repository.recordPlaybackOutcome(
                delivery, second, "provider-id", completed, Duration.ofSeconds(90));

        verify(connection).prepareStatement(contains("care_status = 'EMERGENCY'"));
        verify(connection).prepareStatement(contains("emergency_alerted = true"));
        verify(connection).prepareStatement(contains("CAST(md5(? || ':alarm-attempt-2') AS uuid)"));
        verify(connection).prepareStatement(contains("ON CONFLICT (reporting_id) DO NOTHING"));
        verify(statement).setString(7, "care_emergency_alert_sent_event");
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.alarm_delivery"));
        verify(connection, never()).prepareStatement(contains("INSERT INTO public.care_event"));
        verify(connection).commit();
    }

    @Test
    void escalationAttemptIsResolvedOnlyAtTheExactConfiguredDelay() throws SQLException {
        query();
        AlarmDelivery delivery = delivery();
        UUID careEventId = UUID.fromString("44444444-4444-4444-8444-444444444444");
        when(result.next()).thenReturn(true);
        when(result.getObject("care_event_id", UUID.class)).thenReturn(careEventId);
        when(result.getString("evidence")).thenReturn(
                "source=public.care_event;care_event_id=" + careEventId
                        + ";attempt=1;channel=SPEAKER;voice_id=provider-id");

        AlarmDeliveryAttempt attempt = repository.resolveAttempt(delivery, Duration.ofSeconds(90));

        assertThat(attempt).isEqualTo(AlarmDeliveryAttempt.second(careEventId, "provider-id"));
        verify(connection).prepareStatement(contains("care_event_id=' || care.care_event_id::text"));
        verify(connection, never()).prepareStatement(contains("reporting.care_event_id"));
        verify(connection).prepareStatement(contains("first_delivery.started_at + (? * interval '1 second')"));
        verify(statement).setTimestamp(4, java.sql.Timestamp.from(delivery.scheduledFor()));
        verify(statement).setLong(5, 90);
    }

    @Test
    void migrationContainsDailyAndCareEventUniqueness() throws Exception {
        String migration = Files.readString(Path.of("db/create_alarm_delivery.sql"));
        assertThat(migration).contains("UNIQUE (alarm_id, scheduled_for)");
        assertThat(migration).contains("CREATE UNIQUE INDEX IF NOT EXISTS care_event_alarm_delivery_key");
        assertThat(migration).contains(
                "alarm_id uuid NOT NULL REFERENCES public.alarm(alarm_id) ON DELETE CASCADE");
        assertThat(migration).contains("REFERENCES public.alarm_delivery(delivery_id)");
        assertThat(migration).contains("ON DELETE SET NULL");
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
