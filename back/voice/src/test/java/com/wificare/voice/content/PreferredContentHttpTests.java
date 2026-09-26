package com.wificare.voice.content;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.util.UUID;

import com.wificare.voice.controller.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PreferredContentHttpTests {
    private static final UUID CONTENT_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final PreferredContentRepository repository = mock(PreferredContentRepository.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new PreferredContentController(repository))
            .setControllerAdvice(new ApiExceptionHandler()).build();

    @Test
    void uuidImageAndRenameResponsesKeepExistingApiShape() throws Exception {
        byte[] image = {(byte) 0xff, (byte) 0xd8, (byte) 0xff};
        ContentItem renamed = new ContentItem("image-" + CONTENT_ID, "image", "새 이름",
                "/api/content/images/" + CONTENT_ID + "?home_id=home_23", null);
        when(repository.image(CONTENT_ID, "home_23"))
                .thenReturn(new PreferredContentRepository.ImageBlob(image, "image/jpeg"));
        when(repository.rename("image", CONTENT_ID, "home_23", "새 이름")).thenReturn(renamed);

        mvc.perform(get("/api/content/images/{contentId}", CONTENT_ID).param("home_id", "home_23"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, "image/jpeg"))
                .andExpect(content().bytes(image));
        mvc.perform(patch("/api/content/items/image/{contentId}", CONTENT_ID)
                .contentType("application/json")
                .content("{\"home_id\":\"home_23\",\"name\":\"새 이름\"}"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"id\":\"image-" + CONTENT_ID + "\"")));
    }

    @Test
    void invalidUuidIsBadRequest() throws Exception {
        mvc.perform(patch("/api/content/items/image/not-a-uuid")
                .contentType("application/json")
                .content("{\"home_id\":\"home_23\",\"name\":\"새 이름\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("{\"message\":\"콘텐츠 ID가 올바르지 않습니다.\"}"));
    }

    @Test
    void anotherResidentsContentIsNotFound() throws Exception {
        when(repository.image(CONTENT_ID, "other_home")).thenThrow(new ContentNotFoundException());

        mvc.perform(get("/api/content/images/{contentId}", CONTENT_ID).param("home_id", "other_home"))
                .andExpect(status().isNotFound());
    }

    @Test
    void databaseFailureIsServiceUnavailableWithoutInternalDetails() throws Exception {
        when(repository.list("home_23"))
                .thenThrow(new ContentStoreUnavailableException(new SQLException("private password", "08006")));

        mvc.perform(get("/api/content").param("home_id", "home_23"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().string("{\"message\":\"선호 콘텐츠 저장소를 사용할 수 없습니다.\"}"));
    }
}
