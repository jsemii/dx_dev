BEGIN;

CREATE TABLE IF NOT EXISTS public.alarm_delivery (
    delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alarm_id uuid NOT NULL REFERENCES public.alarm(alarm_id) ON DELETE CASCADE,
    resident_thinq_id varchar(128) NOT NULL,
    alarm_type public.alarm_type_enum NOT NULL,
    scheduled_for timestamptz NOT NULL,
    status varchar(16) NOT NULL,
    request_id uuid NOT NULL,
    started_at timestamptz,
    ended_at timestamptz,
    failure_code varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alarm_delivery_status_check CHECK (
        status IN ('PENDING', 'GENERATING', 'SENT', 'PLAYING', 'COMPLETED', 'FAILED')
    ),
    CONSTRAINT alarm_delivery_alarm_schedule_key UNIQUE (alarm_id, scheduled_for),
    CONSTRAINT alarm_delivery_request_key UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS alarm_delivery_due_idx
    ON public.alarm_delivery (status, scheduled_for);

ALTER TABLE public.care_event
    ADD COLUMN IF NOT EXISTS alarm_delivery_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS care_event_alarm_delivery_key
    ON public.care_event (alarm_delivery_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'care_event_alarm_delivery_fkey'
          AND conrelid = 'public.care_event'::regclass
    ) THEN
        ALTER TABLE public.care_event
            ADD CONSTRAINT care_event_alarm_delivery_fkey
            FOREIGN KEY (alarm_delivery_id)
            REFERENCES public.alarm_delivery(delivery_id)
            ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN public.alarm_delivery.scheduled_for IS
    'alarm_time combined with the execution date in Asia/Seoul, stored as timestamptz';

COMMIT;
