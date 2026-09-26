package com.wificare.voice.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class PreferredContentControllerTests {
    private static final UUID CONTENT_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final PreferredContentRepository repository = mock(PreferredContentRepository.class);
    private final PreferredContentController controller = new PreferredContentController(repository);

    @Test
    void listsSavedItemsWithoutFrontendMocks() {
        ContentItem item = new ContentItem("youtube-" + CONTENT_ID, "youtube", "좋아하는 영상",
                "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        when(repository.list("demo_solo_house009")).thenReturn(List.of(item));

        PreferredContentController.ContentList result = controller.list("demo_solo_house009");

        assertThat(result.count()).isEqualTo(1);
        assertThat(result.contents()).containsExactly(item);
    }

    @Test
    void imageUploadUsesValidatedBytesAndHome() {
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0};
        MockMultipartFile file = new MockMultipartFile("file", "photo.png", "text/plain", png);
        ContentItem item = new ContentItem("image-" + CONTENT_ID, "image", "가족 사진",
                "/api/content/images/" + CONTENT_ID + "?home_id=demo_solo_house009", null);
        when(repository.saveImage("demo_solo_house009", "가족 사진", png, "image/png")).thenReturn(item);

        var response = controller.saveImage("demo_solo_house009", " 가족 사진 ", file);

        assertThat(response.getStatusCode().value()).isEqualTo(201);
        assertThat(response.getBody()).isEqualTo(item);
        verify(repository).saveImage("demo_solo_house009", "가족 사진", png, "image/png");
    }

    @Test
    void acceptsA701KbHeicWithCompatibleBrandEvenWhenBrowserMimeIsGeneric() {
        byte[] heic = new byte[701 * 1024];
        byte[] header = {0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'i', 'f', '1', 0, 0, 0, 0,
                'h', 'e', 'i', 'c', 'm', 'i', 'a', 'f'};
        System.arraycopy(header, 0, heic, 0, header.length);
        MockMultipartFile file = new MockMultipartFile("file", "photo.heic", "application/octet-stream", heic);
        ContentItem item = new ContentItem("image-" + CONTENT_ID, "image", "가족 사진",
                "/api/content/images/" + CONTENT_ID + "?home_id=demo_solo_house009", null);
        when(repository.saveImage("demo_solo_house009", "가족 사진", heic, "image/heic")).thenReturn(item);

        assertThat(controller.saveImage("demo_solo_house009", "가족 사진", file).getStatusCode().value())
                .isEqualTo(201);
        verify(repository).saveImage("demo_solo_house009", "가족 사진", heic, "image/heic");
    }

    @Test
    void youtubeUploadStoresTheValidatedVideoId() {
        ContentItem item = new ContentItem("youtube-" + CONTENT_ID, "youtube", "좋아하는 음악",
                "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        when(repository.saveYoutube("demo_solo_house009", "좋아하는 음악", "dQw4w9WgXcQ"))
                .thenReturn(item);

        var response = controller.saveYoutube(new PreferredContentController.YoutubeRequest(
                "demo_solo_house009", " 좋아하는 음악 ", "https://youtu.be/dQw4w9WgXcQ"));

        assertThat(response.getStatusCode().value()).isEqualTo(201);
        assertThat(response.getBody()).isEqualTo(item);
        verify(repository).saveYoutube("demo_solo_house009", "좋아하는 음악", "dQw4w9WgXcQ");
    }

    @Test
    void renamesOnlyTheRequestedHomesContent() {
        ContentItem item = new ContentItem("image-" + CONTENT_ID, "image", "새 이름",
                "/api/content/images/" + CONTENT_ID + "?home_id=demo_solo_house009", null);
        when(repository.rename("image", CONTENT_ID, "demo_solo_house009", "새 이름")).thenReturn(item);

        ContentItem result = controller.rename("image", CONTENT_ID.toString(),
                new PreferredContentController.UpdateRequest("demo_solo_house009", " 새 이름 "));

        assertThat(result).isEqualTo(item);
        verify(repository).rename("image", CONTENT_ID, "demo_solo_house009", "새 이름");
    }

    @Test
    void deletesOnlyTheRequestedHomesContent() {
        var response = controller.delete("youtube", CONTENT_ID.toString(), "demo_solo_house009");

        assertThat(response.getStatusCode().value()).isEqualTo(204);
        verify(repository).delete("youtube", CONTENT_ID, "demo_solo_house009");
    }
}
