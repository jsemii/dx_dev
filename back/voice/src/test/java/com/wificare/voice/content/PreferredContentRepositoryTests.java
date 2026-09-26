package com.wificare.voice.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;

import com.wificare.voice.db.VoiceDatabase;
import org.junit.jupiter.api.Test;

class PreferredContentRepositoryTests {
    private static final UUID CONTENT_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final VoiceDatabase database = mock(VoiceDatabase.class);
    private final Connection connection = mock(Connection.class);
    private final PreparedStatement statement = mock(PreparedStatement.class);
    private final ResultSet result = mock(ResultSet.class);
    private final PreferredContentRepository repository = new PreferredContentRepository(database);

    private void query() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(result);
    }

    @Test
    void listFiltersByResidentAndMapsYoutubeUrlInNewestFirstOrder() throws SQLException {
        query();
        when(result.next()).thenReturn(true, false);
        when(result.getObject("content_id", UUID.class)).thenReturn(CONTENT_ID);
        when(result.getString("content_type")).thenReturn("YOUTUBE");
        when(result.getString("content_name")).thenReturn("좋아하는 영상");
        when(result.getString("content_url")).thenReturn("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

        List<ContentItem> items = repository.list("home_23");

        assertThat(items).containsExactly(new ContentItem("youtube-" + CONTENT_ID, "youtube", "좋아하는 영상",
                "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        verify(connection).prepareStatement(contains("FROM public.preferred_content WHERE resident_thinq_id = ?"));
        verify(connection).prepareStatement(contains("ORDER BY created_at DESC, content_id DESC"));
        verify(statement).setString(1, "home_23");
    }

    @Test
    void imageInsertStoresOnlyImagePayloadAndReturnsUuid() throws SQLException {
        query();
        byte[] bytes = {(byte) 0xff, (byte) 0xd8, (byte) 0xff};
        when(result.next()).thenReturn(true);
        when(result.getObject(1, UUID.class)).thenReturn(CONTENT_ID);

        ContentItem item = repository.saveImage("home_23", "가족 사진", bytes, "image/jpeg");

        assertThat(item.id()).isEqualTo("image-" + CONTENT_ID);
        assertThat(item.thumbnailUrl()).contains("/api/content/images/" + CONTENT_ID);
        verify(connection).prepareStatement(contains("CAST('IMAGE' AS public.content_type_enum)"));
        verify(connection).prepareStatement(contains("VALUES (?, CAST('IMAGE' AS public.content_type_enum), ?, NULL"));
        verify(statement).setBytes(3, bytes);
        verify(statement).setInt(5, bytes.length);
    }

    @Test
    void youtubeInsertStoresNormalizedUrlAndNullImagePayload() throws SQLException {
        query();
        when(result.next()).thenReturn(true);
        when(result.getObject(1, UUID.class)).thenReturn(CONTENT_ID);

        ContentItem item = repository.saveYoutube("home_23", "좋아하는 음악", "dQw4w9WgXcQ");

        assertThat(item.id()).isEqualTo("youtube-" + CONTENT_ID);
        assertThat(item.sourceUrl()).isEqualTo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        verify(connection).prepareStatement(contains("CAST('YOUTUBE' AS public.content_type_enum)"));
        verify(connection).prepareStatement(contains("NULL, NULL, NULL"));
        verify(statement).setString(3, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    @Test
    void imageReadFiltersByUuidResidentAndImageType() throws SQLException {
        query();
        byte[] bytes = {1, 2, 3};
        when(result.next()).thenReturn(true);
        when(result.getBytes(1)).thenReturn(bytes);
        when(result.getString(2)).thenReturn("image/png");

        assertThat(repository.image(CONTENT_ID, "home_23"))
                .isEqualTo(new PreferredContentRepository.ImageBlob(bytes, "image/png"));
        verify(connection).prepareStatement(contains("content_id = ? AND resident_thinq_id = ?"));
        verify(connection).prepareStatement(contains("CAST('IMAGE' AS public.content_type_enum)"));
        verify(statement).setObject(1, CONTENT_ID);
        verify(statement).setString(2, "home_23");
    }

    @Test
    void renameFiltersByUuidResidentAndContentType() throws SQLException {
        query();
        when(result.next()).thenReturn(true);

        ContentItem item = repository.rename("image", CONTENT_ID, "home_23", "새 이름");

        assertThat(item.id()).isEqualTo("image-" + CONTENT_ID);
        verify(connection).prepareStatement(contains(
                "content_id = ? AND resident_thinq_id = ? AND content_type = CAST(? AS public.content_type_enum)"));
        verify(statement).setObject(2, CONTENT_ID);
        verify(statement).setString(3, "home_23");
        verify(statement).setString(4, "IMAGE");
    }

    @Test
    void deleteFiltersByUuidResidentAndContentType() throws SQLException {
        when(database.connect()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeUpdate()).thenReturn(1);

        repository.delete("youtube", CONTENT_ID, "home_23");

        verify(connection).prepareStatement(contains("DELETE FROM public.preferred_content"));
        verify(statement).setObject(1, CONTENT_ID);
        verify(statement).setString(2, "home_23");
        verify(statement).setString(3, "YOUTUBE");
    }

    @Test
    void missingOrAnotherResidentsContentIsNotModified() throws SQLException {
        query();
        when(result.next()).thenReturn(false);

        assertThatThrownBy(() -> repository.rename("youtube", CONTENT_ID, "other_home", "새 이름"))
                .isInstanceOf(ContentItemNotFoundException.class);
    }

    @Test
    void databaseFailureRemainsUnavailable() throws SQLException {
        when(database.connect()).thenThrow(new SQLException("private details", "08006"));

        assertThatThrownBy(() -> repository.list("home_23"))
                .isInstanceOf(ContentStoreUnavailableException.class)
                .hasMessage("선호 콘텐츠 저장소를 사용할 수 없습니다.");
    }
}
