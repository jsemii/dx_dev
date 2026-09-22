package com.wificare.voice.alarm;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import com.wificare.voice.db.VoiceDatabase;

@Repository
public class AlarmRepository {
    private static final Logger log = LoggerFactory.getLogger(AlarmRepository.class);
    private static final String COLUMNS = "alarm_id, home_id, type, name, time, enabled";
    private final VoiceDatabase database;

    public AlarmRepository(VoiceDatabase database) {
        this.database = database;
    }

    public List<AlarmItem> list(String homeId) {
        String sql = "SELECT " + COLUMNS + " FROM public.alarm WHERE home_id = ? ORDER BY time, type, alarm_id";
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
        String sql = "INSERT INTO public.alarm (home_id, type, name, time) VALUES (?, ?, ?, ?) RETURNING " + COLUMNS;
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, type);
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

    public AlarmItem setEnabled(long alarmId, String homeId, boolean enabled) {
        String sql = "UPDATE public.alarm SET enabled = ? WHERE alarm_id = ? AND home_id = ? RETURNING " + COLUMNS;
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setBoolean(1, enabled);
            statement.setLong(2, alarmId);
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
        String sql = "SELECT home_id, enabled, meal_enabled, medication_enabled "
                + "FROM public.alarm_setting WHERE home_id = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? setting(result) : new AlarmSetting(homeId, true, true, true);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public AlarmSetting updateSettings(String homeId, Boolean enabled, Boolean mealEnabled,
            Boolean medicationEnabled) {
        String sql = "INSERT INTO public.alarm_setting "
                + "(home_id, enabled, meal_enabled, medication_enabled) "
                + "VALUES (?, COALESCE(?::boolean, true), COALESCE(?::boolean, true), COALESCE(?::boolean, true)) "
                + "ON CONFLICT (home_id) DO UPDATE SET "
                + "enabled = COALESCE(?::boolean, alarm_setting.enabled), "
                + "meal_enabled = COALESCE(?::boolean, alarm_setting.meal_enabled), "
                + "medication_enabled = COALESCE(?::boolean, alarm_setting.medication_enabled), "
                + "updated_at = now() "
                + "RETURNING home_id, enabled, meal_enabled, medication_enabled";
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
                return setting(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private static AlarmItem item(ResultSet result) throws SQLException {
        return new AlarmItem(result.getLong("alarm_id"), result.getString("home_id"),
                result.getString("type"), result.getString("name"),
                AlarmValidation.displayTime(result.getObject("time", LocalTime.class)),
                result.getBoolean("enabled"));
    }

    private static AlarmSetting setting(ResultSet result) throws SQLException {
        return new AlarmSetting(result.getString("home_id"), result.getBoolean("enabled"),
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
