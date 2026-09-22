from datetime import date
from typing import Any

from psycopg import sql

from app.config import ReportProfile, Settings, get_settings
from app.db import database_connection


TABLE_BY_PROFILE: dict[ReportProfile, tuple[str, str]] = {
    "one_person": ("public", "reporting_data_one_person"),
    "two_to_three": ("public", "reporting_data_two_to_three"),
}

SELECT_COLUMNS = (
    "home_id",
    "household_type",
    "date",
    "event_time",
    "record_type",
    "subject_type",
    "subject",
    "metric_code",
    "value",
    "unit",
    "baseline_value",
    "delta_value",
    "baseline_days",
    "data_status",
    "evidence",
)


def parse_report_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"날짜 형식이 올바르지 않습니다: {value}") from exc


def table_name_for_profile(profile: ReportProfile) -> str:
    schema, table = TABLE_BY_PROFILE[profile]
    return f"{schema}.{table}"


def load_daily_records(
    profile: ReportProfile,
    report_date: str,
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    selected_date = parse_report_date(report_date)
    schema, table = TABLE_BY_PROFILE[profile]
    query = sql.SQL(
        "SELECT {columns} FROM {table} "
        "WHERE date = %s "
        "ORDER BY event_time NULLS LAST, record_type, metric_code"
    ).format(
        columns=sql.SQL(", ").join(map(sql.Identifier, SELECT_COLUMNS)),
        table=sql.Identifier(schema, table),
    )

    with database_connection(settings or get_settings()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (selected_date,))
            records = [dict(row) for row in cursor.fetchall()]

    if not records:
        raise ValueError(
            f"profile={profile}, date={report_date}에 해당하는 데이터가 없습니다."
        )

    home_ids = {str(row["home_id"]) for row in records}
    household_types = {str(row["household_type"]) for row in records}
    if len(home_ids) != 1 or len(household_types) != 1:
        raise ValueError("대표 가구 테이블에는 한 가구 유형과 한 home_id만 있어야 합니다.")

    for row_id, record in enumerate(records, start=1):
        record["row_id"] = row_id
    return records
