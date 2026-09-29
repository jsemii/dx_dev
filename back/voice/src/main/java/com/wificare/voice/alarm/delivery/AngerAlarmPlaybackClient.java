package com.wificare.voice.alarm.delivery;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.nio.charset.StandardCharsets;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class AngerAlarmPlaybackClient implements AlarmPlaybackPort {
    private static final Set<String> RETRYABLE_CODES = Set.of(
            "PLAYBACK_NOT_READY", "PLAYER_BUSY", "PLAYER_OFFLINE");

    private final AlarmDeliveryProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    @Autowired
    public AngerAlarmPlaybackClient(AlarmDeliveryProperties properties, ObjectMapper objectMapper) {
        this(properties, objectMapper, HttpClient.newBuilder()
                // Anger is an HTTP/1.1 Express service. Preferring h2c on a plain HTTP
                // internal URL can be interpreted as a different request and return 404.
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.requestTimeout()).build());
    }

    AngerAlarmPlaybackClient(AlarmDeliveryProperties properties, ObjectMapper objectMapper,
            HttpClient httpClient) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public boolean isReady(String homeId) {
        try {
            String query = URLEncoder.encode(homeId, StandardCharsets.UTF_8);
            URI endpoint = properties.angerBaseUri().resolve("/api/playback/status?home_id=" + query);
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(properties.requestTimeout()).GET().build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) return false;
            JsonNode payload = parse(response.body());
            return payload.path("ready").asBoolean(false)
                    && !payload.path("busy").asBoolean(true)
                    && payload.path("ready_players").asInt(0) == 1;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return false;
        } catch (IOException | RuntimeException error) {
            return false;
        }
    }

    @Override
    public AlarmPlaybackResult play(String homeId, UUID alarmId, UUID requestId,
            byte[] audio, String mimeType) {
        if (!properties.hasValidInternalToken()) {
            throw new AlarmPlaybackException("INTERNAL_AUTH_NOT_CONFIGURED", false);
        }
        if (audio == null || audio.length < 1 || audio.length > properties.maxAudioBytes()) {
            throw new AlarmPlaybackException(
                    audio != null && audio.length > properties.maxAudioBytes()
                            ? "AUDIO_TOO_LARGE" : "INVALID_AUDIO_DATA",
                    false);
        }
        try {
            String body = objectMapper.writeValueAsString(Map.of(
                    "home_id", homeId,
                    "alarm_id", alarmId.toString(),
                    "request_id", requestId.toString(),
                    "audio", Base64.getEncoder().encodeToString(audio),
                    "mime_type", mimeType));
            URI endpoint = properties.angerBaseUri().resolve("/internal/playback/audio");
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(properties.requestTimeout())
                    .header("Content-Type", "application/json")
                    .header("X-Internal-Token", properties.internalToken())
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(
                    request, HttpResponse.BodyHandlers.ofString());
            JsonNode payload = parse(response.body());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String code = payload.path("error").path("code").asText("PLAYBACK_REQUEST_FAILED");
                throw new AlarmPlaybackException(code, RETRYABLE_CODES.contains(code));
            }
            return new AlarmPlaybackResult(
                    UUID.fromString(payload.path("request_id").asText()),
                    payload.path("status").asText("FAILED"),
                    instant(payload, "started_at"),
                    instant(payload, "ended_at"),
                    nullableText(payload, "failure_code"));
        } catch (AlarmPlaybackException error) {
            throw error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new AlarmPlaybackException("PLAYBACK_REQUEST_INTERRUPTED", true, error);
        } catch (IOException | IllegalArgumentException error) {
            throw new AlarmPlaybackException("PLAYBACK_REQUEST_FAILED", true, error);
        }
    }

    private JsonNode parse(String body) throws IOException {
        return objectMapper.readTree(body == null || body.isBlank() ? "{}" : body);
    }

    private static Instant instant(JsonNode payload, String field) {
        String value = payload.path(field).asText("");
        return value.isBlank() ? null : Instant.parse(value);
    }

    private static String nullableText(JsonNode payload, String field) {
        JsonNode value = payload.get(field);
        return value == null || value.isNull() || value.asText().isBlank() ? null : value.asText();
    }
}
