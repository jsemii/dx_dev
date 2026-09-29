package com.wificare.voice.alarm.delivery;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

import com.wificare.voice.alarm.AlarmStoreUnavailableException;
import com.wificare.voice.db.VoiceDatabase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

@Repository
public class AlarmDeliveryRepository {
    private static final Logger log = LoggerFactory.getLogger(AlarmDeliveryRepository.class);
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

    public void recordPlaybackOutcome(AlarmDelivery delivery, AlarmPlaybackResult playback) {
        if (playback.startedAt() != null) {
            try (Connection connection = database.connect()) {
                connection.setAutoCommit(false);
                try {
                    markPlayingAndCreateCareEvent(connection, delivery, playback.startedAt());
                    connection.commit();
                } catch (SQLException | RuntimeException error) {
                    rollbackQuietly(connection);
                    throw error;
                }
            } catch (SQLException | IllegalStateException error) {
                throw unavailable(error);
            }
        }
        try (Connection connection = database.connect()) {
            finishDelivery(connection, delivery.deliveryId(), playback);
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private void markPlayingAndCreateCareEvent(Connection connection, AlarmDelivery delivery,
            Instant startedAt) throws SQLException {
        String update = "UPDATE public.alarm_delivery SET status = 'PLAYING', started_at = COALESCE(started_at, ?), "
                + "updated_at = now() WHERE delivery_id = ?";
        try (PreparedStatement statement = connection.prepareStatement(update)) {
            statement.setTimestamp(1, Timestamp.from(startedAt));
            statement.setObject(2, delivery.deliveryId());
            statement.executeUpdate();
        }
        String insert = "INSERT INTO public.care_event "
                + "(resident_thinq_id, care_type, trigger_type, trigger_ref_id, guidance_at, "
                + "care_status, alarm_delivery_id) VALUES (?, ?, 'ALARM', ?, ?, 'GUIDING', ?) "
                + "ON CONFLICT (alarm_delivery_id) DO NOTHING";
        try (PreparedStatement statement = connection.prepareStatement(insert)) {
            statement.setString(1, delivery.residentThinQId());
            statement.setString(2, delivery.alarmType());
            statement.setString(3, delivery.alarmId().toString());
            statement.setTimestamp(4, Timestamp.from(startedAt));
            statement.setObject(5, delivery.deliveryId());
            statement.executeUpdate();
        }
    }

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
