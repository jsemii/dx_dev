package com.wificare.voice.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class PreferredContentControllerTests {
    private final PreferredContentRepository repository = mock(PreferredContentRepository.class);
    private final PreferredContentController controller = new PreferredContentController(repository);

    @Test
    void listsSavedItemsWithoutFrontendMocks() {
        ContentItem item = new ContentItem("youtube-3", "youtube", "좋아하는 영상",
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
        ContentItem item = new ContentItem("image-1", "image", "가족 사진",
                "/api/content/images/1?home_id=demo_solo_house009", null);
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
        ContentItem item = new ContentItem("image-2", "image", "가족 사진",
                "/api/content/images/2?home_id=demo_solo_house009", null);
        when(repository.saveImage("demo_solo_house009", "가족 사진", heic, "image/heic")).thenReturn(item);

        assertThat(controller.saveImage("demo_solo_house009", "가족 사진", file).getStatusCode().value())
                .isEqualTo(201);
        verify(repository).saveImage("demo_solo_house009", "가족 사진", heic, "image/heic");
    }

    @Test
    void youtubeUploadStoresTheValidatedVideoId() {
        ContentItem item = new ContentItem("youtube-1", "youtube", "좋아하는 음악",
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
        ContentItem item = new ContentItem("image-7", "image", "새 이름",
                "/api/content/images/7?home_id=demo_solo_house009", null);
        when(repository.rename("image", 7, "demo_solo_house009", "새 이름")).thenReturn(item);

        ContentItem result = controller.rename("image", 7,
                new PreferredContentController.UpdateRequest("demo_solo_house009", " 새 이름 "));

        assertThat(result).isEqualTo(item);
        verify(repository).rename("image", 7, "demo_solo_house009", "새 이름");
    }

    @Test
    void deletesOnlyTheRequestedHomesContent() {
        var response = controller.delete("youtube", 8, "demo_solo_house009");

        assertThat(response.getStatusCode().value()).isEqualTo(204);
        verify(repository).delete("youtube", 8, "demo_solo_house009");
    }
}
