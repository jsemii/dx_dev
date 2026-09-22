package com.wificare.voice.service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Repository;

@Repository
public class VoiceProfileRepository {
    private final Environment environment;

    public VoiceProfileRepository(Environment environment) {
        this.environment = environment;
    }

    private String setting(String key) {
        String value = environment.getProperty(key);
        if (value == null || value.isBlank()) {
            throw new VoiceStoreUnavailableException();
        }
        return value;
    }

    private Connection connect() throws SQLException {
        String host = setting("PGHOST");
        String port = environment.getProperty("PGPORT", "5432");
        String database = setting("PGDATABASE");
        if (!port.matches("[0-9]{1,5}")) {
            throw new VoiceStoreUnavailableException();
        }
        Properties properties = new Properties();
        properties.setProperty("user", setting("PGUSER"));
        properties.setProperty("password", setting("PGPASSWORD"));
        properties.setProperty("sslmode", environment.getProperty("PGSSLMODE", "require"));
        properties.setProperty("connectTimeout", "5");
        properties.setProperty("socketTimeout", "10");
        return DriverManager.getConnection("jdbc:postgresql://" + host + ":" + port + "/" + database, properties);
    }

    public void ensureReady() {
        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT voice_id FROM public.voice_data LIMIT 0")) {
            statement.executeQuery();
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }

    public RegisteredVoice save(String homeId, String voiceId, String name, boolean requiresVerification) {
        String sql = "INSERT INTO public.voice_data "
                + "(home_id, voice_id, display_name, requires_verification) VALUES (?, ?, ?, ?) "
                + "RETURNING created_at";
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            statement.setString(3, name);
            statement.setBoolean(4, requiresVerification);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                Instant createdAt = result.getTimestamp(1).toInstant();
                return new RegisteredVoice(voiceId, name, requiresVerification, createdAt);
            }
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }

    public List<RegisteredVoice> list(String homeId) {
        String sql = "SELECT voice_id, display_name, requires_verification, created_at "
                + "FROM public.voice_data WHERE home_id = ? ORDER BY created_at DESC, voice_id";
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<RegisteredVoice> voices = new ArrayList<>();
                while (result.next()) {
                    voices.add(new RegisteredVoice(result.getString(1), result.getString(2),
                            result.getBoolean(3), result.getTimestamp(4).toInstant()));
                }
                return voices;
            }
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }

    public RegisteredVoice rename(String homeId, String voiceId, String name) {
        String sql = "UPDATE public.voice_data SET display_name = ? "
                + "WHERE home_id = ? AND voice_id = ? "
                + "RETURNING requires_verification, created_at";
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, name);
            statement.setString(2, homeId);
            statement.setString(3, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new VoiceNotFoundException();
                return new RegisteredVoice(voiceId, name, result.getBoolean(1), result.getTimestamp(2).toInstant());
            }
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }

    public RegisteredVoice requireOwned(String homeId, String voiceId) {
        String sql = "SELECT display_name, requires_verification, created_at "
                + "FROM public.voice_data WHERE home_id = ? AND voice_id = ?";
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new VoiceNotFoundException();
                return new RegisteredVoice(voiceId, result.getString(1), result.getBoolean(2),
                        result.getTimestamp(3).toInstant());
            }
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }

    public void delete(String homeId, String voiceId) {
        String sql = "DELETE FROM public.voice_data WHERE home_id = ? AND voice_id = ?";
        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            if (statement.executeUpdate() != 1) throw new VoiceNotFoundException();
        } catch (SQLException error) {
            throw new VoiceStoreUnavailableException(error);
        }
    }
}
