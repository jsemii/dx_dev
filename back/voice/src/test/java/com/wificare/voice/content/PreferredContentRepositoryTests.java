package com.wificare.voice.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import com.wificare.voice.db.VoiceDatabase;
import org.junit.jupiter.api.Test;

class PreferredContentRepositoryTests {
    private final VoiceDatabase database = mock(VoiceDatabase.class);
    private final Connection connection = mock(Connection.class);
    private final PreparedStatement statement = mock(PreparedStatement.class);
    private final ResultSet result = mock(ResultSet.class);
    private final PreferredContentRepository repository = new PreferredContentRepository(database);

    private void query() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
    }

    @Test
    void imageRenameFiltersByIdAndHome() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getLong(1)).thenReturn(7L);

        ContentItem item = repository.rename("image", 7, "demo_solo_house009", "새 이름");

        assertThat(item.id()).isEqualTo("image-7");
        verify(connection).prepareStatement(contains("WHERE image_id = ? AND home_id = ?"));
        verify(statement).setString(1, "새 이름");
        verify(statement).setLong(2, 7);
        verify(statement).setString(3, "demo_solo_house009");
    }

    @Test
    void youtubeDeleteFiltersByIdAndHome() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        when(statement.executeUpdate()).thenReturn(1);

        repository.delete("youtube", 8, "demo_solo_house009");

        verify(connection).prepareStatement(contains("WHERE link_id = ? AND home_id = ?"));
        verify(statement).setLong(1, 8);
        verify(statement).setString(2, "demo_solo_house009");
    }

    @Test
    void missingOrAnotherHomesContentIsNotModified() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.rename("youtube", 8, "other_home", "새 이름"))
                .isInstanceOf(ContentItemNotFoundException.class);
    }
}
