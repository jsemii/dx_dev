package com.wificare.voice.alarm;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.time.LocalTime;
import java.util.List;

import com.wificare.voice.controller.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AlarmHttpTests {
    private final AlarmRepository repository = mock(AlarmRepository.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new AlarmController(repository))
            .setControllerAdvice(new ApiExceptionHandler()).build();

    @Test
    void getAndPostUseSnakeCaseAndScreenTime() throws Exception {
        AlarmItem item = new AlarmItem(11, "demo_solo_house009", "meal", "아침", "08:30", true);
        when(repository.list("demo_solo_house009")).thenReturn(List.of(item));
        when(repository.add("demo_solo_house009", "meal", "아침", LocalTime.of(8, 30))).thenReturn(item);

        mvc.perform(get("/api/alarms").param("home_id", "demo_solo_house009"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"alarm_id\":11")))
                .andExpect(content().string(containsString("\"time\":\"08:30\"")));
        mvc.perform(post("/api/alarms").contentType("application/json")
                .content("{\"home_id\":\"demo_solo_house009\",\"type\":\"meal\",\"name\":\"아침\",\"time\":\"08:30\"}"))
                .andExpect(status().isCreated())
                .andExpect(content().string(containsString("\"home_id\":\"demo_solo_house009\"")));
    }

    @Test
    void getsAndUpdatesPersistentSettings() throws Exception {
        AlarmSetting setting = new AlarmSetting("demo_solo_house009", false, true, false);
        when(repository.settings("demo_solo_house009")).thenReturn(setting);
        when(repository.updateSettings("demo_solo_house009", false, true, false)).thenReturn(setting);

        mvc.perform(get("/api/alarms/settings").param("home_id", "demo_solo_house009"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"meal_enabled\":true")));
        mvc.perform(patch("/api/alarms/settings").contentType("application/json")
                .content("{\"home_id\":\"demo_solo_house009\",\"enabled\":false,"
                        + "\"meal_enabled\":true,\"medication_enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"medication_enabled\":false")));
    }

    @Test
    void distinguishesBadInputMissingAlarmAndStoreFailure() throws Exception {
        mvc.perform(post("/api/alarms").contentType("application/json")
                .content("{\"home_id\":\"demo_solo_house009\",\"type\":\"other\",\"name\":\"아침\",\"time\":\"08:30\"}"))
                .andExpect(status().isBadRequest());

        when(repository.setEnabled(11, "demo_solo_house009", false)).thenThrow(new AlarmNotFoundException());
        mvc.perform(patch("/api/alarms/11").contentType("application/json")
                .content("{\"home_id\":\"demo_solo_house009\",\"enabled\":false}"))
                .andExpect(status().isNotFound());

        when(repository.list("demo_solo_house009"))
                .thenThrow(new AlarmStoreUnavailableException(new SQLException("private", "08006")));
        mvc.perform(get("/api/alarms").param("home_id", "demo_solo_house009"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().string("{\"message\":\"알림 저장소를 사용할 수 없습니다.\"}"));
    }
}
