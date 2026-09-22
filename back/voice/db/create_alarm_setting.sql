BEGIN;

CREATE TABLE IF NOT EXISTS public.alarm_setting (
    home_id varchar(128) PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT true,
    meal_enabled boolean NOT NULL DEFAULT true,
    medication_enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT alarm_setting_home_id_check
        CHECK (home_id ~ '^[A-Za-z0-9_-]{1,128}$')
);

COMMIT;
