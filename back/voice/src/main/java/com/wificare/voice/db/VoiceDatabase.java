package com.wificare.voice.db;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class VoiceDatabase {
    private final Environment environment;

    public VoiceDatabase(Environment environment) {
        this.environment = environment;
    }

    private String setting(String key) {
        String value = environment.getProperty(key);
        if (value == null || value.isBlank()) throw new IllegalStateException("DB configuration is incomplete");
        return value;
    }

    public Connection connect() throws SQLException {
        String port = environment.getProperty("PGPORT", "5432");
        if (!port.matches("[0-9]{1,5}")) throw new IllegalStateException("Invalid DB port");
        Properties properties = new Properties();
        properties.setProperty("user", setting("PGUSER"));
        properties.setProperty("password", setting("PGPASSWORD"));
        properties.setProperty("sslmode", environment.getProperty("PGSSLMODE", "require"));
        properties.setProperty("connectTimeout", "5");
        properties.setProperty("socketTimeout", "10");
        return DriverManager.getConnection("jdbc:postgresql://" + setting("PGHOST") + ":" + port
                + "/" + setting("PGDATABASE"), properties);
    }
}
