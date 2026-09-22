-- Run against the existing campus_lgdx_1 database; this creates tables, not a new database.
CREATE TABLE IF NOT EXISTS public.image_data (
    image_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    home_id varchar(128) NOT NULL,
    display_name varchar(30) NOT NULL
        CHECK (length(btrim(display_name)) BETWEEN 1 AND 30),
    image_data bytea NOT NULL,
    mime_type varchar(30) NOT NULL
        CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
    size_bytes integer NOT NULL
        CHECK (size_bytes BETWEEN 1 AND 5242880),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(image_data) = size_bytes)
);

CREATE INDEX IF NOT EXISTS wifi_care_preferred_images_home_time_idx
    ON public.image_data (home_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.youtube_data (
    link_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    home_id varchar(128) NOT NULL,
    display_name varchar(30) NOT NULL
        CHECK (length(btrim(display_name)) BETWEEN 1 AND 30),
    youtube_url text NOT NULL
        CHECK (length(youtube_url) BETWEEN 1 AND 2048),
    video_id varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wifi_care_preferred_youtube_home_time_idx
    ON public.youtube_data (home_id, created_at DESC);
