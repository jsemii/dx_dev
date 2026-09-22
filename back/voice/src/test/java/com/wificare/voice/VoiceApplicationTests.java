package com.wificare.voice;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import com.wificare.voice.config.ElevenLabsProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(
		webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "elevenlabs.api-key=PUT_YOUR_ELEVENLABS_API_KEY_HERE")
class VoiceApplicationTests {

	private final HttpClient httpClient = HttpClient.newHttpClient();

	@Value("${local.server.port}")
	private int port;

	@Test
	void healthEndpointReturnsOk() throws IOException, InterruptedException {
		HttpResponse<String> response = sendGet("/api/health");

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).isEqualTo("{\"status\":\"ok\"}");
	}

	@Test
	void placeholderApiKeyIsReportedAsNotConfigured() throws IOException, InterruptedException {
		HttpResponse<String> response = sendGet("/api/config/elevenlabs");

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).isEqualTo("{\"configured\":false}");
		assertThat(response.body()).doesNotContain(ElevenLabsProperties.PLACEHOLDER);
	}

	@Test
	void aRealApiKeyValueIsReportedAsConfiguredWithoutBeingExposed() {
		ElevenLabsProperties properties = new ElevenLabsProperties();
		properties.setApiKey("test-secret-value");

		assertThat(properties.isConfigured()).isTrue();
		assertThat(properties.toString()).doesNotContain("test-secret-value");
	}

	@Test
	void corsAllowsOnlyTheLocalThinQOrigin() throws IOException, InterruptedException {
		HttpResponse<String> allowedResponse = sendPreflight("http://127.0.0.1:5175");
		HttpResponse<String> blockedResponse = sendPreflight("http://example.com");

		assertThat(allowedResponse.statusCode()).isEqualTo(200);
		assertThat(allowedResponse.headers().firstValue("access-control-allow-origin"))
				.contains("http://127.0.0.1:5175");
		assertThat(blockedResponse.headers().firstValue("access-control-allow-origin"))
				.isEmpty();
	}

	@Test
	void emptyVoiceUploadReturnsBadRequestWithoutCallingElevenLabs() throws IOException, InterruptedException {
		String boundary = "voice-test-boundary";
		String multipartBody = "--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"home_id\"\r\n\r\n"
				+ "demo_solo_house009\r\n--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"name\"\r\n\r\n"
				+ "새 목소리\r\n--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"file\"; filename=\"voice.webm\"\r\n"
				+ "Content-Type: audio/webm\r\n\r\n"
				+ "\r\n--" + boundary + "--\r\n";
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/api/voice/clone"))
				.header("Content-Type", "multipart/form-data; boundary=" + boundary)
				.POST(HttpRequest.BodyPublishers.ofString(multipartBody))
				.build();

		HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

		assertThat(response.statusCode()).isEqualTo(400);
		assertThat(response.body()).isEqualTo("{\"message\":\"녹음 파일이 비어 있습니다.\"}");
	}

	@Test
	void receivesAMultipartVoiceFileAndRejectsThePlaceholderBeforeCallingUpstream()
			throws IOException, InterruptedException {
		String boundary = "voice-test-nonempty-boundary";
		String multipartBody = "--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"home_id\"\r\n\r\n"
				+ "demo_solo_house009\r\n--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"name\"\r\n\r\n"
				+ "새 목소리\r\n--" + boundary + "\r\n"
				+ "Content-Disposition: form-data; name=\"file\"; filename=\"voice.webm\"\r\n"
				+ "Content-Type: audio/webm\r\n\r\n"
				+ "recorded-audio\r\n--" + boundary + "--\r\n";
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/api/voice/clone"))
				.header("Content-Type", "multipart/form-data; boundary=" + boundary)
				.POST(HttpRequest.BodyPublishers.ofString(multipartBody))
				.build();

		HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

		assertThat(response.statusCode()).isEqualTo(503);
		assertThat(response.body()).isEqualTo("{\"message\":\"ElevenLabs API 설정이 필요합니다.\"}");
		assertThat(response.body()).doesNotContain(ElevenLabsProperties.PLACEHOLDER);
	}

	@Test
	void ttsRequiresAVoiceId() throws IOException, InterruptedException {
		HttpResponse<String> response = sendJson("/api/tts", "{\"voiceId\":\"\",\"text\":\"밥 먹어요.\"}");

		assertThat(response.statusCode()).isEqualTo(400);
		assertThat(response.body()).isEqualTo("{\"message\":\"voiceId가 필요합니다.\"}");
	}

	@Test
	void ttsRequiresText() throws IOException, InterruptedException {
		HttpResponse<String> response = sendJson("/api/tts", "{\"voiceId\":\"voice-id\",\"text\":\"   \"}");

		assertThat(response.statusCode()).isEqualTo(400);
		assertThat(response.body()).isEqualTo("{\"message\":\"재생할 문장을 입력해주세요.\"}");
	}

	@Test
	void ttsRejectsTextLongerThanFiveHundredCharacters() throws IOException, InterruptedException {
		String body = "{\"voiceId\":\"voice-id\",\"text\":\"" + "가".repeat(501) + "\"}";
		HttpResponse<String> response = sendJson("/api/tts", body);

		assertThat(response.statusCode()).isEqualTo(400);
		assertThat(response.body()).isEqualTo("{\"message\":\"문장은 500자 이하로 입력해주세요.\"}");
	}

	@Test
	void validTtsRequestRejectsThePlaceholderBeforeCallingUpstream() throws IOException, InterruptedException {
		HttpResponse<String> response = sendJson(
				"/api/tts",
				"{\"voiceId\":\"voice-id\",\"text\":\"밥 먹어요.\"}");

		assertThat(response.statusCode()).isEqualTo(503);
		assertThat(response.body()).isEqualTo("{\"message\":\"ElevenLabs API 설정이 필요합니다.\"}");
		assertThat(response.body()).doesNotContain(ElevenLabsProperties.PLACEHOLDER);
	}

	private HttpResponse<String> sendGet(String path) throws IOException, InterruptedException {
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + path)).GET().build();
		return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
	}

	private HttpResponse<String> sendPreflight(String origin) throws IOException, InterruptedException {
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/api/health"))
				.header("Origin", origin)
				.header("Access-Control-Request-Method", "GET")
				.method("OPTIONS", HttpRequest.BodyPublishers.noBody())
				.build();
		return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
	}

	private HttpResponse<String> sendJson(String path, String body) throws IOException, InterruptedException {
		HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + path))
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString(body))
				.build();
		return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
	}

	private String baseUrl() {
		return "http://localhost:" + port;
	}
}
