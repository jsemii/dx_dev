package com.wificare.voice.alarm.delivery;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class AlarmDeliveryPropertiesBindingTests {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withBean(AlarmDeliveryProperties.class)
            .withPropertyValues(
                    "alarm.delivery.enabled=true",
                    "alarm.delivery.grace-ms=120000",
                    "alarm.delivery.max-audio-bytes=1048576",
                    "alarm.delivery.anger-base-url=http://127.0.0.1:3001",
                    "alarm.delivery.internal-token=12345678901234567890123456789012",
                    "alarm.delivery.request-timeout-ms=150000",
                    "alarm.delivery.escalation-seconds=10");

    @Test
    void enabledAndEscalationSecondsBindToTheSchedulerProperties() {
        context.run(application -> {
            AlarmDeliveryProperties properties = application.getBean(AlarmDeliveryProperties.class);
            assertThat(properties.enabled()).isTrue();
            assertThat(properties.escalationDelay()).isEqualTo(Duration.ofSeconds(10));
        });
    }

    @Test
    void applicationConfigurationKeepsTheEnvironmentDefaultAtNinetySeconds() throws Exception {
        String source = Files.readString(Path.of("src/main/resources/application.properties"));
        assertThat(source).contains(
                "alarm.delivery.enabled=${ALARM_DELIVERY_ENABLED:false}",
                "alarm.delivery.escalation-seconds=${ALARM_ESCALATION_SECONDS:90}");
    }
}
