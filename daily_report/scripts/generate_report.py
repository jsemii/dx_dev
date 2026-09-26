import argparse

from app.config import get_settings
from app.report_service import migrate_report_range


def main() -> None:
    parser = argparse.ArgumentParser(description="DB 일일 리포트를 날짜 순으로 재생성합니다.")
    parser.add_argument(
        "--profile",
        choices=("one_person", "two_to_three"),
        default="one_person",
    )
    parser.add_argument("--home-id", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--model", help=".env의 OPENAI_MODEL을 이번 실행에서만 덮어씁니다.")
    parser.add_argument(
        "--apply-migration",
        action="store_true",
        help="준비 결과를 실제 DB에 저장합니다. 생략 시 읽기/준비만 합니다.",
    )
    args = parser.parse_args()
    settings = get_settings()
    if args.model:
        settings = settings.model_copy(update={"openai_model": args.model})
    if not args.apply_migration:
        parser.error("기존 리포트 정정은 --apply-migration을 명시해야 합니다.")
    prepared = migrate_report_range(
        args.profile,
        args.home_id,
        args.start_date,
        args.end_date,
        settings,
    )
    print(f"prepared_reports: {len(prepared)}")
    print("mode: migrated-existing-reports")
    for report in prepared:
        print(f"{report.report_date}: {report.report_id}")


if __name__ == "__main__":
    main()
