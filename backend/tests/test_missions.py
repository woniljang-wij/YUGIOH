from pathlib import Path
import sys
import unittest
from datetime import date

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import (
    ACTIVITY_CHESTS,
    MISSION_REWARDS,
    QUEST_REWARD_DEFINITIONS,
    _mission_period_start,
    _mission_period_end,
    _mission_reward_payload,
    _record_mission_event,
    _week_start,
)


class MissionPeriodTests(unittest.TestCase):
    def test_week_starts_on_monday_and_changes_at_the_week_boundary(self):
        self.assertEqual(_week_start(date(2026, 11, 6)), date(2026, 11, 2))
        self.assertEqual(_week_start(date(2026, 11, 8)), date(2026, 11, 2))
        self.assertEqual(_week_start(date(2026, 11, 9)), date(2026, 11, 9))

    def test_daily_and_weekly_missions_use_their_own_periods(self):
        current_date = date(2026, 11, 6)
        self.assertEqual(
            _mission_period_start("daily_attendance", current_date),
            current_date,
        )
        self.assertEqual(
            _mission_period_start("weekly_attendance", current_date),
            date(2026, 11, 2),
        )
        self.assertEqual(
            _mission_period_end("daily_attendance", current_date),
            current_date,
        )
        self.assertEqual(
            _mission_period_end("weekly_attendance", current_date),
            date(2026, 11, 8),
        )

    def test_mission_and_chest_rewards_match_the_feature_specification(self):
        self.assertEqual(
            [MISSION_REWARDS[key]["target"] for key in MISSION_REWARDS],
            [1, 1, 1, 10, 5],
        )
        self.assertEqual(
            [chest["threshold"] for chest in ACTIVITY_CHESTS],
            [50, 100, 200, 300, 500],
        )
        self.assertEqual(
            [(kind, amount) for kind, amount in MISSION_REWARDS["weekly_attendance"]["rewards"]],
            [("gems", 500), ("activity_points", 60)],
        )
        self.assertEqual(
            [(kind, amount) for kind, amount in ACTIVITY_CHESTS[3]["rewards"]],
            [("character_card", 5), ("exp", 5)],
        )

    def test_reward_payload_uses_existing_item_artwork(self):
        rewards = _mission_reward_payload(
            MISSION_REWARDS["daily_pack"]["rewards"]
        )
        self.assertEqual(
            [(reward["kind"], reward["amount"]) for reward in rewards],
            [("character_card", 5), ("activity_points", 30)],
        )
        self.assertEqual(
            rewards[0]["image"],
            QUEST_REWARD_DEFINITIONS["character_card"]["image"],
        )
        self.assertEqual(
            rewards[1]["image"],
            "assets/images/progression/activity-points.png",
        )


class MissionEventTests(unittest.TestCase):
    class Cursor:
        def __init__(self):
            self.events = set()
            self.progress = {}
            self.rowcount = -1
            self.result = None

        def execute(self, query, *params):
            normalized = " ".join(query.split())
            self.result = None
            self.rowcount = -1
            if "SELECT 1 FROM dbo.PlayerMissionEvents" in normalized:
                self.result = (True,) if (params[0], params[1]) in self.events else None
            elif "INSERT INTO dbo.PlayerMissionEvents" in normalized:
                self.events.add((params[0], params[1]))
            elif "UPDATE dbo.PlayerMissionProgress" in normalized:
                amount, target, _capped, _same_amount, user_id, mission_id, period_start = params
                key = (user_id, mission_id, period_start)
                if key in self.progress:
                    self.progress[key] = min(target, self.progress[key] + amount)
                    self.rowcount = 1
                else:
                    self.rowcount = 0
            elif "INSERT INTO dbo.PlayerMissionProgress" in normalized:
                user_id, mission_id, period_start, _period_end, progress = params
                self.progress[(user_id, mission_id, period_start)] = progress
            else:
                raise AssertionError(f"Unexpected query: {normalized}")
            return self

        def fetchone(self):
            return self.result

    def test_attendance_increments_daily_and_weekly_progress_once(self):
        cursor = self.Cursor()
        day = date(2026, 11, 6)

        self.assertTrue(
            _record_mission_event(cursor, 7, "attendance:2026-11-06", "attendance", 1, day)
        )
        self.assertFalse(
            _record_mission_event(cursor, 7, "attendance:2026-11-06", "attendance", 1, day)
        )
        self.assertEqual(
            cursor.progress[(7, "daily_attendance", day)],
            1,
        )
        self.assertEqual(
            cursor.progress[(7, "weekly_attendance", date(2026, 11, 2))],
            1,
        )

    def test_bulk_pack_purchase_advances_both_pack_missions(self):
        cursor = self.Cursor()
        day = date(2026, 11, 6)

        _record_mission_event(cursor, 7, "purchase:request-1", "pack_purchase", 10, day)
        self.assertEqual(cursor.progress[(7, "daily_pack", day)], 1)
        self.assertEqual(cursor.progress[(7, "daily_packs_10", day)], 10)


if __name__ == "__main__":
    unittest.main()
