package com.wificare.voice.content;

import java.sql.SQLException;

public class ContentStoreUnavailableException extends RuntimeException {
    public ContentStoreUnavailableException(Throwable cause) {
        super(cause instanceof SQLException error && "23514".equals(error.getSQLState())
                ? "이미지 저장소의 데이터 제약조건을 확인해주세요."
                : "선호 콘텐츠 저장소를 사용할 수 없습니다.", cause);
    }
}
