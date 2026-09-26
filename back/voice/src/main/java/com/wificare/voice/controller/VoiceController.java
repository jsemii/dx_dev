package com.wificare.voice.controller;

import com.wificare.voice.config.ElevenLabsProperties;
import com.wificare.voice.dto.RegisteredVoice;
import com.wificare.voice.dto.VoiceCloneResponse;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import com.wificare.voice.exception.InvalidVoiceFileException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import com.wificare.voice.service.ElevenLabsVoiceService;
import com.wificare.voice.service.VoiceProfileRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/voice")
public class VoiceController {

	private static final Logger log = LoggerFactory.getLogger(VoiceController.class);

	private final ElevenLabsVoiceService voiceService;
	private final VoiceProfileRepository profiles;
	private final ElevenLabsProperties elevenLabs;

	public VoiceController(ElevenLabsVoiceService voiceService, VoiceProfileRepository profiles,
			ElevenLabsProperties elevenLabs) {
		this.voiceService = voiceService;
		this.profiles = profiles;
		this.elevenLabs = elevenLabs;
	}

	@PostMapping(value = "/clone", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	public RegisteredVoice createVoiceClone(@RequestParam("file") MultipartFile file,
			@RequestParam("home_id") String homeId, @RequestParam("name") String name) {
		if (file.isEmpty()) {
			throw new InvalidVoiceFileException("녹음 파일이 비어 있습니다.");
		}
		RegisteredVoiceController.validateHomeId(homeId);
		String displayName = RegisteredVoiceController.validateName(name);
		if (!elevenLabs.isConfigured()) throw new ElevenLabsConfigurationException();
		// Check the table before making a paid, irreversible upstream clone request.
		profiles.ensureReady();

		log.info("Voice sample received: size={} bytes", file.getSize());

		VoiceCloneResponse clone = voiceService.createVoiceClone(file);
		try {
			return profiles.save(homeId, clone.voiceId(), displayName, clone.requiresVerification());
		} catch (VoiceStoreUnavailableException storeError) {
			try {
				voiceService.deleteVoice(clone.voiceId());
			} catch (RuntimeException compensationError) {
				// The storage failure remains the primary error. A later provider cleanup can be retried separately.
				log.warn("Could not compensate an ElevenLabs clone after voice profile storage failed");
			}
			throw storeError;
		}
	}
}
