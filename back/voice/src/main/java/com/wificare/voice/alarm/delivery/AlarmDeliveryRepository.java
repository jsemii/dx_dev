package com.wificare.voice.alarm.delivery;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.wificare.voice.alarm.AlarmStoreUnavailableException;
import com.wificare.voice.db.VoiceDatabase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

@Repository
public class AlarmDeliveryRepository {
    private static final Logger log = LoggerFactory.getLogger(AlarmDeliveryRepository.class);
    private static final Pattern VOICE_ID_PATTERN = Pattern.compile(
            "(?:^|;)voice_id=([A-Za-z0-9_-]{1,200})(?:;|$)");
    private static final String CLAIM_RETURNING = "delivery.delivery_id AS delivery_id, "
            + "delivery.alarm_id AS alarm_id, delivery.resident_thinq_id AS resident_thinq_id, "
            + "delivery.alarm_type::text AS alarm_type, delivery.scheduled_for AS scheduled_for, "
            + "delivery.status AS status, delivery.request_id AS request_id";

    private final VoiceDatabase database;

    public AlarmDeliveryRepository(VoiceDatabase database) {
        this.database = database;
    }

    public int discoverDue(Instant windowStart, Instant windowEnd, ZoneId zone) {
        LocalDate firstDate = windowStart.atZone(zone).toLocalDate();
        LocalDate lastDate = windowEnd.atZone(zone).toLocalDate();
        String sql = "INSERT INTO public.alarm_delivery "
                + "(alarm_id, resident_thinq_id, alarm_type, scheduled_for, status, request_id) "
                + "SELECT alarm.alarm_id, alarm.resident_thinq_id, alarm.alarm_type, "
                + "((dates.day::date + alarm.alarm_time) AT TIME ZONE 'Asia/Seoul'), "
                + "'PENDING', gen_random_uuid() "
                + "FROM public.alarm alarm "
                + "JOIN public.alarm_setting setting USING (resident_thinq_id) "
                + "CROSS JOIN generate_series(CAST(? AS date), CAST(? AS date), interval '1 day') dates(day) "
                + "WHERE alarm.is_enabled = true AND setting.is_enabled = true "
                + "AND ((alarm.alarm_type::text = 'MEAL' AND setting.meal_enabled = true) "
                + "OR (alarm.alarm_type::text = 'MEDICATION' AND setting.medication_enabled = true)) "
                + "AND ((dates.day::date + alarm.alarm_time) AT TIME ZONE 'Asia/Seoul') >= ? "
                + "AND ((dates.day::date + alarm.alarm_time) AT TIME ZONE 'Asia/Seoul') <= ? "
                + "ON CONFLICT (alarm_id, scheduled_for) DO NOTHING";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, firstDate);
            statement.setObject(2, lastDate);
            statement.setTimestamp(3, Timestamp.from(windowStart));
            statement.setTimestamp(4, Timestamp.from(windowEnd));
            return statement.executeUpdate();
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public Optional<AlarmDelivery> claimNext(Instant windowStart, Instant windowEnd) {
        String sql = "WITH candidate AS ("
                + "SELECT delivery_id FROM public.alarm_delivery "
                + "WHERE status = 'PENDING' AND scheduled_for >= ? AND scheduled_for <= ? "
                + "ORDER BY scheduled_for, delivery_id FOR UPDATE SKIP LOCKED LIMIT 1"
                + ") UPDATE public.alarm_delivery delivery SET status = 'GENERATING', updated_at = now() "
                + "FROM candidate WHERE delivery.delivery_id = candidate.delivery_id RETURNING "
                + CLAIM_RETURNING;
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setTimestamp(1, Timestamp.from(windowStart));
            statement.setTimestamp(2, Timestamp.from(windowEnd));
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(delivery(result)) : Optional.empty();
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public int expirePendingBefore(Instant cutoff) {
        String sql = "UPDATE public.alarm_delivery SET status = 'FAILED', "
                + "failure_code = COALESCE(failure_code, 'DELIVERY_GRACE_EXPIRED'), "
                + "ended_at = COALESCE(ended_at, now()), updated_at = now() "
                + "WHERE status = 'PENDING' AND scheduled_for < ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setTimestamp(1, Timestamp.from(cutoff));
            return statement.executeUpdate();
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmDeliveryAttempt resolveAttempt(AlarmDelivery delivery, Duration escalationDelay) {
        String sql = "SELECT care.care_event_id, reporting.evidence "
                + "FROM public.care_event care "
                + "JOIN public.alarm_delivery first_delivery "
                + "ON first_delivery.delivery_id = care.alarm_delivery_id "
                + "JOIN public.reporting_data reporting "
                + "ON reporting.resident_thinq_id = care.resident_thinq_id "
                + "AND reporting.metric_code = 'care_guidance_sent_event' "
                + "AND (';' || COALESCE(reporting.evidence, '') || ';') LIKE "
                + "('%;care_event_id=' || care.care_event_id::text || ';%') "
                + "AND position('attempt=1' IN reporting.evidence) > 0 "
                + "AND position('channel=SPEAKER' IN reporting.evidence) > 0 "
                + "WHERE first_delivery.alarm_id = ? "
                + "AND care.resident_thinq_id = ? AND care.care_type::text = ? "
                + "AND first_delivery.status = 'COMPLETED' "
                + "AND first_delivery.started_at IS NOT NULL "
                + "AND ? = first_delivery.started_at + (? * interval '1 second') "
                + "ORDER BY first_delivery.started_at DESC LIMIT 1";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, delivery.alarmId());
            statement.setString(2, delivery.residentThinQId());
            statement.setString(3, delivery.alarmType());
            statement.setTimestamp(4, Timestamp.from(delivery.scheduledFor()));
            statement.setLong(5, escalationDelay.toSeconds());
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) return AlarmDeliveryAttempt.first();
                Matcher voice = VOICE_ID_PATTERN.matcher(result.getString("evidence"));
                if (!voice.find()) throw new SQLException("Escalation voice evidence is missing", "P0002");
                return AlarmDeliveryAttempt.second(
                        result.getObject("care_event_id", UUID.class), voice.group(1));
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public void markSent(UUID deliveryId) {
        updateStatus(deliveryId, "SENT", null);
    }

    public void retry(UUID deliveryId, String failureCode) {
        updateStatus(deliveryId, "PENDING", failureCode);
    }

    public void fail(UUID deliveryId, String failureCode) {
        updateStatus(deliveryId, "FAILED", failureCode);
    }

    private void updateStatus(UUID deliveryId, String status, String failureCode) {
        String sql = "UPDATE public.alarm_delivery SET status = ?, failure_code = ?, updated_at = now(), "
                + "ended_at = CASE WHEN ? = 'FAILED' THEN now() ELSE ended_at END WHERE delivery_id = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, status);
            statement.setString(2, failureCode);
            statement.setString(3, status);
            statement.setObject(4, deliveryId);
            statement.executeUpdate();
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public void recordPlaybackOutcome(AlarmDelivery delivery, AlarmDeliveryAttempt attempt,
            String voiceId, AlarmPlaybackResult playback, Duration escalationDelay) {
        UUID careEventId = attempt.careEventId();
        UUID secondDeliveryId = null;
        Instant secondScheduledFor = null;
        boolean emergencyRecorded = false;
        try (Connection connection = database.connect()) {
            connection.setAutoCommit(false);
            try {
                if (playback.startedAt() != null) {
                    markPlaying(connection, delivery.deliveryId(), playback.startedAt());
                }
                finishDelivery(connection, delivery.deliveryId(), playback);
                if ("COMPLETED".equals(playback.status()) && playback.startedAt() != null) {
                    if (attempt.isSecond()) {
                        emergencyRecorded = recordSecondSuccess(
                                connection, delivery, attempt, voiceId, playback.startedAt());
                    } else {
                        FirstSuccess first = recordFirstSuccess(
                                connection, delivery, voiceId, playback.startedAt(), escalationDelay);
                        careEventId = first.careEventId();
                        secondDeliveryId = first.secondDeliveryId();
                        secondScheduledFor = first.secondScheduledFor();
                    }
                }
                connection.commit();
            } catch (SQLException | RuntimeException error) {
                rollbackQuietly(connection);
                throw error;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
        if (secondDeliveryId != null) {
            log.info("First alarm playback persisted: alarm_id={}, delivery_id={}, care_event_id={}, "
                            + "second_delivery_id={}, second_scheduled_for={}",
                    delivery.alarmId(), delivery.deliveryId(), careEventId,
                    secondDeliveryId, secondScheduledFor);
        } else if (emergencyRecorded) {
            log.info("Second alarm playback persisted: alarm_id={}, delivery_id={}, care_event_id={}, "
                            + "care_status=EMERGENCY, emergency_alerted=true",
                    delivery.alarmId(), delivery.deliveryId(), careEventId);
        }
    }

    private void markPlaying(Connection connection, UUID deliveryId, Instant startedAt) throws SQLException {
        String update = "UPDATE public.alarm_delivery SET status = 'PLAYING', started_at = COALESCE(started_at, ?), "
                + "updated_at = now() WHERE delivery_id = ?";
        try (PreparedStatement statement = connection.prepareStatement(update)) {
            statement.setTimestamp(1, Timestamp.from(startedAt));
            statement.setObject(2, deliveryId);
            statement.executeUpdate();
        }
    }

    private FirstSuccess recordFirstSuccess(Connection connection, AlarmDelivery delivery, String voiceId,
            Instant startedAt, Duration escalationDelay) throws SQLException {
        String insert = "INSERT INTO public.care_event "
                + "(resident_thinq_id, care_type, trigger_type, trigger_ref_id, guidance_at, "
                + "care_status, alarm_delivery_id) VALUES (?, ?, 'ALARM', ?, ?, 'GUIDING', ?) "
                + "ON CONFLICT (alarm_delivery_id) DO UPDATE "
                + "SET alarm_delivery_id = EXCLUDED.alarm_delivery_id RETURNING care_event_id";
        UUID careEventId;
        try (PreparedStatement statement = connection.prepareStatement(insert)) {
            statement.setString(1, delivery.residentThinQId());
            statement.setString(2, delivery.alarmType());
            statement.setString(3, delivery.alarmId().toString());
            statement.setTimestamp(4, Timestamp.from(startedAt));
            statement.setObject(5, delivery.deliveryId());
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Care event was not returned", "P0002");
                careEventId = result.getObject("care_event_id", UUID.class);
            }
        }
        insertReportingEvent(connection, delivery, careEventId, voiceId, startedAt, 1,
                "care_guidance_sent_event");

        Instant secondScheduledFor = startedAt.plus(escalationDelay);
        UUID secondRequestId = UUID.nameUUIDFromBytes(
                (careEventId + ":alarm-attempt-2").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String schedule = "INSERT INTO public.alarm_delivery "
                + "(alarm_id, resident_thinq_id, alarm_type, scheduled_for, status, request_id) "
                + "VALUES (?, ?, CAST(? AS public.alarm_type_enum), ?, 'PENDING', ?) "
                + "ON CONFLICT (alarm_id, scheduled_for) DO NOTHING RETURNING delivery_id";
        UUID secondDeliveryId = null;
        try (PreparedStatement statement = connection.prepareStatement(schedule)) {
            statement.setObject(1, delivery.alarmId());
            statement.setString(2, delivery.residentThinQId());
            statement.setString(3, delivery.alarmType());
            statement.setTimestamp(4, Timestamp.from(secondScheduledFor));
            statement.setObject(5, secondRequestId);
            try (ResultSet result = statement.executeQuery()) {
                if (result.next()) secondDeliveryId = result.getObject("delivery_id", UUID.class);
            }
        }
        if (secondDeliveryId == null) {
            String existing = "SELECT delivery_id FROM public.alarm_delivery "
                    + "WHERE alarm_id = ? AND scheduled_for = ? AND request_id = ?";
            try (PreparedStatement statement = connection.prepareStatement(existing)) {
                statement.setObject(1, delivery.alarmId());
                statement.setTimestamp(2, Timestamp.from(secondScheduledFor));
                statement.setObject(3, secondRequestId);
                try (ResultSet result = statement.executeQuery()) {
                    if (result.next()) secondDeliveryId = result.getObject("delivery_id", UUID.class);
                }
            }
        }
        if (secondDeliveryId == null) {
            throw new SQLException("Escalation delivery schedule conflict", "23505");
        }
        return new FirstSuccess(careEventId, secondDeliveryId, secondScheduledFor);
    }

    private boolean recordSecondSuccess(Connection connection, AlarmDelivery delivery,
            AlarmDeliveryAttempt attempt, String voiceId, Instant startedAt) throws SQLException {
        String emergency = "WITH updated AS ("
                + "UPDATE public.care_event SET care_status = 'EMERGENCY', emergency_alerted = true "
                + "WHERE care_event_id = ? AND resident_thinq_id = ? AND care_status = 'GUIDING' "
                + "RETURNING care_event_id) "
                + "SELECT EXISTS (SELECT 1 FROM updated) OR EXISTS ("
                + "SELECT 1 FROM public.care_event WHERE care_event_id = ? AND resident_thinq_id = ? "
                + "AND care_status = 'EMERGENCY' AND emergency_alerted = true) AS emergency";
        boolean isEmergency;
        try (PreparedStatement statement = connection.prepareStatement(emergency)) {
            statement.setObject(1, attempt.careEventId());
            statement.setString(2, delivery.residentThinQId());
            statement.setObject(3, attempt.careEventId());
            statement.setString(4, delivery.residentThinQId());
            try (ResultSet result = statement.executeQuery()) {
                isEmergency = result.next() && result.getBoolean("emergency");
            }
        }
        if (isEmergency) {
            insertReportingEvent(connection, delivery, attempt.careEventId(), voiceId, startedAt, 2,
                    "care_emergency_alert_sent_event");
        }
        return isEmergency;
    }

    private void insertReportingEvent(Connection connection, AlarmDelivery delivery, UUID careEventId,
            String voiceId, Instant startedAt, int attempt, String metricCode) throws SQLException {
        String subject = "MEAL".equals(delivery.alarmType()) ? "식사" : "복약";
        String evidence = "source=public.care_event;care_event_id=" + careEventId
                + ";alarm_delivery_id=" + delivery.deliveryId() + ";attempt=" + attempt
                + ";channel=SPEAKER;voice_id=" + voiceId;
        String sql = "INSERT INTO public.reporting_data ("
                + "reporting_id, resident_thinq_id, household_type, data_date, event_time, "
                + "record_type, subject_type, subject, metric_code, value, unit, "
                + "baseline_value, delta_value, baseline_days, data_status, evidence) "
                + "SELECT CAST(md5(? || ':alarm-attempt-" + attempt + "') AS uuid), ?, "
                + "COALESCE((SELECT household_type FROM public.reporting_data "
                + "WHERE resident_thinq_id = ? ORDER BY data_date DESC, event_time DESC NULLS LAST LIMIT 1), "
                + "'one_person'), (CAST(? AS timestamptz) AT TIME ZONE 'Asia/Seoul')::date, ?, "
                + "'event', 'care', ?, ?, 1, 'event', NULL, NULL, NULL, "
                + "'derived_care_event', ? ON CONFLICT (reporting_id) DO NOTHING";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, careEventId.toString());
            statement.setString(2, delivery.residentThinQId());
            statement.setString(3, delivery.residentThinQId());
            statement.setTimestamp(4, Timestamp.from(startedAt));
            statement.setTimestamp(5, Timestamp.from(startedAt));
            statement.setString(6, subject);
            statement.setString(7, metricCode);
            statement.setString(8, evidence);
            statement.executeUpdate();
        }
    }

    private record FirstSuccess(UUID careEventId, UUID secondDeliveryId, Instant secondScheduledFor) {}

    private void finishDelivery(Connection connection, UUID deliveryId, AlarmPlaybackResult playback)
            throws SQLException {
        String status = "COMPLETED".equals(playback.status()) ? "COMPLETED" : "FAILED";
        String sql = "UPDATE public.alarm_delivery SET status = ?, ended_at = ?, failure_code = ?, "
                + "updated_at = now() WHERE delivery_id = ?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, status);
            statement.setTimestamp(2, playback.endedAt() == null ? Timestamp.from(Instant.now())
                    : Timestamp.from(playback.endedAt()));
            statement.setString(3, playback.failureCode());
            statement.setObject(4, deliveryId);
            statement.executeUpdate();
        }
    }

    private static AlarmDelivery delivery(ResultSet result) throws SQLException {
        return new AlarmDelivery(
                result.getObject("delivery_id", UUID.class),
                result.getObject("alarm_id", UUID.class),
                result.getString("resident_thinq_id"),
                result.getString("alarm_type"),
                result.getTimestamp("scheduled_for").toInstant(),
                result.getString("status"),
                result.getObject("request_id", UUID.class));
    }

    private static void rollbackQuietly(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // Preserve the original error.
        }
    }

    private static AlarmStoreUnavailableException unavailable(Exception error) {
        if (error instanceof SQLException sqlError) {
            log.warn("Alarm delivery DB operation failed: SQLSTATE={}", sqlError.getSQLState());
        }
        return new AlarmStoreUnavailableException(error);
    }
}
