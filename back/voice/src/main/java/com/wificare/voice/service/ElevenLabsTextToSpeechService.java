package com.wificare.voice.service;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.dto.ElevenLabsTtsRequest;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class ElevenLabsTextToSpeechService {

	static final String MODEL_ID = "eleven_multilingual_v2";
	static final String OUTPUT_FORMAT = "mp3_44100_128";

	private static final Logger log = LoggerFactory.getLogger(ElevenLabsTextToSpeechService.class);
	private static final String ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

	private final RestClient restClient;
	private final ElevenLabsProperties properties;

	public ElevenLabsTextToSpeechService(RestClient.Builder restClientBuilder, ElevenLabsProperties properties) {
		this.restClient = restClientBuilder.baseUrl(ELEVENLABS_BASE_URL).build();
		this.properties = properties;
	}

	public byte[] generateSpeech(String voiceId, String text) {
		if (!properties.isConfigured()) {
			throw new ElevenLabsConfigurationException();
		}

		try {
			ResponseEntity<byte[]> response = restClient.post()
					.uri(uriBuilder -> uriBuilder
							.path("/v1/text-to-speech/{voiceId}")
							.queryParam("output_format", OUTPUT_FORMAT)
							.build(voiceId))
					.header("xi-api-key", properties.getApiKey().trim())
					.contentType(MediaType.APPLICATION_JSON)
					.accept(MediaType.valueOf("audio/mpeg"))
					.body(new ElevenLabsTtsRequest(text, MODEL_ID))
					.retrieve()
					.toEntity(byte[].class);

			byte[] audio = response.getBody();
			int audioSize = audio == null ? 0 : audio.length;
			log.info(
					"ElevenLabs TTS response status={}, audioBytes={}",
					response.getStatusCode().value(),
					audioSize);

			if (audioSize == 0) {
				throw new ElevenLabsApiException(
						"음성 생성 서비스에서 빈 오디오가 반환되었습니다. 다시 시도해주세요.",
						response.getStatusCode().value());
			}

			return audio;
		} catch (RestClientResponseException exception) {
			int status = exception.getStatusCode().value();
			log.warn("ElevenLabs TTS request failed with status={}", status);
			throw new ElevenLabsApiException(userSafeMessage(status), status);
		} catch (ResourceAccessException exception) {
			log.warn("ElevenLabs TTS request could not reach the upstream service");
			throw new ElevenLabsApiException(
					"음성 생성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
					exception);
		}
	}

	private String userSafeMessage(int status) {
		if (status == 401 || status == 403) {
			return "ElevenLabs API 설정을 확인해주세요.";
		}
		if (status >= 400 && status < 500) {
			return "음성을 생성하지 못했습니다. 목소리와 문장을 확인해주세요.";
		}
		return "음성 생성 서비스에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
	}
}
