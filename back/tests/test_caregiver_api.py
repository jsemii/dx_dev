"""Offline tests for additional-caregiver API behavior and transactions."""

from datetime import datetime
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import subprocess
import threading
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from back.api.appliance_api import (
    DatabaseUnavailable,
    DuplicateCaregiverPhone,
    PsqlRepository,
    ResidentNotFound,
    create_handler,
    parse_caregiver_payload,
    parse_home_id_query,
)


SEOUL = ZoneInfo("Asia/Seoul")
GUARDIAN = {
    "id": "caregiver_share_11111111111141118111111111111111",
    "name": "곽호철",
    "relationship": "아들",
    "phone": "010-4827-1936",
    "role": "ADDITIONAL",
}


class ValidationTests(unittest.TestCase):
    def test_query_accepts_exactly_one_home(self):
        self.assertEqual(parse_home_id_query("home_id=home_23"), "home_23")
        for query in ("", "home_id=", "home_id=a&home_id=b", "home_id=a&date=2026-09-30"):
            with self.subTest(query=query), self.assertRaises(ValueError):
                parse_home_id_query(query)

    def test_registration_trims_fields_and_canonicalizes_phone(self):
        self.assertEqual(parse_caregiver_payload({
            "home_id": " home_23 ",
            "name": "  곽호철  ",
            "relationship": "  큰   아들 ",
            "phone": " 010 4827 1936 ",
        }), {
            "home_id": "home_23", "name": "곽호철", "relationship": "큰 아들",
            "phone": "010-4827-1936",
        })

    def test_registration_rejects_missing_extra_and_invalid_fields(self):
        valid = {
            "home_id": "home_23", "name": "곽호철", "relationship": "아들",
            "phone": "010-4827-1936",
        }
        invalid = [
            {**valid, "name": " "},
            {**valid, "relationship": " "},
            {**valid, "phone": "02-123-4567"},
            {**valid, "phone": ["010-4827-1936"]},
            {**valid, "unexpected": "value"},
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse_caregiver_payload(payload)


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = PsqlRepository({
            "PGHOST": "example.invalid", "PGDATABASE": "db",
            "PGUSER": "user", "PGPASSWORD": "test-secret",
        })
        self.repository.psql = "/usr/bin/psql"

    def test_list_is_resident_scoped_and_additional_only(self):
        with patch.object(
            self.repository, "_query", return_value=[json.dumps(GUARDIAN, ensure_ascii=False)]
        ) as query:
            self.assertEqual(self.repository.list_caregivers("home_23"), [GUARDIAN])
        sql, params = query.call_args.args
        self.assertEqual(params, {"home_id": "home_23"})
        self.assertIn("cm.resident_thinq_id = :'home_id'", sql)
        self.assertIn("cm.caregiver_role = 'ADDITIONAL'", sql)
        self.assertIn("JOIN public.caregiver", sql)

    def test_primary_rows_cannot_pass_repository_response_validation(self):
        primary = {**GUARDIAN, "role": "PRIMARY"}
        with patch.object(self.repository, "_query", return_value=[json.dumps(primary)]):
            with self.assertRaises(DatabaseUnavailable):
                self.repository.list_caregivers("home_23")

    def test_registration_uses_one_transaction_and_never_writes_report_share(self):
        document = {"status": "inserted", "guardian": GUARDIAN}
        with patch("back.api.appliance_api.uuid.uuid4") as make_uuid, patch.object(
            self.repository, "_write_query", return_value=[json.dumps(document, ensure_ascii=False)]
        ) as write:
            make_uuid.return_value.hex = "11111111111141118111111111111111"
            result = self.repository.register_caregiver({
                "home_id": "home_23", "name": "곽호철", "relationship": "아들",
                "phone": "010-4827-1936",
            })
        self.assertEqual(result, GUARDIAN)
        sql, params = write.call_args.args
        self.assertLess(sql.index("BEGIN;"), sql.index("INSERT INTO public.caregiver"))
        self.assertLess(sql.index("INSERT INTO public.caregiver"), sql.index("INSERT INTO public.care_member"))
        self.assertLess(sql.index("INSERT INTO public.care_member"), sql.index("COMMIT;"))
        self.assertNotIn("report_share", sql)
        self.assertEqual(params["home_id"], "home_23")
        self.assertEqual(params["caregiver_id"], GUARDIAN["id"])

    def test_registration_maps_missing_resident_and_duplicate_phone(self):
        for status, error_type in (
            ("resident_not_found", ResidentNotFound),
            ("duplicate_phone", DuplicateCaregiverPhone),
        ):
            with self.subTest(status=status), patch.object(
                self.repository, "_write_query",
                return_value=[json.dumps({"status": status, "guardian": None})],
            ), self.assertRaises(error_type):
                self.repository.register_caregiver({
                    "home_id": "home_23", "name": "곽호철", "relationship": "아들",
                    "phone": "010-4827-1936",
                })

    def test_psql_failure_in_transaction_is_reported_without_database_details(self):
        with patch("back.api.appliance_api.subprocess.run") as run:
            run.side_effect = subprocess.CalledProcessError(1, ["psql"], stderr="private")
            with self.assertRaisesRegex(DatabaseUnavailable, "Database query failed"):
                self.repository.register_caregiver({
                    "home_id": "home_23", "name": "곽호철", "relationship": "아들",
                    "phone": "010-4827-1936",
                })
        self.assertIn("BEGIN;", run.call_args.kwargs["input"])
        self.assertIn("COMMIT;", run.call_args.kwargs["input"])
        self.assertNotIn("default_transaction_read_only", run.call_args.kwargs["env"]["PGOPTIONS"])
        self.assertIn("ON_ERROR_STOP=1", run.call_args.args[0])


class HttpTests(unittest.TestCase):
    def request(self, repository, method, path, body=None, headers=None):
        handler = create_handler(
            repository,
            {"http://127.0.0.1:5175"},
            now_provider=lambda: datetime(2026, 9, 30, 12, tzinfo=SEOUL),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
            request_headers = dict(headers or {})
            if data is not None:
                request_headers.setdefault("Content-Type", "application/json")
                request_headers["Content-Length"] = str(len(data))
            connection.request(method, path, body=data, headers=request_headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_get_and_post_contracts(self):
        class Repository:
            def list_caregivers(self, home_id):
                self.listed_home = home_id
                return [GUARDIAN]

            def register_caregiver(self, values):
                self.registered = values
                return GUARDIAN

        repository = Repository()
        status, body = self.request(repository, "GET", "/api/caregivers?home_id=home_23")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"guardians": [GUARDIAN]})
        self.assertEqual(repository.listed_home, "home_23")

        status, body = self.request(repository, "POST", "/api/caregivers", {
            "home_id": "home_23", "name": " 곽호철 ", "relationship": " 아들 ",
            "phone": "01048271936",
        })
        self.assertEqual(status, 201)
        self.assertEqual(body, {"guardian": GUARDIAN})
        self.assertEqual(repository.registered["phone"], "010-4827-1936")

    def test_invalid_duplicate_and_missing_resident_are_safe(self):
        class Repository:
            failure = None

            def register_caregiver(self, _values):
                raise self.failure

        repository = Repository()
        status, body = self.request(repository, "POST", "/api/caregivers", {
            "home_id": "home_23", "name": "곽호철", "relationship": "아들",
            "phone": "invalid",
        })
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_request"))

        repository.failure = DuplicateCaregiverPhone()
        status, body = self.request(repository, "POST", "/api/caregivers", {
            "home_id": "home_23", "name": "곽호철", "relationship": "아들",
            "phone": "010-4827-1936",
        })
        self.assertEqual((status, body["error"]["code"]), (409, "duplicate_phone"))

        repository.failure = ResidentNotFound()
        status, body = self.request(repository, "POST", "/api/caregivers", {
            "home_id": "missing", "name": "곽호철", "relationship": "아들",
            "phone": "010-4827-1936",
        })
        self.assertEqual((status, body["error"]["code"]), (404, "resident_not_found"))


if __name__ == "__main__":
    unittest.main()
