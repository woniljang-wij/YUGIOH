from pathlib import Path
import sys
import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    BUSINESS_TIMEZONE,
    ONLINE_ATTENDANCE_MILESTONES,
    app as flask_app,
    _attendance_snapshot,
    _business_datetime,
    _makeup_attendance_cost,
    _monthly_attendance_reward,
    _online_attendance_milestones,
    _split_online_seconds,
)


class MakeupAttendanceMissionTests(unittest.TestCase):
    class Cursor:
        def __init__(self):
            self.executed = []
            self.result = None

        def execute(self, query, *parameters):
            normalized = " ".join(query.split())
            self.executed.append((normalized, parameters))
            if "SELECT Id FROM dbo.Users WITH (UPDLOCK, ROWLOCK)" in normalized:
                self.result = SimpleNamespace(Id=7)
            elif "SELECT COUNT(*) AS MakeupCount" in normalized:
                self.result = SimpleNamespace(MakeupCount=0)
            elif "SELECT Gems FROM dbo.Users" in normalized:
                self.result = SimpleNamespace(Gems=1000)
            elif "SELECT Gold, Gems FROM dbo.Users" in normalized:
                self.result = SimpleNamespace(Gold=100, Gems=900)
            elif "SELECT 1 FROM dbo.PlayerAttendanceClaims" in normalized:
                self.result = None
            else:
                self.result = None
            return self

        def fetchone(self):
            return self.result

    class Connection:
        def __init__(self, cursor):
            self._cursor = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def cursor(self):
            return self._cursor

        def commit(self):
            pass

        def rollback(self):
            pass

    def test_makeup_claim_updates_missions_for_the_current_business_date(self):
        business_now = datetime(
            2026, 11, 6, 12, 0, tzinfo=BUSINESS_TIMEZONE
        )
        missed_day = date(2026, 11, 5)
        current_day = business_now.date()
        cursor = self.Cursor()
        connection = self.Connection(cursor)

        with (
            flask_app.test_client() as client,
            patch("app._current_user", return_value={"id": 7}),
            patch("app._ensure_schema"),
            patch("app._connection_string", return_value="test"),
            patch("app.pyodbc.connect", return_value=connection),
            patch("app._business_datetime", return_value=business_now),
            patch("app._previous_action_response", return_value=None),
            patch("app._apply_attendance_rewards", return_value=[]),
            patch(
                "app._attendance_snapshot",
                return_value={"business_date": current_day.isoformat()},
            ),
            patch("app._store_action_response"),
            patch("app._record_mission_event") as record_mission_event,
        ):
            response = client.post(
                "/api/attendance/claim",
                json={
                    "claim_type": "makeup",
                    "day": missed_day.day,
                    "request_id": "71da96c7-4615-43ac-a3e8-0c1ab17b4e52",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["claim"]["business_date"],
            missed_day.isoformat(),
        )
        record_mission_event.assert_called_once_with(
            cursor,
            7,
            f"attendance:{current_day.isoformat()}",
            "attendance",
            1,
            current_day,
        )
        claim_insert = next(
            parameters
            for query, parameters in cursor.executed
            if query.startswith("INSERT INTO dbo.PlayerAttendanceClaims")
        )
        self.assertEqual(claim_insert[1], missed_day)


class AttendanceSnapshotTests(unittest.TestCase):
    def test_makeup_claim_reports_the_actual_vietnam_receipt_time(self):
        class SnapshotCursor:
            def __init__(self):
                self.results = iter(
                    [
                        {
                            "fetchall": [
                                SimpleNamespace(
                                    BusinessDate=date(2026, 10, 4),
                                    IsMakeup=True,
                                    MakeupGemCost=100,
                                    CreatedAtUtc=datetime(2026, 10, 31, 5, 0),
                                )
                            ]
                        },
                        {"fetchone": None},
                        {"fetchall": []},
                        {"fetchone": SimpleNamespace(Gold=100, Gems=50)},
                    ]
                )

            def execute(self, *_args):
                self.current = next(self.results)
                return self

            def fetchall(self):
                return self.current["fetchall"]

            def fetchone(self):
                return self.current["fetchone"]

        snapshot = _attendance_snapshot(
            SnapshotCursor(),
            user_id=1,
            business_now=datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(
            snapshot["monthly_claims"][0]["received_at"],
            "2026-10-31T12:00:00+07:00",
        )


class MonthlyAttendanceTests(unittest.TestCase):
    def test_rewards_repeat_in_a_fixed_four_day_cycle(self):
        rewards = [_monthly_attendance_reward(day) for day in range(1, 9)]
        self.assertEqual(
            [(reward["kind"], reward["amount"]) for reward in rewards],
            [
                ("gold", 100),
                ("gems", 50),
                ("character_card", 5),
                ("exp", 10),
                ("gold", 100),
                ("gems", 50),
                ("character_card", 5),
                ("exp", 10),
            ],
        )

    def test_makeup_cost_increases_and_is_capped(self):
        self.assertEqual(
            [_makeup_attendance_cost(count) for count in range(4)],
            [100, 150, 200, 250],
        )
        self.assertEqual(_makeup_attendance_cost(18), 1000)
        self.assertEqual(_makeup_attendance_cost(50), 1000)

    def test_reward_cycle_rejects_non_positive_and_boolean_days(self):
        for day in (0, -1, True):
            with self.subTest(day=day), self.assertRaises(ValueError):
                _monthly_attendance_reward(day)


class OnlineAttendanceTests(unittest.TestCase):
    def test_vietnam_business_date_uses_utc_plus_seven(self):
        value = datetime(2026, 10, 31, 17, 0, tzinfo=timezone.utc)
        self.assertEqual(_business_datetime(value).isoformat(), "2026-11-01T00:00:00+07:00")

    def test_naive_database_timestamps_are_treated_as_utc(self):
        value = datetime(2026, 10, 31, 17, 0)
        self.assertEqual(_business_datetime(value).isoformat(), "2026-11-01T00:00:00+07:00")

    def test_online_seconds_are_split_at_vietnam_midnight(self):
        start = datetime(2026, 10, 31, 16, 59, 30, tzinfo=timezone.utc)
        end = datetime(2026, 10, 31, 17, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(
            _split_online_seconds(start, end),
            {
                _business_datetime(start).date(): 30,
                _business_datetime(end).date(): 30,
            },
        )

    def test_online_milestones_match_the_required_rewards_and_claim_state(self):
        milestones = _online_attendance_milestones({"20", "60"})
        self.assertEqual(
            [milestone["minutes"] for milestone in milestones],
            [5, 10, 20, 30, 60],
        )
        self.assertEqual(
            [milestone["claimed"] for milestone in milestones],
            [False, False, True, False, True],
        )
        self.assertEqual(
            [(reward["kind"], reward["amount"]) for reward in milestones[-1]["rewards"]],
            [
                ("gold", 1000),
                ("gems", 500),
                ("character_card", 10),
                ("exp", 10),
            ],
        )
        self.assertEqual(
            [milestone["minutes"] for milestone in ONLINE_ATTENDANCE_MILESTONES],
            [5, 10, 20, 30, 60],
        )


if __name__ == "__main__":
    unittest.main()
