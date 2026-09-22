package com.wificare.voice.content;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

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
        String sql = "SELECT kind, item_id, display_name, video_id FROM ("
                + "SELECT 'image' AS kind, image_id AS item_id, display_name, NULL::varchar AS video_id, created_at "
                + "FROM public.image_data WHERE home_id = ? "
                + "UNION ALL "
                + "SELECT 'youtube' AS kind, link_id AS item_id, display_name, video_id, created_at "
                + "FROM public.youtube_data WHERE home_id = ?"
                + ") AS content ORDER BY created_at DESC, kind, item_id DESC";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, homeId);
            try (ResultSet result = statement.executeQuery()) {
                List<ContentItem> items = new ArrayList<>();
                while (result.next()) {
                    String kind = result.getString("kind");
                    long id = result.getLong("item_id");
                    String videoId = result.getString("video_id");
                    items.add(kind.equals("image")
                            ? imageItem(id, homeId, result.getString("display_name"))
                            : youtubeItem(id, result.getString("display_name"), videoId));
                }
                return items;
            }
        } catch (SQLException | IllegalStateException error) {
            throw new ContentStoreUnavailableException(error);
        }
    }

    public ContentItem saveImage(String homeId, String name, byte[] bytes, String mimeType) {
        String sql = "INSERT INTO public.image_data "
                + "(home_id, display_name, image_data, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?) "
                + "RETURNING image_id";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, name);
            statement.setBytes(3, bytes);
            statement.setString(4, mimeType);
            statement.setInt(5, bytes.length);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return imageItem(result.getLong(1), homeId, name);
            }
        } catch (SQLException | IllegalStateException error) {
            if (error instanceof SQLException sqlError) {
                log.warn("Image insert failed: SQLSTATE={}", sqlError.getSQLState());
            }
            throw new ContentStoreUnavailableException(error);
        }
    }

    public ContentItem saveYoutube(String homeId, String name, String videoId) {
        String url = "https://www.youtube.com/watch?v=" + videoId;
        String sql = "INSERT INTO public.youtube_data "
                + "(home_id, display_name, youtube_url, video_id) VALUES (?, ?, ?, ?) RETURNING link_id";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, homeId);
            statement.setString(2, name);
            statement.setString(3, url);
            statement.setString(4, videoId);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return youtubeItem(result.getLong(1), name, videoId);
            }
        } catch (SQLException | IllegalStateException error) {
            throw new ContentStoreUnavailableException(error);
        }
    }

    public ImageBlob image(long imageId, String homeId) {
        String sql = "SELECT image_data, mime_type FROM public.image_data "
                + "WHERE image_id = ? AND home_id = ?";
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, imageId);
            statement.setString(2, homeId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new ContentNotFoundException();
                return new ImageBlob(result.getBytes(1), result.getString(2));
            }
        } catch (SQLException | IllegalStateException error) {
            throw new ContentStoreUnavailableException(error);
        }
    }

    public ContentItem rename(String type, long itemId, String homeId, String name) {
        String sql = switch (type) {
            case "image" -> "UPDATE public.image_data SET display_name = ? "
                    + "WHERE image_id = ? AND home_id = ? RETURNING image_id, NULL::varchar AS video_id";
            case "youtube" -> "UPDATE public.youtube_data SET display_name = ? "
                    + "WHERE link_id = ? AND home_id = ? RETURNING link_id, video_id";
            default -> throw new IllegalArgumentException("콘텐츠 종류가 올바르지 않습니다.");
        };
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, name);
            statement.setLong(2, itemId);
            statement.setString(3, homeId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new ContentItemNotFoundException();
                return type.equals("image")
                        ? imageItem(result.getLong(1), homeId, name)
                        : youtubeItem(result.getLong(1), name, result.getString("video_id"));
            }
        } catch (SQLException | IllegalStateException error) {
            throw new ContentStoreUnavailableException(error);
        }
    }

    public void delete(String type, long itemId, String homeId) {
        String sql = switch (type) {
            case "image" -> "DELETE FROM public.image_data WHERE image_id = ? AND home_id = ?";
            case "youtube" -> "DELETE FROM public.youtube_data WHERE link_id = ? AND home_id = ?";
            default -> throw new IllegalArgumentException("콘텐츠 종류가 올바르지 않습니다.");
        };
        try (Connection connection = database.connect(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, itemId);
            statement.setString(2, homeId);
            if (statement.executeUpdate() != 1) throw new ContentItemNotFoundException();
        } catch (SQLException | IllegalStateException error) {
            throw new ContentStoreUnavailableException(error);
        }
    }

    private static ContentItem imageItem(long id, String homeId, String name) {
        String encodedHomeId = URLEncoder.encode(homeId, StandardCharsets.UTF_8);
        return new ContentItem("image-" + id, "image", name,
                "/api/content/images/" + id + "?home_id=" + encodedHomeId, null);
    }

    private static ContentItem youtubeItem(long id, String name, String videoId) {
        return new ContentItem("youtube-" + id, "youtube", name,
                "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg",
                "https://www.youtube.com/watch?v=" + videoId);
    }

    public record ImageBlob(byte[] bytes, String mimeType) {
    }
}
