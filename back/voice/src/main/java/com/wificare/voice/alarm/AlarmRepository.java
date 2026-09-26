package com.wificare.voice.alarm;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import com.wificare.voice.db.VoiceDatabase;

@Repository
public class AlarmRepository {
    private static final Logger log = LoggerFactory.getLogger(AlarmRepository.class);
    private static final String COLUMNS = "alarm_id, resident_thinq_id, alarm_type::text AS alarm_type, "
            + "alarm_name, alarm_time, is_enabled";
    private final VoiceDatabase database;

    public AlarmRepository(VoiceDatabase database) {
        this.database = database;
    }

    public List<AlarmItem> list(String homeId) {
        String sql = "SELECT " + COLUMNS + " FROM public.alarm WHERE resident_thinq_id = ? "
                + "ORDER BY alarm_time, alarm_type, alarm_id";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<AlarmItem> items = new ArrayList<>();
                while (result.next()) items.add(item(result));
                return items;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmItem add(String homeId, String type, String name, LocalTime time) {
        String sql = "INSERT INTO public.alarm "
                + "(resident_thinq_id, alarm_type, alarm_name, alarm_time, source_type) "
                + "VALUES (?, CAST(? AS public.alarm_type_enum), ?, ?, "
                + "CAST('MANUAL' AS public.alarm_source_type_enum)) "
                + "RETURNING " + COLUMNS;
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, type.toUpperCase(Locale.ROOT));
            statement.setString(3, name);
            statement.setObject(4, time);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return item(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmItem setEnabled(UUID alarmId, String homeId, boolean enabled) {
        String sql = "UPDATE public.alarm SET is_enabled = ? "
                + "WHERE alarm_id = ? AND resident_thinq_id = ? RETURNING " + COLUMNS;
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setBoolean(1, enabled);
            statement.setObject(2, alarmId);
            statement.setString(3, homeId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new AlarmNotFoundException();
                return item(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmSetting settings(String homeId) {
        String sql = "SELECT is_enabled, meal_enabled, medication_enabled "
                + "FROM public.alarm_setting WHERE resident_thinq_id = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? setting(homeId, result) : new AlarmSetting(homeId, false, true, true);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmSetting updateSettings(String homeId, Boolean enabled, Boolean mealEnabled,
            Boolean medicationEnabled) {
        String sql = "INSERT INTO public.alarm_setting "
                + "(resident_thinq_id, is_enabled, meal_enabled, medication_enabled) "
                + "VALUES (?, COALESCE(CAST(? AS boolean), false), "
                + "COALESCE(CAST(? AS boolean), true), COALESCE(CAST(? AS boolean), true)) "
                + "ON CONFLICT (resident_thinq_id) DO UPDATE SET "
                + "is_enabled = COALESCE(CAST(? AS boolean), alarm_setting.is_enabled), "
                + "meal_enabled = COALESCE(CAST(? AS boolean), alarm_setting.meal_enabled), "
                + "medication_enabled = COALESCE(CAST(? AS boolean), alarm_setting.medication_enabled), "
                + "updated_at = now() "
                + "RETURNING is_enabled, meal_enabled, medication_enabled";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            setBoolean(statement, 2, enabled);
            setBoolean(statement, 3, mealEnabled);
            setBoolean(statement, 4, medicationEnabled);
            setBoolean(statement, 5, enabled);
            setBoolean(statement, 6, mealEnabled);
            setBoolean(statement, 7, medicationEnabled);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return setting(homeId, result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private static AlarmItem item(ResultSet result) throws SQLException {
        return new AlarmItem(result.getObject("alarm_id", UUID.class), result.getString("resident_thinq_id"),
                result.getString("alarm_type").toLowerCase(Locale.ROOT), result.getString("alarm_name"),
                AlarmValidation.displayTime(result.getObject("alarm_time", LocalTime.class)),
                result.getBoolean("is_enabled"));
    }

    private static AlarmSetting setting(String homeId, ResultSet result) throws SQLException {
        return new AlarmSetting(homeId, result.getBoolean("is_enabled"),
                result.getBoolean("meal_enabled"), result.getBoolean("medication_enabled"));
    }

    private static void setBoolean(PreparedStatement statement, int index, Boolean value) throws SQLException {
        if (value == null) statement.setNull(index, java.sql.Types.BOOLEAN);
        else statement.setBoolean(index, value);
    }

    private static AlarmStoreUnavailableException unavailable(Exception error) {
        if (error instanceof SQLException sqlError) log.warn("Alarm DB operation failed: SQLSTATE={}", sqlError.getSQLState());
        return new AlarmStoreUnavailableException(error);
    }
}
