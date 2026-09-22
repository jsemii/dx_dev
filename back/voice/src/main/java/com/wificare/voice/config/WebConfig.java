package com.wificare.voice.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

	private static final String[] FRONTEND_ORIGINS = {
			"http://127.0.0.1:5175", "http://localhost:5175"
	};

	@Override
	public void addCorsMappings(CorsRegistry registry) {
		registry.addMapping("/api/**")
				.allowedOrigins(FRONTEND_ORIGINS)
				.allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
				.allowedHeaders("*");
	}
}
