package com.wificare.voice.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class ContentValidationTests {
    @Test
    void acceptsYoutubeHostsButRejectsLookalikes() {
        assertThat(ContentValidation.youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=1"))
                .isEqualTo("dQw4w9WgXcQ");
        assertThat(ContentValidation.youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
                .isEqualTo("dQw4w9WgXcQ");
        assertThatThrownBy(() -> ContentValidation.youtubeVideoId(
                "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ContentValidation.youtubeVideoId(
                "http://www.youtube.com/watch?v=dQw4w9WgXcQ"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void validatesImageBytesInsteadOfTrustingTheBrowserMimeType() {
        byte[] jpeg = {(byte) 0xff, (byte) 0xd8, (byte) 0xff};
        assertThat(ContentValidation.imageMime(jpeg)).isEqualTo("image/jpeg");
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0};
        assertThat(ContentValidation.imageMime(png)).isEqualTo("image/png");
        byte[] webp = {'R', 'I', 'F', 'F', 4, 0, 0, 0, 'W', 'E', 'B', 'P'};
        assertThat(ContentValidation.imageMime(webp)).isEqualTo("image/webp");
        byte[] heic = {0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'i', 'f', '1', 0, 0, 0, 0,
                'h', 'e', 'i', 'c', 'm', 'i', 'a', 'f'};
        assertThat(ContentValidation.imageBrand(heic)).isEqualTo("heic");
        assertThat(ContentValidation.imageMime(heic)).isEqualTo("image/heic");
        byte[] heif = {0, 0, 0, 16, 'f', 't', 'y', 'p', 'm', 'i', 'f', '1', 0, 0, 0, 0};
        assertThat(ContentValidation.imageBrand(heif)).isEqualTo("mif1");
        assertThat(ContentValidation.imageMime(heif)).isEqualTo("image/heif");
        byte[] unknownBrand = heic.clone();
        unknownBrand[8] = 'a'; unknownBrand[9] = 'v'; unknownBrand[10] = 'i'; unknownBrand[11] = 'f';
        unknownBrand[16] = 'a'; unknownBrand[17] = 'v'; unknownBrand[18] = 'i'; unknownBrand[19] = 'f';
        assertThat(ContentValidation.imageBrand(unknownBrand)).isEqualTo("unrecognized-ftyp-brand");
        assertThatThrownBy(() -> ContentValidation.imageMime(unknownBrand))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ContentValidation.imageMime("not an image".getBytes()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ContentValidation.imageMime(new byte[ContentValidation.MAX_IMAGE_BYTES + 1]))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void acceptsExactly25MibAndRejectsLargerImages() {
        byte[] maximumPng = new byte[ContentValidation.MAX_IMAGE_BYTES];
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
        System.arraycopy(png, 0, maximumPng, 0, png.length);

        assertThat(ContentValidation.imageMime(maximumPng)).isEqualTo("image/png");
        assertThatThrownBy(() -> ContentValidation.imageMime(
                new byte[ContentValidation.MAX_IMAGE_BYTES + 1]))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("25MiB");
    }

    @Test
    void validatesUuidContentIds() {
        UUID id = UUID.fromString("11111111-1111-4111-8111-111111111111");
        assertThat(ContentValidation.itemId(id.toString())).isEqualTo(id);
        assertThatThrownBy(() -> ContentValidation.itemId("7"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ContentValidation.itemId("not-a-uuid"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void storageConstraintErrorDoesNotExposeSqlDetails() {
        var error = new ContentStoreUnavailableException(new java.sql.SQLException("private detail", "23514"));
        assertThat(error.getMessage()).isEqualTo("이미지 저장소의 데이터 제약조건을 확인해주세요.");
    }

    @Test
    void validatesSingleHomeAndFrontendNameLength() {
        assertThat(ContentValidation.homeId("demo_solo_house009")).isEqualTo("demo_solo_house009");
        assertThat(ContentValidation.name(" 가족 사진 ")).isEqualTo("가족 사진");
        assertThatThrownBy(() -> ContentValidation.homeId("other-home!"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ContentValidation.name(" "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
