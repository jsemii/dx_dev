package com.wificare.voice.service;

import java.io.IOException;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.dto.ElevenLabsVoiceResponse;
import com.wificare.voice.dto.VoiceCloneResponse;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpEntity;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ElevenLabsVoiceService {

	private static final Logger log = LoggerFactory.getLogger(ElevenLabsVoiceService.class);
	private static final String ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
	private static final String VOICE_NAME = "wifi_care_voice_sample";
	private static final JsonMapper ERROR_JSON = new JsonMapper();

	private final RestClient restClient;
	private final ElevenLabsProperties properties;

	public ElevenLabsVoiceService(RestClient.Builder restClientBuilder, ElevenLabsProperties properties) {
		this.restClient = restClientBuilder.baseUrl(ELEVENLABS_BASE_URL).build();
		this.properties = properties;
	}

	public VoiceCloneResponse createVoiceClone(MultipartFile file) {
		if (!properties.isConfigured()) {
			throw new ElevenLabsConfigurationException();
		}

		try {
			HttpHeaders fileHeaders = new HttpHeaders();
			fileHeaders.setContentType(safeMediaType(file));
			HttpEntity<NamedByteArrayResource> filePart = new HttpEntity<>(
					new NamedByteArrayResource(file.getBytes(), safeFilename(file)),
					fileHeaders);
			MultiValueMap<String, Object> multipart = new LinkedMultiValueMap<>();
			multipart.add("name", VOICE_NAME);
			multipart.add("files", filePart);

			ResponseEntity<ElevenLabsVoiceResponse> response = restClient.post()
					.uri("/v1/voices/add")
					.header("xi-api-key", properties.getApiKey().trim())
					.contentType(MediaType.MULTIPART_FORM_DATA)
					.body(multipart)
					.retrieve()
					.toEntity(ElevenLabsVoiceResponse.class);

			log.info("ElevenLabs voice clone response status={}", response.getStatusCode().value());
			ElevenLabsVoiceResponse body = response.getBody();
			if (body == null || !StringUtils.hasText(body.voiceId())) {
				throw new ElevenLabsApiException("ElevenLabs 응답에 voice_id가 없습니다.", response.getStatusCode().value());
			}

			return new VoiceCloneResponse(body.voiceId(), body.requiresVerification());
		} catch (RestClientResponseException exception) {
			int status = exception.getStatusCode().value();
			ProviderError error = readProviderError(exception);
			log.warn("ElevenLabs voice clone request failed: status={}, code={}, param={}, message={}",
					status, error.code(), error.param(), status == 401 || status == 403 ? "[hidden]" : error.message());
			String userMessage = userSafeMessage(status);
			if (status == 400 && !"unknown".equals(error.code())) {
				userMessage += " (오류 코드: " + error.code() + ")";
			}
			throw new ElevenLabsApiException(userMessage, status);
		} catch (ResourceAccessException exception) {
			log.warn("ElevenLabs voice clone request could not reach the upstream service");
			throw new ElevenLabsApiException(
					"목소리 등록 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
					exception);
		} catch (IOException exception) {
			log.warn("Could not read the uploaded voice sample");
			throw new ElevenLabsApiException("업로드된 녹음 파일을 읽지 못했습니다.", exception);
		}
	}

	public void deleteVoice(String voiceId) {
		if (!properties.isConfigured()) {
			throw new ElevenLabsConfigurationException();
		}

		try {
			ResponseEntity<Void> response = restClient.delete()
					.uri("/v1/voices/{voiceId}", voiceId)
					.header("xi-api-key", properties.getApiKey().trim())
					.retrieve()
					.toBodilessEntity();
			log.info("ElevenLabs voice deletion response status={}", response.getStatusCode().value());
		} catch (RestClientResponseException exception) {
			int status = exception.getStatusCode().value();
			if (status == 404) {
				// The provider voice is already absent; allow a previous partial deletion to finish locally.
				log.info("ElevenLabs voice was already absent during deletion");
				return;
			}
			ProviderError error = readProviderError(exception);
			log.warn("ElevenLabs voice deletion failed: status={}, code={}, param={}",
					status, error.code(), error.param());
			String message = status == 401 || status == 403
					? "ElevenLabs API 설정을 확인해주세요."
					: "ElevenLabs 목소리를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.";
			throw new ElevenLabsApiException(message, status);
		} catch (ResourceAccessException exception) {
			log.warn("ElevenLabs voice deletion could not reach the upstream service");
			throw new ElevenLabsApiException(
					"목소리 삭제 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", exception);
		}
	}

	private String safeFilename(MultipartFile file) {
		String filename = StringUtils.cleanPath(file.getOriginalFilename() == null ? "" : file.getOriginalFilename());
		return StringUtils.hasText(filename) ? filename.replaceAll("[\\r\\n]", "_") : "voice-sample";
	}

	private MediaType safeMediaType(MultipartFile file) {
		try {
			return StringUtils.hasText(file.getContentType())
					? MediaType.parseMediaType(file.getContentType())
					: MediaType.APPLICATION_OCTET_STREAM;
		} catch (IllegalArgumentException exception) {
			return MediaType.APPLICATION_OCTET_STREAM;
		}
	}

	private String userSafeMessage(int status) {
		if (status == 401 || status == 403) {
			return "ElevenLabs API 설정을 확인해주세요.";
		}
		if (status >= 400 && status < 500) {
			return "음성 파일을 처리하지 못했습니다. 녹음 상태를 확인하고 다시 시도해주세요.";
		}
		return "목소리 등록 서비스에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
	}

	private ProviderError readProviderError(RestClientResponseException exception) {
		try {
			if (exception.getResponseBodyAsByteArray().length > 8192) {
				return ProviderError.UNKNOWN;
			}
			JsonNode detail = ERROR_JSON.readTree(exception.getResponseBodyAsString()).path("detail");
			if (!detail.isObject()) {
				return ProviderError.UNKNOWN;
			}
			String code = safeIdentifier(detail.path("code").asText(""));
			if ("unknown".equals(code)) {
				code = safeIdentifier(detail.path("status").asText(""));
			}
			return new ProviderError(
					code,
					safeIdentifier(detail.path("param").asText("")),
					safeLogMessage(detail.path("message").asText("")));
		} catch (Exception ignored) {
			return ProviderError.UNKNOWN;
		}
	}

	private String safeIdentifier(String value) {
		return value != null && value.matches("[A-Za-z0-9_.-]{1,80}") ? value : "unknown";
	}

	private String safeLogMessage(String value) {
		if (value == null || value.isBlank()) {
			return "unknown";
		}
		String sanitized = value.replace(properties.getApiKey(), "[redacted]")
				.replaceAll("[\\p{Cntrl}]", " ");
		return sanitized.length() > 300 ? sanitized.substring(0, 300) + "..." : sanitized;
	}

	private record ProviderError(String code, String param, String message) {
		private static final ProviderError UNKNOWN = new ProviderError("unknown", "unknown", "unknown");
	}

	private static final class NamedByteArrayResource extends ByteArrayResource {

		private final String filename;

		private NamedByteArrayResource(byte[] byteArray, String filename) {
			super(byteArray);
			this.filename = filename;
		}

		@Override
		public String getFilename() {
			return filename;
		}
	}
}
