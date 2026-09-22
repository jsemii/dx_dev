package com.wificare.voice.content;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.nio.charset.StandardCharsets;

public final class ContentValidation {
    public static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024;

    private ContentValidation() {
    }

    public static String homeId(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_]{1,128}")) {
            throw new IllegalArgumentException("가정 ID가 올바르지 않습니다.");
        }
        return value;
    }

    public static String name(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty() || trimmed.length() > 30) {
            throw new IllegalArgumentException("콘텐츠 이름은 1~30자로 입력하세요.");
        }
        return trimmed;
    }

    public static String contentType(String value) {
        if (!"image".equals(value) && !"youtube".equals(value)) {
            throw new IllegalArgumentException("콘텐츠 종류가 올바르지 않습니다.");
        }
        return value;
    }

    public static long itemId(long value) {
        if (value < 1) throw new IllegalArgumentException("콘텐츠 ID가 올바르지 않습니다.");
        return value;
    }

    public static String imageMime(byte[] data) {
        if (data == null || data.length == 0 || data.length > MAX_IMAGE_BYTES) {
            throw new IllegalArgumentException("이미지는 5MB 이하의 JPEG, PNG, WebP, HEIC 파일이어야 합니다.");
        }
        if (data.length >= 3 && (data[0] & 0xff) == 0xff && (data[1] & 0xff) == 0xd8
                && (data[2] & 0xff) == 0xff) {
            return "image/jpeg";
        }
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
        if (data.length >= png.length && Arrays.equals(Arrays.copyOf(data, png.length), png)) {
            return "image/png";
        }
        if (data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        String brand = imageBrand(data);
        if (brand.equals("heic") || brand.equals("heix") || brand.equals("hevc") || brand.equals("hevx")) {
            return "image/heic";
        }
        throw new IllegalArgumentException("JPEG, PNG, WebP, HEIC 이미지만 등록할 수 있습니다.");
    }

    // 진단 로그에는 파일 바이트 대신 알려진 ftyp 브랜드 판별 결과만 남긴다.
    public static String imageBrand(byte[] data) {
        if (data == null || data.length < 16 || data[4] != 'f' || data[5] != 't'
                || data[6] != 'y' || data[7] != 'p') return "no-ftyp";
        long boxSize = ((long) (data[0] & 0xff) << 24) | ((long) (data[1] & 0xff) << 16)
                | ((long) (data[2] & 0xff) << 8) | (data[3] & 0xff);
        if (boxSize < 16 || boxSize > data.length) return "invalid-ftyp-size";
        for (int offset = 8; offset + 4 <= boxSize; offset += 4) {
            if (offset == 12) continue;
            String brand = new String(data, offset, 4, StandardCharsets.US_ASCII);
            if (brand.equals("heic") || brand.equals("heix") || brand.equals("hevc") || brand.equals("hevx")) {
                return brand;
            }
        }
        return "unrecognized-ftyp-brand";
    }

    public static String youtubeVideoId(String rawUrl) {
        if (rawUrl == null || rawUrl.length() > 2048) {
            throw new IllegalArgumentException("유튜브 링크가 올바르지 않습니다.");
        }
        URI uri;
        try {
            uri = URI.create(rawUrl.trim());
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("유튜브 링크가 올바르지 않습니다.");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null
                || uri.getPort() != -1 || uri.getHost() == null) {
            throw new IllegalArgumentException("https 유튜브 링크를 입력하세요.");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getPath() == null ? "" : uri.getPath();
        String videoId = null;
        if (host.equals("youtu.be") || host.equals("www.youtu.be")) {
            String[] parts = path.split("/");
            if (parts.length == 2) videoId = parts[1];
        } else if (host.equals("youtube.com") || host.equals("www.youtube.com")
                || host.equals("m.youtube.com") || host.equals("youtube-nocookie.com")
                || host.equals("www.youtube-nocookie.com")) {
            if (path.equals("/watch") && uri.getRawQuery() != null) {
                for (String field : uri.getRawQuery().split("&")) {
                    if (field.startsWith("v=")) {
                        videoId = field.substring(2);
                        break;
                    }
                }
            } else {
                String[] parts = path.split("/");
                if (parts.length == 3 && (parts[1].equals("shorts")
                        || parts[1].equals("embed") || parts[1].equals("live"))) {
                    videoId = parts[2];
                }
            }
        }
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) {
            throw new IllegalArgumentException("유효한 유튜브 영상 링크를 입력하세요.");
        }
        return videoId;
    }
}
