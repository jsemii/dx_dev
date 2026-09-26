package com.wificare.voice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.SharedPhrase;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import org.junit.jupiter.api.Test;

class VoiceProfileRepositoryTests {
    private static final Instant CREATED_AT = Instant.parse("2026-09-26T05:00:00Z");
    private static final UUID PHRASE_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final VoiceDatabase database = mock(VoiceDatabase.class);
    private final Connection connection = mock(Connection.class);
    private final PreparedStatement statement = mock(PreparedStatement.class);
    private final ResultSet result = mock(ResultSet.class);
    private final VoiceProfileRepository repository = new VoiceProfileRepository(database);

    private void query() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
    }

    private void voiceRow(String voiceId, String name, boolean requiresVerification) throws SQLException {
        when(result.getString("voice_id")).thenReturn(voiceId);
        when(result.getString("display_name")).thenReturn(name);
        when(result.getBoolean("requires_verification")).thenReturn(requiresVerification);
        when(result.getTimestamp("created_at")).thenReturn(Timestamp.from(CREATED_AT));
    }

    private void phraseRow(String text) throws SQLException {
        when(result.getObject("phrase_id", UUID.class)).thenReturn(PHRASE_ID);
        when(result.getString("text")).thenReturn(text);
        when(result.getTimestamp("created_at")).thenReturn(Timestamp.from(CREATED_AT));
    }

    @Test
    void readinessChecksVoiceProfileInsteadOfDeletedVoiceData() throws SQLException {
        query();

        repository.ensureReady();

        verify(connection).prepareStatement("SELECT resident_thinq_id FROM public.voice_profile LIMIT 0");
    }

    @Test
    void firstSaveCreatesTheResidentRowAndInitializesSharedPhrases() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        voiceRow("provider-voice-id", "딸 목소리", false);

        RegisteredVoice saved = repository.save("home_23", "provider-voice-id", "딸 목소리", false);

        assertThat(saved).isEqualTo(new RegisteredVoice(
                "provider-voice-id", "딸 목소리", false, CREATED_AT));
        verify(connection).prepareStatement(contains("INSERT INTO public.voice_profile AS stored"));
        verify(connection).prepareStatement(contains("'[]'::jsonb FROM input"));
        verify(connection).prepareStatement(contains(
                "CASE WHEN requires_verification THEN NULL ELSE voice_id END"));
        verify(statement).setString(1, "home_23");
        verify(statement).setString(2, "provider-voice-id");
        verify(statement).setString(3, "딸 목소리");
        verify(statement).setBoolean(4, false);
    }

    @Test
    void upsertAppendsWithoutReplacingAndRejectsDuplicateVoiceIds() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        voiceRow("provider-voice-id", "딸 목소리", true);

        repository.save("home_23", "provider-voice-id", "딸 목소리", true);

        verify(connection).prepareStatement(contains("stored.voice_profiles || EXCLUDED.voice_profiles"));
        verify(connection).prepareStatement(contains(
                "THEN stored.voice_profiles ELSE stored.voice_profiles || EXCLUDED.voice_profiles END"));
        verify(connection).prepareStatement(contains(
                "COALESCE((candidate->>'requires_verification')::boolean, true) = false"));
    }

    @Test
    void missingResidentRowReturnsAnEmptyList() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThat(repository.list("home_23")).isEmpty();
        verify(statement).setString(1, "home_23");
    }

    @Test
    void listMapsJsonFieldsToTheExistingApiRecord() throws SQLException {
        query();
        when(result.next()).thenReturn(true, false);
        voiceRow("provider-voice-id", "딸 목소리", false);

        List<RegisteredVoice> voices = repository.list("home_23");

        assertThat(voices).containsExactly(new RegisteredVoice(
                "provider-voice-id", "딸 목소리", false, CREATED_AT));
        verify(connection).prepareStatement(contains(
                "CROSS JOIN LATERAL jsonb_array_elements(profile.voice_profiles) entry"));
        verify(connection).prepareStatement(contains("ORDER BY (entry->>'created_at')::timestamptz DESC"));
    }

    @Test
    void sharedPhraseListIsScopedToTheResidentAndKeepsJsonArrayOrder() throws SQLException {
        query();
        when(result.next()).thenReturn(true, false);
        phraseRow("약 드실 시간이에요");

        assertThat(repository.listSharedPhrases("home_23"))
                .containsExactly(new SharedPhrase(PHRASE_ID, "약 드실 시간이에요", CREATED_AT));
        verify(connection).prepareStatement(contains("profile.shared_phrases"));
        verify(connection).prepareStatement(contains("profile.resident_thinq_id = ? ORDER BY ordinal"));
        verify(statement).setString(1, "home_23");
    }

    @Test
    void sharedPhraseSaveAtomicallyAppendsWithoutChangingVoiceFields() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        phraseRow("약 드실 시간이에요");

        SharedPhrase saved = repository.addSharedPhrase("home_23", "약 드실 시간이에요");

        assertThat(saved).isEqualTo(new SharedPhrase(PHRASE_ID, "약 드실 시간이에요", CREATED_AT));
        verify(connection).prepareStatement(contains("INSERT INTO public.voice_profile AS stored"));
        verify(connection).prepareStatement(contains(
                "shared_phrases = stored.shared_phrases || EXCLUDED.shared_phrases"));
        verify(connection).prepareStatement(contains(
                "WHERE existing->>'text' = (SELECT phrase_text FROM input)"));
        verify(statement).setString(1, "home_23");
        verify(statement).setString(3, "약 드실 시간이에요");
    }

    @Test
    void duplicateSharedPhraseIsRejectedWithoutAppending() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.addSharedPhrase("home_23", "약 드실 시간이에요"))
                .isInstanceOf(DuplicateSharedPhraseException.class)
                .hasMessage("이미 등록된 문구입니다.");
    }

    @Test
    void renameChangesOnlyDisplayNameAndReturnsPreservedMetadata() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        voiceRow("provider-voice-id", "새 이름", true);

        RegisteredVoice renamed = repository.rename("home_23", "provider-voice-id", "새 이름");

        assertThat(renamed).isEqualTo(new RegisteredVoice(
                "provider-voice-id", "새 이름", true, CREATED_AT));
        verify(connection).prepareStatement(contains(
                "jsonb_set(entry, '{display_name}', to_jsonb(CAST(? AS text)), true)"));
        verify(connection).prepareStatement(contains("ELSE entry END ORDER BY ordinal"));
        verify(statement).setString(3, "home_23");
    }

    @Test
    void atomicUpdateLocksThenSavesNameAndAllPhrasesBeforeCommit() throws SQLException {
        PreparedStatement lock = mock(PreparedStatement.class);
        PreparedStatement update = mock(PreparedStatement.class);
        ResultSet locked = mock(ResultSet.class);
        ResultSet updated = mock(ResultSet.class);
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(contains("AS owned"))).thenReturn(lock);
        when(connection.prepareStatement(contains("shared_phrases = profile.shared_phrases"))).thenReturn(update);
        when(lock.executeQuery()).thenReturn(locked);
        when(locked.next()).thenReturn(true);
        when(locked.getBoolean("owned")).thenReturn(true);
        when(locked.getBoolean("duplicate")).thenReturn(false);
        when(update.executeQuery()).thenReturn(updated);
        when(updated.next()).thenReturn(true);
        when(updated.getString("voice_id")).thenReturn("provider-voice-id");
        when(updated.getString("display_name")).thenReturn("새 이름");
        when(updated.getBoolean("requires_verification")).thenReturn(false);
        when(updated.getTimestamp("created_at")).thenReturn(Timestamp.from(CREATED_AT));

        RegisteredVoice saved = repository.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "새 이름", List.of("첫 문구", "둘째 문구"));

        assertThat(saved).isEqualTo(new RegisteredVoice(
                "provider-voice-id", "새 이름", false, CREATED_AT));
        verify(connection).setAutoCommit(false);
        verify(lock).setString(1, "provider-voice-id");
        verify(lock).setString(2, "첫 문구");
        verify(lock).setString(3, "둘째 문구");
        verify(lock).setString(4, "home_23");
        verify(update).setString(1, "provider-voice-id");
        verify(update).setString(2, "새 이름");
        verify(update).setString(4, "첫 문구");
        verify(update).setString(7, "둘째 문구");
        verify(update).setString(9, "home_23");
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    @Test
    void nameOnlyUpdateUsesTheSameTransactionWithoutAddingJsonEntries() throws SQLException {
        PreparedStatement lock = mock(PreparedStatement.class);
        PreparedStatement update = mock(PreparedStatement.class);
        ResultSet locked = mock(ResultSet.class);
        ResultSet updated = mock(ResultSet.class);
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(contains("AS owned"))).thenReturn(lock);
        when(connection.prepareStatement(contains("shared_phrases = profile.shared_phrases"))).thenReturn(update);
        when(lock.executeQuery()).thenReturn(locked);
        when(locked.next()).thenReturn(true);
        when(locked.getBoolean("owned")).thenReturn(true);
        when(update.executeQuery()).thenReturn(updated);
        when(updated.next()).thenReturn(true);
        when(updated.getString("voice_id")).thenReturn("provider-voice-id");
        when(updated.getString("display_name")).thenReturn("새 이름");
        when(updated.getTimestamp("created_at")).thenReturn(Timestamp.from(CREATED_AT));

        repository.updateVoiceAndPhrases("home_23", "provider-voice-id", "새 이름", List.of());

        verify(connection).prepareStatement(contains(
                "shared_phrases = profile.shared_phrases || '[]'::jsonb"));
        verify(connection).commit();
    }

    @Test
    void existingPhraseConflictRollsBackWithoutChangingTheVoiceName() throws SQLException {
        PreparedStatement lock = mock(PreparedStatement.class);
        ResultSet locked = mock(ResultSet.class);
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(contains("AS owned"))).thenReturn(lock);
        when(lock.executeQuery()).thenReturn(locked);
        when(locked.next()).thenReturn(true);
        when(locked.getBoolean("owned")).thenReturn(true);
        when(locked.getBoolean("duplicate")).thenReturn(true);

        assertThatThrownBy(() -> repository.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "바뀌면 안 되는 이름", List.of("기존 문구")))
                .isInstanceOf(DuplicateSharedPhraseException.class);

        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(connection, never()).prepareStatement(contains("UPDATE public.voice_profile"));
    }

    @Test
    void updateFailureRollsBackBothNameAndPhraseChanges() throws SQLException {
        PreparedStatement lock = mock(PreparedStatement.class);
        PreparedStatement update = mock(PreparedStatement.class);
        ResultSet locked = mock(ResultSet.class);
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(contains("AS owned"))).thenReturn(lock);
        when(connection.prepareStatement(contains("shared_phrases = profile.shared_phrases"))).thenReturn(update);
        when(lock.executeQuery()).thenReturn(locked);
        when(locked.next()).thenReturn(true);
        when(locked.getBoolean("owned")).thenReturn(true);
        when(update.executeQuery()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.updateVoiceAndPhrases(
                "home_23", "provider-voice-id", "새 이름", List.of("새 문구")))
                .isInstanceOf(VoiceStoreUnavailableException.class)
                .hasMessageNotContaining("private details");

        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void anotherResidentsVoiceCannotBeUpdatedWithPhrases() throws SQLException {
        PreparedStatement lock = mock(PreparedStatement.class);
        ResultSet locked = mock(ResultSet.class);
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(contains("AS owned"))).thenReturn(lock);
        when(lock.executeQuery()).thenReturn(locked);
        when(locked.next()).thenReturn(true);
        when(locked.getBoolean("owned")).thenReturn(false);

        assertThatThrownBy(() -> repository.updateVoiceAndPhrases(
                "other_home", "provider-voice-id", "새 이름", List.of("새 문구")))
                .isInstanceOf(VoiceNotFoundException.class);
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void anotherResidentsVoiceCannotBeReadOrChanged() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.requireOwned("other_home", "provider-voice-id"))
                .isInstanceOf(VoiceNotFoundException.class);
        verify(connection).prepareStatement(contains(
                "profile.resident_thinq_id = ? AND entry->>'voice_id' = ?"));
    }

    @Test
    void deleteKeepsTheProfileRowAndReassignsOnlyAnAvailableDefault() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getBoolean("deleted")).thenReturn(true);

        repository.delete("home_23", "provider-voice-id");

        verify(connection).prepareStatement(contains("SET voice_profiles = filtered.remaining"));
        verify(connection).prepareStatement(contains("THEN filtered.next_default"));
        verify(connection).prepareStatement(contains(
                "COALESCE((candidate->>'requires_verification')::boolean, true) = false"));
        verify(connection).prepareStatement(contains("'[]'::jsonb"));
        verify(connection).prepareStatement(org.mockito.ArgumentMatchers.argThat(
                sql -> !sql.contains("SET shared_phrases")));
        verify(statement).setString(1, "home_23");
        verify(statement).setString(2, "provider-voice-id");
    }

    @Test
    void deleteReturnsNotFoundWhenTheVoiceIsNotInTheResidentsArray() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getBoolean("deleted")).thenReturn(false);

        assertThatThrownBy(() -> repository.delete("other_home", "provider-voice-id"))
                .isInstanceOf(VoiceNotFoundException.class);
    }

    @Test
    void databaseFailureRemainsAStoreUnavailableError() throws SQLException {
        when(database.connect()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.list("home_23"))
                .isInstanceOf(VoiceStoreUnavailableException.class)
                .hasMessage("목소리 저장 DB에 연결하지 못했습니다.")
                .hasMessageNotContaining("private details");
    }
}
