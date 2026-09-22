package com.wificare.voice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.dto.VoiceCloneResponse;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ElevenLabsVoiceServiceTests {

	private static final String TEST_API_KEY = "test-api-key";

	private ElevenLabsProperties properties;
	private ElevenLabsVoiceService service;
	private MockRestServiceServer server;

	@BeforeEach
	void setUp() {
		properties = new ElevenLabsProperties();
		properties.setApiKey(TEST_API_KEY);
		RestClient.Builder builder = RestClient.builder();
		server = MockRestServiceServer.bindTo(builder).build();
		service = new ElevenLabsVoiceService(builder, properties);
	}

	@Test
	void sendsTheRecordingAsElevenLabsMultipartAndMapsTheResponse() {
		server.expect(once(), requestTo("https://api.elevenlabs.io/v1/voices/add"))
				.andExpect(method(HttpMethod.POST))
				.andExpect(header("xi-api-key", TEST_API_KEY))
				.andExpect(request -> {
					MockClientHttpRequest mockRequest = (MockClientHttpRequest) request;
					String body = mockRequest.getBodyAsString();
					assertThat(body).contains("name=\"name\"");
					assertThat(body).contains("wifi_care_voice_sample");
					assertThat(body).contains("name=\"files\"");
					assertThat(body).contains("filename=\"voice.webm\"");
					assertThat(body).doesNotContain("remove_background_noise");
				})
				.andRespond(withSuccess(
						"{\"voice_id\":\"generated-voice-id\",\"requires_verification\":false}",
						MediaType.APPLICATION_JSON));

		MockMultipartFile file = new MockMultipartFile(
				"file",
				"voice.webm",
				"audio/webm;codecs=opus",
				"recorded-audio".getBytes(StandardCharsets.UTF_8));

		VoiceCloneResponse response = service.createVoiceClone(file);

		assertThat(response.voiceId()).isEqualTo("generated-voice-id");
		assertThat(response.requiresVerification()).isFalse();
		server.verify();
	}

	@Test
	void rejectsAnUnconfiguredApiKeyBeforeSendingARequest() {
		properties.setApiKey(ElevenLabsProperties.PLACEHOLDER);
		MockMultipartFile file = new MockMultipartFile("file", "voice.webm", "audio/webm", new byte[] {1});

		assertThatThrownBy(() -> service.createVoiceClone(file))
				.isInstanceOf(ElevenLabsConfigurationException.class)
				.hasMessage("ElevenLabs API 설정이 필요합니다.");
	}

	@Test
	void hidesTheUpstreamErrorBodyFromTheApplicationError() {
		server.expect(requestTo("https://api.elevenlabs.io/v1/voices/add"))
				.andRespond(withStatus(HttpStatus.UNAUTHORIZED)
						.contentType(MediaType.APPLICATION_JSON)
						.body("{\"detail\":\"sensitive upstream response\"}"));

		MockMultipartFile file = new MockMultipartFile("file", "voice.webm", "audio/webm", new byte[] {1});

		assertThatThrownBy(() -> service.createVoiceClone(file))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessage("ElevenLabs API 설정을 확인해주세요.")
				.hasMessageNotContaining("sensitive upstream response");
		server.verify();
	}

	@Test
	void readsTheProviderErrorCodeWithoutExposingItsMessageToTheClient() {
		server.expect(requestTo("https://api.elevenlabs.io/v1/voices/add"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.contentType(MediaType.APPLICATION_JSON)
						.body("{\"detail\":{\"code\":\"invalid_file_type\",\"param\":\"files\","
								+ "\"message\":\"Private recording details\"}}"));

		MockMultipartFile file = new MockMultipartFile("file", "voice.webm", "audio/webm", new byte[] {1});

		assertThatThrownBy(() -> service.createVoiceClone(file))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessageContaining("invalid_file_type")
				.hasMessageNotContaining("Private recording details");
		server.verify();
	}

	@Test
	void acceptsTheLegacyProviderStatusFieldWhenCodeIsMissing() {
		server.expect(requestTo("https://api.elevenlabs.io/v1/voices/add"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.contentType(MediaType.APPLICATION_JSON)
						.body("{\"detail\":{\"status\":\"bad_request\",\"message\":\"Invalid request\"}}"));

		MockMultipartFile file = new MockMultipartFile("file", "voice.webm", "audio/webm", new byte[] {1});

		assertThatThrownBy(() -> service.createVoiceClone(file))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessageContaining("bad_request");
		server.verify();
	}

	@Test
	void deletesTheActualElevenLabsVoice() {
		server.expect(once(), requestTo("https://api.elevenlabs.io/v1/voices/generated-voice-id"))
				.andExpect(method(HttpMethod.DELETE))
				.andExpect(header("xi-api-key", TEST_API_KEY))
				.andRespond(withSuccess("{\"status\":\"ok\"}", MediaType.APPLICATION_JSON));

		service.deleteVoice("generated-voice-id");

		server.verify();
	}

	@Test
	void treatsAnAlreadyAbsentProviderVoiceAsACompletedDeletion() {
		server.expect(requestTo("https://api.elevenlabs.io/v1/voices/generated-voice-id"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND));

		service.deleteVoice("generated-voice-id");

		server.verify();
	}

	@Test
	void providerDeletionFailureIsSafeAndRetryable() {
		server.expect(requestTo("https://api.elevenlabs.io/v1/voices/generated-voice-id"))
				.andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
						.contentType(MediaType.APPLICATION_JSON)
						.body("{\"detail\":\"private provider details\"}"));

		assertThatThrownBy(() -> service.deleteVoice("generated-voice-id"))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessage("ElevenLabs 목소리를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.")
				.hasMessageNotContaining("private provider details");
		server.verify();
	}
}
