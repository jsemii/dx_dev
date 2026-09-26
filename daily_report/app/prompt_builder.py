from typing import Any


def build_summary_input(
    report_date: str,
    confirmed_facts: dict[str, Any],
) -> dict[str, Any]:
    return {
        "task": "write_summary_only",
        "report_date": report_date,
        "rules": [
            "확정된 사실을 요약하는 summary만 작성한다.",
            "timeline과 highlights를 추가·수정·삭제하지 않는다.",
            "수치, 긴급 여부, 평소와 다른 점을 새로 판단하지 않는다.",
            "의학적 진단이나 질병 단정을 하지 않는다.",
            "이모지와 이모티콘을 사용하지 않는다.",
            "한국어 2~4문장으로 작성한다.",
        ],
        "confirmed_facts": confirmed_facts,
    }
