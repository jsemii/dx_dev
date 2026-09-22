package com.wificare.voice.controller;

import com.wificare.voice.dto.TtsRequest;
import com.wificare.voice.service.ElevenLabsTextToSpeechService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tts")
public class TtsController {

	private static final Logger log = LoggerFactory.getLogger(TtsController.class);
	private static final MediaType AUDIO_MPEG = MediaType.valueOf("audio/mpeg");

	private final ElevenLabsTextToSpeechService textToSpeechService;

	public TtsController(ElevenLabsTextToSpeechService textToSpeechService) {
		this.textToSpeechService = textToSpeechService;
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = "audio/mpeg")
	public ResponseEntity<byte[]> generateSpeech(@Valid @RequestBody TtsRequest request) {
		log.info(
				"TTS request received: textLength={}, voiceIdPresent={}",
				request.text().length(),
				StringUtils.hasText(request.voiceId()));

		byte[] audio = textToSpeechService.generateSpeech(request.voiceId().trim(), request.text().trim());
		return ResponseEntity.ok()
				.contentType(AUDIO_MPEG)
				.contentLength(audio.length)
				.body(audio);
	}
}
