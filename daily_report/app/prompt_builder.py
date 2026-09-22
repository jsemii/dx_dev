from typing import Any


def build_report_input(preprocessed: dict[str, Any]) -> dict[str, Any]:
    return {
        "task": "daily_homecare_report",
        "home_id": preprocessed["home_id"],
        "household_type": preprocessed["household_type"],
        "report_date": preprocessed["report_date"],
        "source": {
            "profile": preprocessed["profile"],
            "table": preprocessed["source_table"],
            "row_count": preprocessed["row_count"],
            "event_count": preprocessed["event_count"],
            "metric_count": preprocessed["metric_count"],
        },
        "source_notice": (
            "입력은 PostgreSQL에서 날짜로 조회한 상세 사건과 일일 지표입니다. "
            "data_status와 evidence는 내부 판단에만 사용하고 기술 용어를 "
            "사용자용 문장에 노출하지 마십시오."
        ),
        "rules": [
            "입력 행에 없는 사실을 만들지 않는다.",
            "value와 baseline_value를 임의로 재계산하지 않는다.",
            "의학적 진단이나 질병 단정을 하지 않는다.",
            "주요 판단에 evidence_refs를 포함한다.",
            "row, row_id, 행 번호는 evidence_refs에만 넣고 사용자 문장에는 쓰지 않는다.",
            "timeline은 event_time 순서로 작성한다.",
            "출력은 summary, timeline, highlights 세 영역만 작성한다.",
            "이모지와 이모티콘을 사용하지 않는다.",
            "data_status, evidence, 합성 시나리오 등 내부 데이터 용어를 출력하지 않는다.",
            "초 단위 수치는 display_value 또는 display_baseline_value의 분·시간 표기를 사용한다.",
            "냉장고, TV, 정수기 관련 핵심 변화가 있으면 우선 반영한다.",
            "highlights는 title, baseline, today를 분리하고 baseline과 today 값이 모두 있는 비교만 작성한다.",
        ],
        "timeline_events": preprocessed["timeline_events"],
        "daily_metrics": preprocessed["daily_metrics"],
    }
