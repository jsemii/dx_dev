import argparse

from app.config import get_settings
from app.report_service import create_daily_report


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI API로 일일 리포트를 생성합니다.")
    parser.add_argument(
        "--profile",
        choices=("one_person", "two_to_three"),
        default="one_person",
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--model", help=".env의 OPENAI_MODEL을 이번 실행에서만 덮어씁니다.")
    parser.add_argument("--force", action="store_true", help="기존 JSON 캐시를 무시합니다.")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="모델 비교용으로 JSON을 파일에 저장하지 않고 터미널에만 출력합니다.",
    )
    args = parser.parse_args()
    settings = get_settings()
    if args.model:
        settings = settings.model_copy(update={"openai_model": args.model})
    report, path = create_daily_report(
        args.profile,
        args.date,
        settings=settings,
        force=args.force,
        save_output=not args.no_save,
    )
    print(f"report_id: {report.report_id}")
    if path is not None:
        print(f"saved: {path.resolve()}")
    else:
        print("saved: skipped (--no-save)")
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
