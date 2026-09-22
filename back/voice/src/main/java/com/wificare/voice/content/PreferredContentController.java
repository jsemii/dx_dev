package com.wificare.voice.content;

import java.io.IOException;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import com.fasterxml.jackson.annotation.JsonProperty;

@RestController
@RequestMapping("/api/content")
public class PreferredContentController {
    private static final Logger log = LoggerFactory.getLogger(PreferredContentController.class);
    private final PreferredContentRepository repository;

    public PreferredContentController(PreferredContentRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ContentList list(@RequestParam("home_id") String homeId) {
        List<ContentItem> items = repository.list(ContentValidation.homeId(homeId));
        return new ContentList(homeId, items.size(), items);
    }

    @PostMapping(path = "/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ContentItem> saveImage(@RequestParam("home_id") String homeId,
            @RequestParam("name") String name, @RequestParam("file") MultipartFile file) {
        String validHomeId = ContentValidation.homeId(homeId);
        String validName = ContentValidation.name(name);
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException error) {
            throw new IllegalArgumentException("이미지 파일을 읽을 수 없습니다.");
        }
        String declaredMime = file.getContentType();
        if (declaredMime == null || !declaredMime.matches("[A-Za-z0-9/+.-]{1,64}")) declaredMime = "unknown";
        String mimeType;
        try {
            mimeType = ContentValidation.imageMime(bytes);
        } catch (IllegalArgumentException error) {
            log.warn("Image upload rejected: sizeBytes={}, declaredMime={}, ftypBrand={}",
                    bytes.length, declaredMime, ContentValidation.imageBrand(bytes));
            throw error;
        }
        log.info("Image upload validated: sizeBytes={}, declaredMime={}, detectedMime={}, ftypBrand={}",
                bytes.length, declaredMime, mimeType, ContentValidation.imageBrand(bytes));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(repository.saveImage(validHomeId, validName, bytes, mimeType));
    }

    @PostMapping(path = "/youtube", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ContentItem> saveYoutube(@RequestBody YoutubeRequest request) {
        if (request == null) throw new IllegalArgumentException("유튜브 링크가 필요합니다.");
        String homeId = ContentValidation.homeId(request.homeId());
        String name = ContentValidation.name(request.name());
        String videoId = ContentValidation.youtubeVideoId(request.sourceUrl());
        return ResponseEntity.status(HttpStatus.CREATED).body(repository.saveYoutube(homeId, name, videoId));
    }

    @GetMapping(path = "/images/{imageId}")
    public ResponseEntity<byte[]> image(@PathVariable long imageId, @RequestParam("home_id") String homeId) {
        if (imageId < 1) throw new ContentNotFoundException();
        PreferredContentRepository.ImageBlob blob = repository.image(imageId, ContentValidation.homeId(homeId));
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .contentType(MediaType.parseMediaType(blob.mimeType()))
                .body(blob.bytes());
    }

    @PatchMapping(path = "/items/{type}/{itemId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ContentItem rename(@PathVariable String type, @PathVariable long itemId,
            @RequestBody UpdateRequest request) {
        if (request == null) throw new IllegalArgumentException("콘텐츠 정보가 필요합니다.");
        return repository.rename(ContentValidation.contentType(type), ContentValidation.itemId(itemId),
                ContentValidation.homeId(request.homeId()), ContentValidation.name(request.name()));
    }

    @DeleteMapping("/items/{type}/{itemId}")
    public ResponseEntity<Void> delete(@PathVariable String type, @PathVariable long itemId,
            @RequestParam("home_id") String homeId) {
        repository.delete(ContentValidation.contentType(type), ContentValidation.itemId(itemId),
                ContentValidation.homeId(homeId));
        return ResponseEntity.noContent().build();
    }

    public record ContentList(String home_id, int count, List<ContentItem> contents) {
    }

    public record YoutubeRequest(String homeId, String name, String sourceUrl) {
    }

    public record UpdateRequest(@JsonProperty("home_id") String homeId, String name) {
    }
}
