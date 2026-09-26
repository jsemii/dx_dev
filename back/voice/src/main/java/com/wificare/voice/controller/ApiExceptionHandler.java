package com.wificare.voice.controller;

import jakarta.servlet.http.HttpServletRequest;
import com.wificare.voice.dto.ApiErrorResponse;
import com.wificare.voice.content.ContentNotFoundException;
import com.wificare.voice.content.ContentItemNotFoundException;
import com.wificare.voice.content.ContentStoreUnavailableException;
import com.wificare.voice.alarm.AlarmNotFoundException;
import com.wificare.voice.alarm.AlarmStoreUnavailableException;
import com.wificare.voice.exception.ElevenLabsApiException;
import com.wificare.voice.exception.ElevenLabsConfigurationException;
import com.wificare.voice.exception.DuplicateSharedPhraseException;
import com.wificare.voice.exception.InvalidVoiceFileException;
import com.wificare.voice.exception.VoiceNotFoundException;
import com.wificare.voice.exception.VoiceStoreUnavailableException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(InvalidVoiceFileException.class)
	public ResponseEntity<ApiErrorResponse> handleInvalidFile(InvalidVoiceFileException exception) {
		return response(HttpStatus.BAD_REQUEST, exception.getMessage());
	}

	@ExceptionHandler(MissingServletRequestPartException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingFile(MissingServletRequestPartException exception) {
		return response(HttpStatus.BAD_REQUEST, "녹음 파일이 필요합니다.");
	}

	@ExceptionHandler(MissingServletRequestParameterException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingParameter(MissingServletRequestParameterException exception) {
		return response(HttpStatus.BAD_REQUEST, "필수 요청 값이 없습니다.");
	}

	@ExceptionHandler(MaxUploadSizeExceededException.class)
	public ResponseEntity<ApiErrorResponse> handleFileTooLarge(MaxUploadSizeExceededException exception,
			HttpServletRequest request) {
		return response(HttpStatus.CONTENT_TOO_LARGE, request.getRequestURI().startsWith("/api/content/images")
				? "이미지 파일 크기가 너무 큽니다." : "녹음 파일 크기가 너무 큽니다.");
	}

	@ExceptionHandler(ElevenLabsConfigurationException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingConfiguration(ElevenLabsConfigurationException exception) {
		return response(HttpStatus.SERVICE_UNAVAILABLE, exception.getMessage());
	}

	@ExceptionHandler(ElevenLabsApiException.class)
	public ResponseEntity<ApiErrorResponse> handleElevenLabsError(ElevenLabsApiException exception) {
		return response(HttpStatus.BAD_GATEWAY, exception.getMessage());
	}

	@ExceptionHandler(IllegalArgumentException.class)
	public ResponseEntity<ApiErrorResponse> handleInvalidInput(IllegalArgumentException exception) {
		return response(HttpStatus.BAD_REQUEST, exception.getMessage());
	}

	@ExceptionHandler(DuplicateSharedPhraseException.class)
	public ResponseEntity<ApiErrorResponse> handleDuplicateSharedPhrase(DuplicateSharedPhraseException exception) {
		return response(HttpStatus.CONFLICT, exception.getMessage());
	}

	@ExceptionHandler(VoiceStoreUnavailableException.class)
	public ResponseEntity<ApiErrorResponse> handleUnavailableStore(VoiceStoreUnavailableException exception) {
		return response(HttpStatus.SERVICE_UNAVAILABLE, exception.getMessage());
	}

	@ExceptionHandler(ContentStoreUnavailableException.class)
	public ResponseEntity<ApiErrorResponse> handleUnavailableContentStore(ContentStoreUnavailableException exception) {
		return response(HttpStatus.SERVICE_UNAVAILABLE, exception.getMessage());
	}

	@ExceptionHandler(ContentNotFoundException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingContent(ContentNotFoundException exception) {
		return response(HttpStatus.NOT_FOUND, exception.getMessage());
	}

	@ExceptionHandler(ContentItemNotFoundException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingContentItem(ContentItemNotFoundException exception) {
		return response(HttpStatus.NOT_FOUND, exception.getMessage());
	}

	@ExceptionHandler(AlarmNotFoundException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingAlarm(AlarmNotFoundException exception) {
		return response(HttpStatus.NOT_FOUND, exception.getMessage());
	}

	@ExceptionHandler(AlarmStoreUnavailableException.class)
	public ResponseEntity<ApiErrorResponse> handleUnavailableAlarmStore(AlarmStoreUnavailableException exception) {
		return response(HttpStatus.SERVICE_UNAVAILABLE, exception.getMessage());
	}

	@ExceptionHandler(VoiceNotFoundException.class)
	public ResponseEntity<ApiErrorResponse> handleMissingVoice(VoiceNotFoundException exception) {
		return response(HttpStatus.NOT_FOUND, exception.getMessage());
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException exception) {
		String message = exception.getBindingResult().getFieldErrors().stream()
				.findFirst()
				.map(error -> error.getDefaultMessage())
				.orElse("TTS 요청을 확인해주세요.");
		return response(HttpStatus.BAD_REQUEST, message);
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<ApiErrorResponse> handleUnreadableRequest(HttpMessageNotReadableException exception) {
		return response(HttpStatus.BAD_REQUEST, "올바른 JSON 요청이 필요합니다.");
	}

	private ResponseEntity<ApiErrorResponse> response(HttpStatus status, String message) {
		return ResponseEntity.status(status).body(new ApiErrorResponse(message));
	}
}
