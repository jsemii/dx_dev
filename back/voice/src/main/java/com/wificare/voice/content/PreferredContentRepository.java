package com.wificare.voice.content;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;
import com.wificare.voice.db.VoiceDatabase;

@Repository
public class PreferredContentRepository {
    private static final Logger log = LoggerFactory.getLogger(PreferredContentRepository.class);
    private final VoiceDatabase database;

    public PreferredContentRepository(VoiceDatabase database) {
        this.database = database;
    }

    public List<ContentItem> list(String homeId) {
        String sql = "SELECT content_id, content_type::text AS content_type, content_name, content_url "
                + "FROM public.preferred_content WHERE resident_thinq_id = ? "
                + "ORDER BY created_at DESC, content_id DESC";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<ContentItem> items = new ArrayList<>();
                while (result.next()) {
                    UUID id = result.getObject("content_id", UUID.class);
                    String type = result.getString("content_type").toLowerCase(Locale.ROOT);
                    String name = result.getString("content_name");
                    items.add(type.equals("image") ? imageItem(id, homeId, name)
                            : youtubeItem(id, name, result.getString("content_url")));
                }
                return items;
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public ContentItem saveImage(String homeId, String name, byte[] bytes, String mimeType) {
        String sql = "INSERT INTO public.preferred_content "
                + "(resident_thinq_id, content_type, content_name, content_url, image_data, mime_type, size_bytes) "
                + "VALUES (?, CAST('IMAGE' AS public.content_type_enum), ?, NULL, ?, ?, ?) "
                + "RETURNING content_id";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, name);
            statement.setBytes(3, bytes);
            statement.setString(4, mimeType);
            statement.setInt(5, bytes.length);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return imageItem(result.getObject(1, UUID.class), homeId, name);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public ContentItem saveYoutube(String homeId, String name, String videoId) {
        String url = "https://www.youtube.com/watch?v=" + videoId;
        String sql = "INSERT INTO public.preferred_content "
                + "(resident_thinq_id, content_type, content_name, content_url, image_data, mime_type, size_bytes) "
                + "VALUES (?, CAST('YOUTUBE' AS public.content_type_enum), ?, ?, NULL, NULL, NULL) "
                + "RETURNING content_id";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, name);
            statement.setString(3, url);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return youtubeItem(result.getObject(1, UUID.class), name, url);
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public ImageBlob image(UUID imageId, String homeId) {
        String sql = "SELECT image_data, mime_type FROM public.preferred_content "
                + "WHERE content_id = ? AND resident_thinq_id = ? "
                + "AND content_type = CAST('IMAGE' AS public.content_type_enum)";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, imageId);
            statement.setString(2, homeId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new ContentNotFoundException();
                return new ImageBlob(result.getBytes(1), result.getString(2));
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public ContentItem rename(String type, UUID itemId, String homeId, String name) {
        String sql = "UPDATE public.preferred_content SET content_name = ? "
                + "WHERE content_id = ? AND resident_thinq_id = ? "
                + "AND content_type = CAST(? AS public.content_type_enum) RETURNING content_url";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, name);
            statement.setObject(2, itemId);
            statement.setString(3, homeId);
            statement.setString(4, type.toUpperCase(Locale.ROOT));
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new ContentItemNotFoundException();
                return type.equals("image") ? imageItem(itemId, homeId, name)
                        : youtubeItem(itemId, name, result.getString("content_url"));
            }
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    public void delete(String type, UUID itemId, String homeId) {
        String sql = "DELETE FROM public.preferred_content "
                + "WHERE content_id = ? AND resident_thinq_id = ? "
                + "AND content_type = CAST(? AS public.content_type_enum)";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setObject(1, itemId);
            statement.setString(2, homeId);
            statement.setString(3, type.toUpperCase(Locale.ROOT));
            if (statement.executeUpdate() != 1) throw new ContentItemNotFoundException();
        } catch (SQLException | IllegalStateException error) {
            throw unavailable(error);
        }
    }

    private static ContentItem imageItem(UUID id, String homeId, String name) {
        String encodedHomeId = URLEncoder.encode(homeId, StandardCharsets.UTF_8);
        return new ContentItem("image-" + id, "image", name,
                "/api/content/images/" + id + "?home_id=" + encodedHomeId, null);
    }

    private static ContentItem youtubeItem(UUID id, String name, String url) {
        String videoId = ContentValidation.youtubeVideoId(url);
        String normalizedUrl = "https://www.youtube.com/watch?v=" + videoId;
        return new ContentItem("youtube-" + id, "youtube", name,
                "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg",
                normalizedUrl);
    }

    private static ContentStoreUnavailableException unavailable(Exception error) {
        if (error instanceof SQLException sqlError) {
            log.warn("Preferred content DB operation failed: SQLSTATE={}", sqlError.getSQLState());
        }
        return new ContentStoreUnavailableException(error);
    }

    public record ImageBlob(byte[] bytes, String mimeType) {
    }
}
