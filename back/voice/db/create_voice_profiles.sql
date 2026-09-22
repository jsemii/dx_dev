-- Local ThinQ demo: metadata only. Raw recordings are never stored in PostgreSQL.
CREATE TABLE IF NOT EXISTS public.voice_data (
    voice_id varchar(200) PRIMARY KEY,
    home_id varchar(128) NOT NULL,
    display_name varchar(20) NOT NULL CHECK (length(btrim(display_name)) > 0),
    requires_verification boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wifi_care_voice_profiles_home_created_idx
    ON public.voice_data (home_id, created_at DESC);
