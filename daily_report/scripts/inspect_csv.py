import argparse
from pathlib import Path

from app.csv_loader import load_daily_metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="일일지표 CSV를 검증합니다.")
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--home-id", required=True)
    parser.add_argument("--date", required=True)
    args = parser.parse_args()
    rows = load_daily_metrics(args.csv, args.home_id, args.date)
    print(f"선택된 행 수: {len(rows)}")
    print(f"첫 시각: {rows[0]['event_time']}")
    print(f"마지막 시각: {rows[-1]['event_time']}")
    print(f"subject_type: {sorted({row['subject_type'] for row in rows})}")
    print(f"data_status: {sorted({row['data_status'] for row in rows})}")


if __name__ == "__main__":
    main()

