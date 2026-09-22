package com.wificare.voice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.web.client.RestClient;

class ElevenLabsTextToSpeechServiceTests {

	private static final String TEST_API_KEY = "test-api-key";

	private ElevenLabsProperties properties;
	private ElevenLabsTextToSpeechService service;
	private MockRestServiceServer server;

	@BeforeEach
	void setUp() {
		properties = new ElevenLabsProperties();
		properties.setApiKey(TEST_API_KEY);
		RestClient.Builder builder = RestClient.builder();
		server = MockRestServiceServer.bindTo(builder).build();
		service = new ElevenLabsTextToSpeechService(builder, properties);
	}

	@Test
	void sendsTheRequestedTextAndReturnsMp3Bytes() {
		byte[] mp3 = "mock-mp3-audio".getBytes(StandardCharsets.UTF_8);

		server.expect(once(), requestTo(
				"https://api.elevenlabs.io/v1/text-to-speech/generated-voice-id"
						+ "?output_format=mp3_44100_128"))
				.andExpect(method(HttpMethod.POST))
				.andExpect(header("xi-api-key", TEST_API_KEY))
				.andExpect(header("Content-Type", MediaType.APPLICATION_JSON_VALUE))
				.andExpect(content().json(
						"{\"text\":\"밥 먹어요.\",\"model_id\":\"eleven_multilingual_v2\"}",
						JsonCompareMode.STRICT))
				.andRespond(withSuccess(mp3, MediaType.valueOf("audio/mpeg")));

		byte[] response = service.generateSpeech("generated-voice-id", "밥 먹어요.");

		assertThat(response).isEqualTo(mp3);
		server.verify();
	}

	@Test
	void rejectsAnUnconfiguredApiKeyBeforeSendingARequest() {
		properties.setApiKey(ElevenLabsProperties.PLACEHOLDER);

		assertThatThrownBy(() -> service.generateSpeech("voice-id", "밥 먹어요."))
				.isInstanceOf(ElevenLabsConfigurationException.class)
				.hasMessage("ElevenLabs API 설정이 필요합니다.");
	}

	@Test
	void rejectsAnEmptyAudioResponse() {
		server.expect(requestTo(
				"https://api.elevenlabs.io/v1/text-to-speech/voice-id?output_format=mp3_44100_128"))
				.andRespond(withSuccess(new byte[0], MediaType.valueOf("audio/mpeg")));

		assertThatThrownBy(() -> service.generateSpeech("voice-id", "밥 먹어요."))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessageContaining("빈 오디오");
		server.verify();
	}

	@Test
	void hidesTheUpstreamErrorBodyFromTheApplicationError() {
		server.expect(requestTo(
				"https://api.elevenlabs.io/v1/text-to-speech/voice-id?output_format=mp3_44100_128"))
				.andRespond(withStatus(HttpStatus.UNPROCESSABLE_CONTENT)
						.contentType(MediaType.APPLICATION_JSON)
						.body("{\"detail\":\"sensitive upstream response\"}"));

		assertThatThrownBy(() -> service.generateSpeech("voice-id", "밥 먹어요."))
				.isInstanceOf(ElevenLabsApiException.class)
				.hasMessage("음성을 생성하지 못했습니다. 목소리와 문장을 확인해주세요.")
				.hasMessageNotContaining("sensitive upstream response");
		server.verify();
	}
}
