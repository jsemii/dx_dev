package com.wificare.voice.service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.SharedPhrase;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

@Repository
public class VoiceProfileRepository {
    private static final Logger log = LoggerFactory.getLogger(VoiceProfileRepository.class);
    private static final String JSON_VOICE_COLUMNS = "entry->>'voice_id' AS voice_id, "
            + "entry->>'display_name' AS display_name, "
            + "COALESCE((entry->>'requires_verification')::boolean, false) AS requires_verification, "
            + "(entry->>'created_at')::timestamptz AS created_at";

    private final VoiceDatabase database;

    public VoiceProfileRepository(VoiceDatabase database) {
        this.database = database;
    }

    public void ensureReady() {
        try (Connection connection = database.connect();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT resident_thinq_id FROM public.voice_profile LIMIT 0")) {
            statement.executeQuery();
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public RegisteredVoice save(String homeId, String voiceId, String name, boolean requiresVerification) {
        Instant createdAt = Instant.now();
        String sql = "WITH input AS ("
                + "SELECT CAST(? AS varchar(128)) AS resident_id, "
                + "CAST(? AS text) AS voice_id, CAST(? AS text) AS display_name, "
                + "CAST(? AS boolean) AS requires_verification, CAST(? AS text) AS created_at"
                + "), upserted AS ("
                + "INSERT INTO public.voice_profile AS stored "
                + "(resident_thinq_id, default_voice_id, voice_profiles, shared_phrases) "
                + "SELECT resident_id, CASE WHEN requires_verification THEN NULL ELSE voice_id END, "
                + "jsonb_build_array(jsonb_build_object("
                + "'voice_id', voice_id, 'display_name', display_name, "
                + "'requires_verification', requires_verification, 'created_at', created_at)), "
                + "'[]'::jsonb FROM input "
                + "ON CONFLICT (resident_thinq_id) DO UPDATE SET "
                + "voice_profiles = CASE WHEN EXISTS ("
                + "SELECT 1 FROM jsonb_array_elements(stored.voice_profiles) existing "
                + "WHERE existing->>'voice_id' = (SELECT voice_id FROM input)"
                + ") THEN stored.voice_profiles ELSE stored.voice_profiles || EXCLUDED.voice_profiles END, "
                + "default_voice_id = COALESCE(stored.default_voice_id, ("
                + "SELECT candidate->>'voice_id' FROM jsonb_array_elements("
                + "CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(stored.voice_profiles) existing "
                + "WHERE existing->>'voice_id' = (SELECT voice_id FROM input)) "
                + "THEN stored.voice_profiles ELSE stored.voice_profiles || EXCLUDED.voice_profiles END"
                + ") WITH ORDINALITY candidates(candidate, ordinal) "
                + "WHERE COALESCE((candidate->>'requires_verification')::boolean, true) = false "
                + "ORDER BY ordinal LIMIT 1)) "
                + "RETURNING voice_profiles"
                + ") SELECT " + JSON_VOICE_COLUMNS + " FROM upserted "
                + "CROSS JOIN LATERAL jsonb_array_elements(voice_profiles) entry "
                + "WHERE entry->>'voice_id' = (SELECT voice_id FROM input)";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            statement.setString(3, name);
            statement.setBoolean(4, requiresVerification);
            statement.setString(5, createdAt.toString());
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new SQLException("Saved voice was not returned", "P0002");
                return voice(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public List<RegisteredVoice> list(String homeId) {
        String sql = "SELECT " + JSON_VOICE_COLUMNS + " FROM public.voice_profile profile "
                + "CROSS JOIN LATERAL jsonb_array_elements(profile.voice_profiles) entry "
                + "WHERE profile.resident_thinq_id = ? "
                + "ORDER BY (entry->>'created_at')::timestamptz DESC, entry->>'voice_id'";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<RegisteredVoice> voices = new ArrayList<>();
                while (result.next()) voices.add(voice(result));
                return voices;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public List<SharedPhrase> listSharedPhrases(String homeId) {
        String sql = "SELECT (entry->>'phrase_id')::uuid AS phrase_id, entry->>'text' AS text, "
                + "(entry->>'created_at')::timestamptz AS created_at "
                + "FROM public.voice_profile profile "
                + "CROSS JOIN LATERAL jsonb_array_elements(profile.shared_phrases) "
                + "WITH ORDINALITY entries(entry, ordinal) "
                + "WHERE profile.resident_thinq_id = ? ORDER BY ordinal";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<SharedPhrase> phrases = new ArrayList<>();
                while (result.next()) phrases.add(sharedPhrase(result));
                return phrases;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public SharedPhrase addSharedPhrase(String homeId, String text) {
        UUID phraseId = UUID.randomUUID();
        Instant createdAt = Instant.now();
        String sql = "WITH input AS ("
                + "SELECT CAST(? AS varchar(128)) AS resident_id, CAST(? AS uuid) AS phrase_id, "
                + "CAST(? AS text) AS phrase_text, CAST(? AS text) AS created_at"
                + "), upserted AS ("
                + "INSERT INTO public.voice_profile AS stored "
                + "(resident_thinq_id, default_voice_id, voice_profiles, shared_phrases) "
                + "SELECT resident_id, NULL, '[]'::jsonb, jsonb_build_array(jsonb_build_object("
                + "'phrase_id', phrase_id, 'text', phrase_text, 'created_at', created_at)) FROM input "
                + "ON CONFLICT (resident_thinq_id) DO UPDATE SET "
                + "shared_phrases = stored.shared_phrases || EXCLUDED.shared_phrases "
                + "WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(stored.shared_phrases) existing "
                + "WHERE existing->>'text' = (SELECT phrase_text FROM input)) "
                + "RETURNING shared_phrases"
                + ") SELECT (entry->>'phrase_id')::uuid AS phrase_id, entry->>'text' AS text, "
                + "(entry->>'created_at')::timestamptz AS created_at FROM upserted "
                + "CROSS JOIN LATERAL jsonb_array_elements(shared_phrases) entry "
                + "WHERE (entry->>'phrase_id')::uuid = (SELECT phrase_id FROM input)";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setObject(2, phraseId);
            statement.setString(3, text);
            statement.setString(4, createdAt.toString());
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new DuplicateSharedPhraseException();
                return sharedPhrase(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public RegisteredVoice rename(String homeId, String voiceId, String name) {
        String sql = "WITH updated AS ("
                + "UPDATE public.voice_profile profile SET voice_profiles = ("
                + "SELECT jsonb_agg(CASE WHEN entry->>'voice_id' = ? "
                + "THEN jsonb_set(entry, '{display_name}', to_jsonb(CAST(? AS text)), true) "
                + "ELSE entry END ORDER BY ordinal) "
                + "FROM jsonb_array_elements(profile.voice_profiles) WITH ORDINALITY entries(entry, ordinal)"
                + ") WHERE profile.resident_thinq_id = ? AND EXISTS ("
                + "SELECT 1 FROM jsonb_array_elements(profile.voice_profiles) owned "
                + "WHERE owned->>'voice_id' = ?) RETURNING voice_profiles"
                + ") SELECT " + JSON_VOICE_COLUMNS + " FROM updated "
                + "CROSS JOIN LATERAL jsonb_array_elements(voice_profiles) entry "
                + "WHERE entry->>'voice_id' = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, voiceId);
            statement.setString(2, name);
            statement.setString(3, homeId);
            statement.setString(4, voiceId);
            statement.setString(5, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new VoiceNotFoundException();
                return voice(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public RegisteredVoice updateVoiceAndPhrases(String homeId, String voiceId, String name,
            List<String> newPhrases) {
        List<String> phrases = newPhrases == null ? List.of() : List.copyOf(newPhrases);
        try (Connection connection = database.connect()) {
            connection.setAutoCommit(false);
            try {
                lockAndCheckVoiceUpdate(connection, homeId, voiceId, phrases);
                RegisteredVoice updated = updateLockedVoice(connection, homeId, voiceId, name, phrases);
                connection.commit();
                return updated;
            } catch (SQLException error) {
                rollbackQuietly(connection);
                throw error;
            } catch (RuntimeException error) {
                rollbackQuietly(connection);
                throw error;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private void lockAndCheckVoiceUpdate(Connection connection, String homeId, String voiceId,
            List<String> phrases) throws SQLException {
        String duplicateCheck = phrases.isEmpty() ? "false" : "EXISTS ("
                + "SELECT 1 FROM jsonb_array_elements(profile.shared_phrases) existing "
                + "WHERE existing->>'text' IN (" + placeholders(phrases.size()) + "))";
        String sql = "SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(profile.voice_profiles) owned "
                + "WHERE owned->>'voice_id' = ?) AS owned, " + duplicateCheck + " AS duplicate "
                + "FROM public.voice_profile profile WHERE profile.resident_thinq_id = ? FOR UPDATE";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            int parameter = 1;
            statement.setString(parameter++, voiceId);
            for (String phrase : phrases) statement.setString(parameter++, phrase);
            statement.setString(parameter, homeId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || !result.getBoolean("owned")) throw new VoiceNotFoundException();
                if (result.getBoolean("duplicate")) throw new DuplicateSharedPhraseException();
            }
        }
    }

    private RegisteredVoice updateLockedVoice(Connection connection, String homeId, String voiceId, String name,
            List<String> phrases) throws SQLException {
        String additions = phrases.isEmpty() ? "'[]'::jsonb" : "jsonb_build_array("
                + String.join(", ", phrases.stream().map(ignored -> "jsonb_build_object("
                        + "'phrase_id', CAST(? AS text), 'text', CAST(? AS text), "
                        + "'created_at', CAST(? AS text))").toList()) + ")";
        String sql = "WITH updated AS ("
                + "UPDATE public.voice_profile profile SET voice_profiles = ("
                + "SELECT jsonb_agg(CASE WHEN entry->>'voice_id' = ? "
                + "THEN jsonb_set(entry, '{display_name}', to_jsonb(CAST(? AS text)), true) "
                + "ELSE entry END ORDER BY ordinal) "
                + "FROM jsonb_array_elements(profile.voice_profiles) WITH ORDINALITY entries(entry, ordinal)"
                + "), shared_phrases = profile.shared_phrases || " + additions + " "
                + "WHERE profile.resident_thinq_id = ? AND EXISTS ("
                + "SELECT 1 FROM jsonb_array_elements(profile.voice_profiles) owned "
                + "WHERE owned->>'voice_id' = ?) RETURNING voice_profiles"
                + ") SELECT " + JSON_VOICE_COLUMNS + " FROM updated "
                + "CROSS JOIN LATERAL jsonb_array_elements(voice_profiles) entry "
                + "WHERE entry->>'voice_id' = ?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            int parameter = 1;
            statement.setString(parameter++, voiceId);
            statement.setString(parameter++, name);
            for (String phrase : phrases) {
                statement.setString(parameter++, UUID.randomUUID().toString());
                statement.setString(parameter++, phrase);
                statement.setString(parameter++, Instant.now().toString());
            }
            statement.setString(parameter++, homeId);
            statement.setString(parameter++, voiceId);
            statement.setString(parameter, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new VoiceNotFoundException();
                return voice(result);
            }
        }
    }

    private static String placeholders(int count) {
        return String.join(", ", java.util.Collections.nCopies(count, "?"));
    }

    private static void rollbackQuietly(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // Preserve the original validation or storage error.
        }
    }

    public RegisteredVoice requireOwned(String homeId, String voiceId) {
        String sql = "SELECT " + JSON_VOICE_COLUMNS + " FROM public.voice_profile profile "
                + "CROSS JOIN LATERAL jsonb_array_elements(profile.voice_profiles) entry "
                + "WHERE profile.resident_thinq_id = ? AND entry->>'voice_id' = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new VoiceNotFoundException();
                return voice(result);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public void delete(String homeId, String voiceId) {
        String sql = "WITH input AS ("
                + "SELECT CAST(? AS varchar(128)) AS resident_id, CAST(? AS text) AS voice_id"
                + "), target AS ("
                + "SELECT profile.resident_thinq_id, profile.default_voice_id, profile.voice_profiles "
                + "FROM public.voice_profile profile, input "
                + "WHERE profile.resident_thinq_id = input.resident_id FOR UPDATE"
                + "), filtered AS ("
                + "SELECT target.resident_thinq_id, target.default_voice_id, "
                + "(SELECT COALESCE(jsonb_agg(entry ORDER BY ordinal), '[]'::jsonb) "
                + "FROM jsonb_array_elements(target.voice_profiles) WITH ORDINALITY entries(entry, ordinal) "
                + "WHERE entry->>'voice_id' <> input.voice_id) AS remaining, "
                + "(SELECT candidate->>'voice_id' "
                + "FROM jsonb_array_elements(target.voice_profiles) WITH ORDINALITY candidates(candidate, ordinal) "
                + "WHERE candidate->>'voice_id' <> input.voice_id "
                + "AND COALESCE((candidate->>'requires_verification')::boolean, true) = false "
                + "ORDER BY ordinal LIMIT 1) AS next_default, "
                + "EXISTS (SELECT 1 FROM jsonb_array_elements(target.voice_profiles) owned "
                + "WHERE owned->>'voice_id' = input.voice_id) AS found "
                + "FROM target, input"
                + "), updated AS ("
                + "UPDATE public.voice_profile profile SET voice_profiles = filtered.remaining, "
                + "default_voice_id = CASE WHEN profile.default_voice_id = (SELECT voice_id FROM input) "
                + "THEN filtered.next_default ELSE profile.default_voice_id END "
                + "FROM filtered WHERE profile.resident_thinq_id = filtered.resident_thinq_id "
                + "AND filtered.found RETURNING 1"
                + ") SELECT EXISTS (SELECT 1 FROM updated) AS deleted";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, voiceId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || !result.getBoolean("deleted")) throw new VoiceNotFoundException();
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private static RegisteredVoice voice(ResultSet result) throws SQLException {
        Timestamp createdAt = result.getTimestamp("created_at");
        if (createdAt == null) throw new SQLException("Voice creation time is missing", "22004");
        return new RegisteredVoice(result.getString("voice_id"), result.getString("display_name"),
                result.getBoolean("requires_verification"), createdAt.toInstant());
    }

    private static SharedPhrase sharedPhrase(ResultSet result) throws SQLException {
        Timestamp createdAt = result.getTimestamp("created_at");
        if (createdAt == null) throw new SQLException("Shared phrase creation time is missing", "22004");
        return new SharedPhrase(result.getObject("phrase_id", UUID.class), result.getString("text"),
                createdAt.toInstant());
    }

    private static VoiceStoreUnavailableException unavailable(Exception error) {
        if (error instanceof SQLException sqlError) {
            log.warn("Voice profile DB operation failed: SQLSTATE={}", sqlError.getSQLState());
        }
        return new VoiceStoreUnavailableException(error);
    }
}
