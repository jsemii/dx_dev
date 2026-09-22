import argparse

from app.config import get_settings
from app.report_preprocessor import preprocess_daily_records
from app.report_repository import load_daily_records, table_name_for_profile


def main() -> None:
    parser = argparse.ArgumentParser(
        description="OpenAI를 호출하지 않고 PostgreSQL 일일 데이터를 확인합니다."
    )
    parser.add_argument(
        "--profile",
        choices=("one_person", "two_to_three"),
        default="one_person",
    )
    parser.add_argument("--date", required=True)
    args = parser.parse_args()

    rows = load_daily_records(args.profile, args.date, get_settings())
    data = preprocess_daily_records(args.profile, args.date, rows)
    print(f"profile: {args.profile}")
    print(f"table: {table_name_for_profile(args.profile)}")
    print(f"home_id: {data['home_id']}")
    print(f"household_type: {data['household_type']}")
    print(f"date: {data['report_date']}")
    print(f"total rows: {data['row_count']}")
    print(f"event rows: {data['event_count']}")
    print(f"metric rows: {data['metric_count']}")
    print(
        "subjects: "
        + ", ".join(sorted({str(row["subject"]) for row in rows}))
    )


if __name__ == "__main__":
    main()
