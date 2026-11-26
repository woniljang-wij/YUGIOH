from pathlib import Path
import sys
import unittest
import uuid
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from duel.duel_effects import (
    build_effect_registry,
    can_change_battle_position,
    can_declare_attack,
    check_win_by_exodia,
    complete_pending_card_selection,
    complete_pending_discard,
    current_stats,
    is_battle_protected,
    resolve_attack_trap,
    resolve_end_phase_effects,
    resolve_monster_summon_effects,
    resolve_standby_effects,
)
from duel.duel_actions import DuelActionEngine
from duel.duel_engine import (
    DuelEffectEngine,
    DuelRuleError,
    EffectDefinition,
    EffectRegistry,
    add_stat_modifier,
    destroy_card,
    expire_effects,
    find_card,
    move_card,
)


EXODIA_IDS = (
    "m-exodia-the-forbidden-one",
    "m-right-arm-of-the-forbidden-one",
    "m-left-arm-of-the-forbidden-one",
    "m-right-leg-of-the-forbidden-one",
    "m-left-leg-of-the-forbidden-one",
)


def new_state():
    players = {}
    for player in ("player", "ai"):
        players[player] = {
            "lp": 8000,
            "deck": [],
            "extra_deck": [],
            "hand": [],
            "monster_zone": [None] * 5,
            "spell_trap_zone": [None] * 5,
            "graveyard": [],
            "banished": [],
        }
    return {
        "match_id": "test-match",
        "turn": 1,
        "turn_player": "player",
        "first_player": "player",
        "phase": "main1",
        "players": players,
        "chain": {
            "status": "closed",
            "links": [],
            "priority_player": None,
            "consecutive_passes": 0,
        },
        "stat_modifiers": [],
        "effect_protection": {},
        "card_effect_protection": {},
        "normal_summon_used": {"player": False, "ai": False},
        "attacked": {"player": [], "ai": []},
        "pending_decision": None,
        "over": False,
        "winner": None,
    }


def new_card(card_id, category="monster", owner="player", **fields):
    base_atk = fields.pop("atk", 1000)
    base_def = fields.pop("def", 800)
    return {
        "instance_id": str(uuid.uuid4()),
        "card_id": card_id,
        "name": card_id,
        "category": category,
        "owner": owner,
        "controller": owner,
        "base_atk": base_atk,
        "base_def": base_def,
        "face_down": False,
        "position": "attack",
        "level": fields.pop("level", 4),
        "race": fields.pop("race", "Warrior"),
        "set_turn": 0,
        **fields,
    }


def put(state, player, zone, card, index=None):
    target = state["players"][player][zone]
    if index is None and zone in {"monster_zone", "spell_trap_zone"}:
        index = next(i for i, current in enumerate(target) if current is None)
    if zone in {"monster_zone", "spell_trap_zone"}:
        target[index] = card
    else:
        target.append(card)
    return card


def activate_and_resolve(engine, state, player, source, effect_id="activate", targets=(), payload=None):
    state = engine.activate(
        state,
        player=player,
        source_instance_id=source["instance_id"],
        effect_id=effect_id,
        target_instance_ids=targets,
        payload=payload,
    )
    while state["chain"]["status"] == "open":
        state = engine.pass_priority(
            state,
            player=state["chain"]["priority_player"],
        )
    return state


def resolve_action_chain(actions, state):
    while state["chain"]["status"] == "open":
        state = actions.apply(
            state,
            player=state["chain"]["priority_player"],
            action={"type": "pass_chain"},
        )
    return state


class DuelEffectTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry(random_source=lambda: 0.5))

    def register_test_chain_effect(self):
        self.engine.registry.register(
            EffectDefinition(
                card_id="test-chain-effect",
                effect_id="activate",
                effect_type="quick",
                speed=2,
                resolve=lambda state, context: None,
                source_zones=frozenset({"hand"}),
                can_chain=True,
            )
        )

    def test_pot_of_greed_draws_two_and_solemn_wishes_triggers(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        for card_id in ("one", "two"):
            put(state, "player", "deck", new_card(card_id, owner="player"))
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-solemn-wishes", "trap", face_down=False),
        )

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertEqual(len(state["players"]["player"]["hand"]), 2)
        self.assertEqual(state["players"]["player"]["lp"], 8500)

    def test_spell_reproduction_pays_spell_cost_and_recovers_only_a_spell(self):
        state = new_state()
        source = put(
            state,
            "player",
            "hand",
            new_card("s-spell-reproduction", "spell"),
        )
        cost_one = put(state, "player", "hand", new_card("cost-spell-one", "spell"))
        cost_two = put(state, "player", "hand", new_card("cost-spell-two", "spell"))
        put(state, "player", "hand", new_card("cost-monster", "monster"))
        eligible_target = put(
            state,
            "player",
            "graveyard",
            new_card("previous-grave-spell", "spell"),
        )
        invalid_target = put(
            state,
            "player",
            "graveyard",
            new_card("grave-monster", "monster"),
        )
        actions = DuelActionEngine(self.engine)

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "activate_effect",
                    "source_instance_id": source["instance_id"],
                    "payload": {"cost_paid": True},
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "begin_spell_recovery",
                "source_instance_id": source["instance_id"],
            },
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_discard",
                    "instance_ids": [cost_one["instance_id"], invalid_target["instance_id"]],
                },
            )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_discard",
                "instance_ids": [cost_one["instance_id"], cost_two["instance_id"]],
            },
        )

        state = resolve_action_chain(actions, state)
        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(state["pending_decision"]["type"], "select_graveyard_card")
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [invalid_target["instance_id"]],
                },
            )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [cost_one["instance_id"]],
                },
            )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [eligible_target["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, source["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, eligible_target["instance_id"])[1], "hand")
        self.assertEqual(find_card(state, cost_one["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, cost_two["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])

    def test_magical_stone_excavation_discards_any_two_and_recovers_from_own_grave(self):
        state = new_state()
        source = put(
            state,
            "player",
            "hand",
            new_card("s-magical-stone-excavation", "spell"),
        )
        cost_monster = put(state, "player", "hand", new_card("cost-monster", "monster"))
        cost_trap = put(state, "player", "hand", new_card("cost-trap", "trap"))
        target = put(
            state,
            "player",
            "graveyard",
            new_card("grave-monster", "monster"),
        )
        opponent_target = put(
            state,
            "ai",
            "graveyard",
            new_card("opponent-grave-card", "spell", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "begin_spell_recovery",
                "source_instance_id": source["instance_id"],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_discard",
                "instance_ids": [cost_monster["instance_id"], cost_trap["instance_id"]],
            },
        )

        state = resolve_action_chain(actions, state)
        self.assertEqual(state["chain"]["status"], "closed")
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [opponent_target["instance_id"]],
                },
            )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [cost_monster["instance_id"]],
                },
            )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [target["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, source["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, target["instance_id"])[1], "hand")
        self.assertEqual(find_card(state, cost_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, cost_trap["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])

    def test_spell_recovery_requires_a_preexisting_eligible_grave_target(self):
        cases = (
            ("s-spell-reproduction", ("spell", "spell"), ("monster",)),
            ("s-magical-stone-excavation", ("monster", "trap"), ()),
        )
        for card_id, hand_categories, grave_categories in cases:
            with self.subTest(card_id=card_id):
                state = new_state()
                source = put(
                    state,
                    "player",
                    "hand",
                    new_card(card_id, "spell"),
                )
                for index, category in enumerate(hand_categories):
                    put(
                        state,
                        "player",
                        "hand",
                        new_card(f"cost-{index}", category),
                    )
                for index, category in enumerate(grave_categories):
                    put(
                        state,
                        "player",
                        "graveyard",
                        new_card(f"old-grave-{index}", category),
                    )

                with self.assertRaises(DuelRuleError):
                    DuelActionEngine(self.engine).apply(
                        state,
                        player="player",
                        action={
                            "type": "begin_spell_recovery",
                            "source_instance_id": source["instance_id"],
                        },
                    )

    def test_time_wizard_picture_side_destroys_opponent_monsters_once_per_turn(self):
        engine = DuelEffectEngine(
            build_effect_registry(random_source=lambda: 0.1)
        )
        state = new_state()
        wizard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-time-wizard", atk=500),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )

        state = activate_and_resolve(
            engine,
            state,
            "player",
            wizard,
        )

        self.assertEqual(find_card(state, opponent_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, wizard["instance_id"])[1], "monster_zone")
        with self.assertRaises(DuelRuleError):
            engine.activate(
                state,
                player="player",
                source_instance_id=wizard["instance_id"],
                effect_id="activate",
            )

    def test_time_wizard_other_side_destroys_own_monsters_and_damages_for_face_up_atk(self):
        engine = DuelEffectEngine(
            build_effect_registry(random_source=lambda: 0.9)
        )
        state = new_state()
        wizard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-time-wizard", atk=500),
        )
        face_up_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("face-up-monster", atk=1500),
        )
        face_down_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("face-down-monster", atk=3000, face_down=True),
        )

        state = activate_and_resolve(
            engine,
            state,
            "player",
            wizard,
        )

        self.assertEqual(find_card(state, wizard["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, face_up_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, face_down_monster["instance_id"])[1], "graveyard")
        self.assertEqual(state["players"]["player"]["lp"], 7000)

    def test_kaiser_vorse_raider_can_special_summon_from_hand_when_board_is_clear(self):
        state = new_state()
        raider = put(
            state,
            "player",
            "hand",
            new_card("m-kaiser-vorse-raider"),
        )
        state["normal_summon_used"] = {"player": False, "ai": False}
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_kaiser_vorse",
                "source_instance_id": raider["instance_id"],
            },
        )

        summoned = find_card(state, raider["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertEqual(summoned[3]["position"], "attack")
        self.assertEqual(state["chain"]["status"], "closed")
        self.assertFalse(state["normal_summon_used"]["player"])

        blocked_state = new_state()
        raider = put(
            blocked_state,
            "player",
            "hand",
            new_card("m-kaiser-vorse-raider"),
        )
        put(
            blocked_state,
            "player",
            "monster_zone",
            new_card("already-controlled-monster"),
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                blocked_state,
                player="player",
                action={
                    "type": "special_summon_kaiser_vorse",
                    "source_instance_id": raider["instance_id"],
                },
            )

    def test_lava_golem_tributes_two_opponent_monsters_and_blocks_normal_summon(self):
        state = new_state()
        state["phase"] = "main1"
        state["normal_summon_used"] = {"player": False, "ai": False}
        golem = put(
            state,
            "player",
            "hand",
            new_card("m-lava-golem", atk=3000),
        )
        tributes = [
            put(
                state,
                "ai",
                "monster_zone",
                new_card(f"ai-monster-{index}", owner="ai"),
            )
            for index in range(2)
        ]
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_lava_golem",
                "source_instance_id": golem["instance_id"],
                "tribute_instance_ids": [
                    tribute["instance_id"] for tribute in tributes
                ],
            },
        )

        summoned = find_card(state, golem["instance_id"])
        self.assertEqual(summoned[:2], ("ai", "monster_zone"))
        self.assertEqual(summoned[3]["owner"], "player")
        self.assertEqual(summoned[3]["controller"], "ai")
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertTrue(state["normal_summon_used"]["player"])
        for tribute in tributes:
            self.assertEqual(find_card(state, tribute["instance_id"])[1], "graveyard")

        normal_monster = put(
            state,
            "player",
            "hand",
            new_card("normal-monster"),
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "summon",
                    "instance_id": normal_monster["instance_id"],
                    "zone_index": 0,
                },
            )

    def test_lava_golem_requires_two_opponent_monsters(self):
        state = new_state()
        state["phase"] = "main1"
        golem = put(
            state,
            "player",
            "hand",
            new_card("m-lava-golem"),
        )
        tribute = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-monster", owner="ai"),
        )

        with self.assertRaises(DuelRuleError):
            DuelActionEngine(self.engine).apply(
                state,
                player="player",
                action={
                    "type": "special_summon_lava_golem",
                    "source_instance_id": golem["instance_id"],
                    "tribute_instance_ids": [tribute["instance_id"]],
                },
            )

        self.assertEqual(find_card(state, tribute["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, golem["instance_id"])[1], "hand")

    def test_valkyrion_uses_exact_materials_then_can_split_and_be_revived(self):
        state = new_state()
        valkyrion = put(
            state,
            "player",
            "hand",
            new_card("m-valkyrion-the-magna-warrior", level=8),
        )
        alpha = put(state, "player", "hand", new_card("m-alpha-the-magnet-warrior"))
        beta = put(
            state,
            "player",
            "monster_zone",
            new_card("m-beta-the-magnet-warrior"),
        )
        gamma = put(state, "player", "hand", new_card("m-gamma-the-magnet-warrior"))
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_valkyrion",
                "source_instance_id": valkyrion["instance_id"],
                "tribute_instance_ids": [
                    alpha["instance_id"],
                    beta["instance_id"],
                    gamma["instance_id"],
                ],
            },
        )

        summoned = find_card(state, valkyrion["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertTrue(summoned[3]["properly_summoned"])
        self.assertFalse(state["normal_summon_used"]["player"])
        for material in (alpha, beta, gamma):
            self.assertEqual(find_card(state, material["instance_id"])[1], "graveyard")

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "split_valkyrion",
                "source_instance_id": valkyrion["instance_id"],
                "material_instance_ids": [
                    alpha["instance_id"],
                    beta["instance_id"],
                    gamma["instance_id"],
                ],
            },
        )

        self.assertEqual(find_card(state, valkyrion["instance_id"])[1], "graveyard")
        for material in (alpha, beta, gamma):
            summoned_material = find_card(state, material["instance_id"])
            self.assertEqual(summoned_material[1], "monster_zone")
            self.assertEqual(summoned_material[3]["summon_method"], "special")

        monster_reborn = put(
            state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            monster_reborn,
            targets=(valkyrion["instance_id"],),
        )
        self.assertEqual(find_card(state, valkyrion["instance_id"])[1], "monster_zone")

    def test_valkyrion_rejects_normal_summon_set_hidden_materials_and_unearned_revival(self):
        actions = DuelActionEngine(self.engine)
        state = new_state()
        valkyrion = put(
            state,
            "player",
            "hand",
            new_card("m-valkyrion-the-magna-warrior", level=8),
        )
        for action in (
            {
                "type": "summon",
                "instance_id": valkyrion["instance_id"],
                "zone_index": 0,
            },
            {
                "type": "set_card",
                "instance_id": valkyrion["instance_id"],
                "zone_index": 0,
            },
        ):
            with self.subTest(action=action["type"]), self.assertRaises(DuelRuleError):
                actions.apply(state, player="player", action=action)

        alpha = put(state, "player", "hand", new_card("m-alpha-the-magnet-warrior"))
        beta = put(
            state,
            "player",
            "monster_zone",
            new_card("m-beta-the-magnet-warrior", face_down=True),
        )
        gamma = put(state, "player", "hand", new_card("m-gamma-the-magnet-warrior"))
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "special_summon_valkyrion",
                    "source_instance_id": valkyrion["instance_id"],
                    "tribute_instance_ids": [
                        alpha["instance_id"],
                        beta["instance_id"],
                        gamma["instance_id"],
                    ],
                },
            )
        self.assertEqual(find_card(state, valkyrion["instance_id"])[1], "hand")

        grave_state = new_state()
        un_summoned = put(
            grave_state,
            "player",
            "graveyard",
            new_card("m-valkyrion-the-magna-warrior", level=8),
        )
        monster_reborn = put(
            grave_state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                grave_state,
                player="player",
                source_instance_id=monster_reborn["instance_id"],
                effect_id="activate",
                target_instance_ids=(un_summoned["instance_id"],),
            )

    def test_valkyrion_cannot_split_without_three_zones_after_tributing_itself(self):
        state = new_state()
        valkyrion = put(
            state,
            "player",
            "monster_zone",
            new_card("m-valkyrion-the-magna-warrior", level=8),
        )
        materials = [
            put(state, "player", "graveyard", new_card(card_id))
            for card_id in (
                "m-alpha-the-magnet-warrior",
                "m-beta-the-magnet-warrior",
                "m-gamma-the-magnet-warrior",
            )
        ]
        for index in range(4):
            put(
                state,
                "player",
                "monster_zone",
                new_card(f"occupied-{index}"),
            )

        with self.assertRaises(DuelRuleError):
            DuelActionEngine(self.engine).apply(
                state,
                player="player",
                action={
                    "type": "split_valkyrion",
                    "source_instance_id": valkyrion["instance_id"],
                    "material_instance_ids": [
                        material["instance_id"] for material in materials
                    ],
                },
            )

        self.assertEqual(find_card(state, valkyrion["instance_id"])[1], "monster_zone")
        self.assertTrue(
            all(find_card(state, material["instance_id"])[1] == "graveyard" for material in materials)
        )

    def test_blue_eyes_alternative_special_summon_requires_blue_eyes_and_is_once_per_turn(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        alternative = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )
        blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        actions = DuelActionEngine(self.engine)
        summon_action = {
            "type": "special_summon_blue_eyes_alternative",
            "source_instance_id": alternative["instance_id"],
        }

        result = actions.apply(state, player="player", action=summon_action)

        summoned = find_card(result, alternative["instance_id"])
        self.assertEqual(summoned[:2], ("player", "monster_zone"))
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertEqual(summoned[3]["name_alias"], "Rồng Trắng Mắt Xanh")
        self.assertEqual(find_card(result, blue_eyes["instance_id"])[1], "hand")
        self.assertFalse(result["normal_summon_used"]["player"])

        another_alternative = put(
            result,
            "player",
            "hand",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                result,
                player="player",
                action={
                    **summon_action,
                    "source_instance_id": another_alternative["instance_id"],
                },
            )
        move_card(
            result,
            alternative["instance_id"],
            "player",
            "graveyard",
        )
        graveyard_card = find_card(result, alternative["instance_id"])[3]
        self.assertEqual(graveyard_card["name_alias"], "Rồng Trắng Mắt Xanh")
        move_card(result, alternative["instance_id"], "player", "hand")
        self.assertNotIn("name_alias", find_card(result, alternative["instance_id"])[3])

    def test_blue_eyes_alternative_cannot_summon_without_blue_eyes_in_hand(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        alternative = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )
        actions = DuelActionEngine(self.engine)
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "special_summon_blue_eyes_alternative",
                    "source_instance_id": alternative["instance_id"],
                },
            )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "summon",
                    "instance_id": alternative["instance_id"],
                    "zone_index": 0,
                },
            )
        self.assertEqual(find_card(state, alternative["instance_id"])[1], "hand")

    def test_blue_eyes_alternative_destroys_once_and_enables_burst_stream(self):
        state = new_state()
        alternative = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )
        first_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("first-target", owner="ai", face_down=True),
        )
        second_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("second-target", owner="ai"),
            index=1,
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            alternative,
            targets=(first_target["instance_id"],),
        )

        self.assertEqual(find_card(state, first_target["instance_id"])[1], "graveyard")
        self.assertFalse(can_declare_attack(state, "player", alternative["instance_id"]))
        with self.assertRaises(DuelRuleError):
            activate_and_resolve(
                self.engine,
                state,
                "player",
                alternative,
                targets=(second_target["instance_id"],),
            )

        burst_stream = put(
            state,
            "player",
            "hand",
            new_card("s-burst-stream-of-destruction", "spell"),
        )
        state = activate_and_resolve(self.engine, state, "player", burst_stream)

        self.assertEqual(find_card(state, second_target["instance_id"])[1], "graveyard")
        self.assertFalse(can_declare_attack(state, "player", alternative["instance_id"]))

    def test_blue_eyes_solid_dragon_negates_a_face_up_opponent_monster_on_summon(self):
        state = new_state()
        solid = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-solid-dragon"),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-time-wizard", owner="ai"),
        )
        facedown = put(
            state,
            "ai",
            "monster_zone",
            new_card("face-down-monster", owner="ai", face_down=True),
            index=1,
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": solid["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )

        self.assertEqual(
            state["pending_decision"]["effect_card_id"],
            "m-blue-eyes-solid-dragon",
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [facedown["instance_id"]],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [target["instance_id"]],
            },
        )

        self.assertTrue(find_card(state, target["instance_id"])[3]["monster_effects_negated"])
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="ai",
                source_instance_id=target["instance_id"],
                effect_id="activate",
            )
        move_card(state, target["instance_id"], "ai", "graveyard")
        self.assertNotIn(
            "monster_effects_negated",
            find_card(state, target["instance_id"])[3],
        )

    def test_blue_eyes_solid_dragon_summon_effect_skips_when_no_face_up_target(self):
        state = new_state()
        solid = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-solid-dragon"),
        )
        put(
            state,
            "ai",
            "monster_zone",
            new_card("face-down-monster", owner="ai", face_down=True),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": solid["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertNotIn(
            "player:m-blue-eyes-solid-dragon:summon-negate",
            state.get("effect_uses", {}),
        )

    def test_blue_eyes_solid_dragon_negation_disables_jinzo_continuous_effect(self):
        state = new_state()
        solid = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-solid-dragon"),
        )
        jinzo = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-jinzo", owner="ai"),
        )
        graveyard_monster = put(
            state,
            "player",
            "graveyard",
            new_card("revival-target"),
        )
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-call-of-the-haunted",
                "trap",
                face_down=True,
                set_turn=0,
            ),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": solid["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [jinzo["instance_id"]],
            },
        )

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=trap["instance_id"],
            effect_id="activate",
            target_instance_ids=(graveyard_monster["instance_id"],),
        )

        self.assertEqual(state["chain"]["status"], "open")

    def test_blue_eyes_solid_dragon_quick_effect_responds_on_either_turn(self):
        self.register_test_chain_effect()
        for turn_player in ("player", "ai"):
            with self.subTest(turn_player=turn_player):
                state = new_state()
                state["turn_player"] = turn_player
                solid = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card("m-blue-eyes-solid-dragon"),
                )
                blue_eyes = put(
                    state,
                    "player",
                    "deck",
                    new_card("m-blue-eyes-white-dragon"),
                )
                for index in range(1, 5):
                    put(
                        state,
                        "player",
                        "monster_zone",
                        new_card(f"occupied-zone-{index}"),
                        index=index,
                    )
                actions = DuelActionEngine(self.engine)
                with self.assertRaises(DuelRuleError):
                    actions.apply(
                        state,
                        player="player",
                        action={
                            "type": "activate_effect",
                            "source_instance_id": solid["instance_id"],
                        },
                    )

                if turn_player == "player":
                    starter_player, responder_player = "player", "ai"
                else:
                    starter_player, responder_player = "ai", None
                starter = put(
                    state,
                    starter_player,
                    "hand",
                    new_card(
                        "test-chain-effect",
                        "spell",
                        owner=starter_player,
                    ),
                )
                state = self.engine.activate(
                    state,
                    player=starter_player,
                    source_instance_id=starter["instance_id"],
                    effect_id="activate",
                )
                if responder_player:
                    responder = put(
                        state,
                        responder_player,
                        "hand",
                        new_card(
                            "test-chain-effect",
                            "monster",
                            owner=responder_player,
                        ),
                    )
                    state = self.engine.activate(
                        state,
                        player=responder_player,
                        source_instance_id=responder["instance_id"],
                        effect_id="activate",
                    )

                state = actions.apply(
                    state,
                    player="player",
                    action={
                        "type": "activate_effect",
                        "source_instance_id": solid["instance_id"],
                    },
                )
                self.assertEqual(
                    find_card(state, solid["instance_id"])[1],
                    "deck",
                )
                self.assertEqual(state["chain"]["status"], "open")
                state = resolve_action_chain(actions, state)

                summoned = find_card(state, blue_eyes["instance_id"])
                self.assertEqual(summoned[:2], ("player", "monster_zone"))
                self.assertEqual(summoned[3]["summon_method"], "special")

    def test_ai_uses_solid_dragon_response_when_it_improves_its_board(self):
        self.register_test_chain_effect()
        state = new_state()
        solid = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-blue-eyes-solid-dragon",
                owner="ai",
                base_atk=2500,
                base_def=2000,
            ),
        )
        blue_eyes = put(
            state,
            "ai",
            "deck",
            new_card(
                "m-blue-eyes-white-dragon",
                owner="ai",
                base_atk=3000,
                base_def=2500,
            ),
        )
        starter = put(
            state,
            "player",
            "hand",
            new_card("test-chain-effect", "spell"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": starter["instance_id"],
            },
        )

        self.assertEqual(find_card(state, solid["instance_id"])[1], "deck")
        state = resolve_action_chain(DuelActionEngine(self.engine), state)
        summoned = find_card(state, blue_eyes["instance_id"])
        self.assertEqual(summoned[:2], ("ai", "monster_zone"))

    def test_blue_eyes_solid_dragon_quick_effect_is_once_per_turn_across_copies(self):
        self.register_test_chain_effect()
        state = new_state()
        state["turn_player"] = "ai"
        actions = DuelActionEngine(self.engine)
        first_solid = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-solid-dragon"),
        )
        put(
            state,
            "player",
            "deck",
            new_card("m-blue-eyes-white-dragon"),
        )
        first_activation = put(
            state,
            "ai",
            "hand",
            new_card("test-chain-effect", "spell", owner="ai"),
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=first_activation["instance_id"],
            effect_id="activate",
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": first_solid["instance_id"],
            },
        )
        state = resolve_action_chain(actions, state)

        second_solid = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-solid-dragon"),
        )
        second_activation = put(
            state,
            "ai",
            "hand",
            new_card("test-chain-effect", "spell", owner="ai"),
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=second_activation["instance_id"],
            effect_id="activate",
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "activate_effect",
                    "source_instance_id": second_solid["instance_id"],
                },
            )

    def test_chaos_emperor_dragon_cannot_be_normal_summoned_or_set(self):
        state = new_state()
        chaos_emperor = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )
        actions = DuelActionEngine(self.engine)

        for action in (
            {
                "type": "summon",
                "instance_id": chaos_emperor["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
            {
                "type": "set_card",
                "instance_id": chaos_emperor["instance_id"],
                "zone_index": 0,
            },
        ):
            with self.subTest(action_type=action["type"]):
                with self.assertRaises(DuelRuleError):
                    actions.apply(state, player="player", action=action)
        self.assertEqual(find_card(state, chaos_emperor["instance_id"])[1], "hand")

    def test_chaos_emperor_dragon_is_special_summoned_by_banishing_light_and_dark(self):
        state = new_state()
        chaos_emperor = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )
        light = put(
            state,
            "player",
            "graveyard",
            new_card("light-material", attribute="LIGHT"),
        )
        dark = put(
            state,
            "player",
            "graveyard",
            new_card("dark-material", attribute="DARK"),
        )
        same_attribute = put(
            state,
            "player",
            "graveyard",
            new_card("another-light", attribute="LIGHT"),
        )
        actions = DuelActionEngine(self.engine)

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "special_summon_chaos_emperor",
                    "source_instance_id": chaos_emperor["instance_id"],
                    "tribute_instance_ids": [
                        light["instance_id"],
                        same_attribute["instance_id"],
                    ],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_chaos_emperor",
                "source_instance_id": chaos_emperor["instance_id"],
                "tribute_instance_ids": [
                    light["instance_id"],
                    dark["instance_id"],
                ],
            },
        )

        self.assertEqual(find_card(state, chaos_emperor["instance_id"])[1], "monster_zone")
        self.assertTrue(
            find_card(state, chaos_emperor["instance_id"])[3]["properly_summoned"]
        )
        self.assertEqual(
            find_card(state, chaos_emperor["instance_id"])[3]["summon_method"],
            "special",
        )
        self.assertEqual(find_card(state, light["instance_id"])[1], "banished")
        self.assertEqual(find_card(state, dark["instance_id"])[1], "banished")
        self.assertFalse(state["normal_summon_used"]["player"])
        move_card(state, chaos_emperor["instance_id"], "player", "graveyard")
        monster_reborn = put(
            state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            monster_reborn,
            targets=(chaos_emperor["instance_id"],),
        )
        self.assertEqual(find_card(state, chaos_emperor["instance_id"])[1], "monster_zone")

    def test_ai_special_summons_chaos_emperor_only_with_light_and_dark_materials(self):
        state = new_state()
        actions = DuelActionEngine(self.engine)
        chaos_emperor = put(
            state,
            "ai",
            "hand",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )

        actions._set_ai_card(state)
        self.assertEqual(find_card(state, chaos_emperor["instance_id"])[1], "hand")

        light = put(
            state,
            "ai",
            "graveyard",
            new_card("ai-light-material", attribute="LIGHT"),
        )
        dark = put(
            state,
            "ai",
            "graveyard",
            new_card("ai-dark-material", attribute="DARK"),
        )
        with patch("duel.duel_actions.random.choice", return_value="attack"):
            actions._set_ai_card(state)

        summoned = find_card(state, chaos_emperor["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertTrue(summoned[3]["properly_summoned"])
        self.assertEqual(find_card(state, light["instance_id"])[1], "banished")
        self.assertEqual(find_card(state, dark["instance_id"])[1], "banished")

    def test_ai_normal_summons_strongest_eligible_monster_face_up_in_attack(self):
        state = new_state()
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        weak = put(
            state,
            "ai",
            "hand",
            new_card("ai-weak-monster", atk=1200, level=4),
        )
        strong = put(
            state,
            "ai",
            "hand",
            new_card("ai-strong-monster", atk=1900, level=4),
        )
        actions = DuelActionEngine(self.engine)

        with patch("duel.duel_actions.random.choice", return_value="attack"):
            actions._set_ai_card(state)

        summoned = find_card(state, strong["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertFalse(summoned[3]["face_down"])
        self.assertEqual(summoned[3]["position"], "attack")
        self.assertTrue(state["normal_summon_used"]["ai"])
        self.assertEqual(find_card(state, weak["instance_id"])[1], "hand")

    def test_ai_sets_a_weak_monster_in_defense_against_a_stronger_opponent(self):
        state = new_state()
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        monster = put(
            state,
            "ai",
            "hand",
            new_card("ai-defense-monster", atk=1200, level=4),
        )
        put(
            state,
            "player",
            "monster_zone",
            new_card("stronger-opponent", atk=2000),
        )
        actions = DuelActionEngine(self.engine)

        actions._set_ai_card(state)

        set_monster = find_card(state, monster["instance_id"])[3]
        self.assertEqual(find_card(state, monster["instance_id"])[1], "monster_zone")
        self.assertTrue(set_monster["face_down"])
        self.assertEqual(set_monster["position"], "defense")
        self.assertTrue(state["normal_summon_used"]["ai"])

    def test_ai_tribute_summons_only_when_it_can_pay_the_tribute(self):
        state = new_state()
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        tribute = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-tribute", atk=1000, level=4),
        )
        high_level = put(
            state,
            "ai",
            "hand",
            new_card("ai-level-six", atk=2400, level=6),
        )
        actions = DuelActionEngine(self.engine)

        with patch("duel.duel_actions.random.choice", return_value="attack"):
            actions._set_ai_card(state)

        summoned = find_card(state, high_level["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertFalse(summoned[3]["face_down"])
        self.assertEqual(summoned[3]["position"], "attack")
        self.assertEqual(find_card(state, tribute["instance_id"])[1], "graveyard")

        unpaid_state = new_state()
        unpaid_state["turn_player"] = "ai"
        unpaid_state["phase"] = "main1"
        unpaid_monster = put(
            unpaid_state,
            "ai",
            "hand",
            new_card("ai-unpaid-level-six", atk=2400, level=6),
        )
        actions._set_ai_card(unpaid_state)
        self.assertEqual(
            find_card(unpaid_state, unpaid_monster["instance_id"])[1],
            "hand",
        )
        self.assertFalse(unpaid_state["normal_summon_used"]["ai"])

    def test_chaos_emperor_dragon_cannot_be_revived_before_its_proper_summon(self):
        state = new_state()
        chaos_emperor = put(
            state,
            "player",
            "graveyard",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )
        monster_reborn = put(
            state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=monster_reborn["instance_id"],
                effect_id="activate",
                target_instance_ids=(chaos_emperor["instance_id"],),
            )

    def test_chaos_emperor_dragon_sends_hands_and_fields_and_damages_opponent_grave_count(self):
        state = new_state()
        chaos_emperor = put(
            state,
            "player",
            "monster_zone",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )
        own_hand = put(
            state,
            "player",
            "hand",
            new_card("own-hand-card", "spell"),
        )
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("own-field-spell", "spell", face_down=False),
        )
        opponent_hand = put(
            state,
            "ai",
            "hand",
            new_card("opponent-hand-card", "monster", owner="ai"),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-field-monster", owner="ai"),
        )
        opponent_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-field-trap", "trap", owner="ai", face_down=True),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            chaos_emperor,
        )

        self.assertEqual(state["players"]["player"]["lp"], 7000)
        self.assertEqual(state["players"]["ai"]["lp"], 7100)
        for card in (
            chaos_emperor,
            own_hand,
            own_spell,
            opponent_hand,
            opponent_monster,
            opponent_trap,
        ):
            self.assertEqual(find_card(state, card["instance_id"])[1], "graveyard")
        self.assertEqual(
            state["effect_uses"]["player:m-chaos-emperor-dragon:field-wipe"],
            state["turn"],
        )

    def test_chaos_emperor_dragon_field_wipe_is_once_per_turn(self):
        state = new_state()
        chaos_emperor = put(
            state,
            "player",
            "monster_zone",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            chaos_emperor,
        )
        second_copy = put(
            state,
            "player",
            "monster_zone",
            new_card("m-chaos-emperor-dragon-envoy-of-the-end"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=second_copy["instance_id"],
                effect_id="activate",
            )

    def test_levianeer_cannot_be_normal_summoned_or_set(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        actions = DuelActionEngine(self.engine)

        for action in (
            {
                "type": "summon",
                "instance_id": levianeer["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
            {
                "type": "set_card",
                "instance_id": levianeer["instance_id"],
                "zone_index": 0,
            },
        ):
            with self.subTest(action_type=action["type"]):
                with self.assertRaises(DuelRuleError):
                    actions.apply(state, player="player", action=action)
        self.assertEqual(find_card(state, levianeer["instance_id"])[1], "hand")

    def test_levianeer_rejects_non_light_or_dark_graveyard_materials(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card("light-material", attribute="LIGHT"),
            ),
            put(
                state,
                "player",
                "graveyard",
                new_card("earth-material", attribute="EARTH"),
            ),
        ]

        with self.assertRaises(DuelRuleError):
            DuelActionEngine(self.engine).apply(
                state,
                player="player",
                action={
                    "type": "special_summon_levianeer",
                    "source_instance_id": levianeer["instance_id"],
                    "tribute_instance_ids": [
                        material["instance_id"] for material in materials
                    ],
                },
            )

        self.assertEqual(find_card(state, levianeer["instance_id"])[1], "hand")
        self.assertTrue(
            all(find_card(state, material["instance_id"])[1] == "graveyard" for material in materials)
        )

    def test_levianeer_light_only_summon_revives_a_monster_in_defense(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card(f"light-material-{index}", attribute="LIGHT"),
            )
            for index in range(2)
        ]
        revived = put(
            state,
            "player",
            "graveyard",
            new_card("revived-monster", attribute="DARK"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": levianeer["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in materials
                ],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "select_graveyard_card")
        self.assertEqual(
            state["pending_decision"]["eligible_target_instance_ids"],
            [revived["instance_id"]],
        )
        self.assertFalse(
            can_declare_attack(state, "player", levianeer["instance_id"])
        )
        self.assertTrue(
            all(find_card(state, material["instance_id"])[1] == "banished" for material in materials)
        )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [revived["instance_id"]],
            },
        )

        revived_card = find_card(state, revived["instance_id"])
        self.assertEqual(revived_card[1], "monster_zone")
        self.assertEqual(revived_card[3]["position"], "defense")
        self.assertEqual(revived_card[3]["summon_method"], "special")
        self.assertTrue(find_card(state, levianeer["instance_id"])[3]["properly_summoned"])

    def test_levianeer_dark_only_summon_shuffles_random_opponent_card_into_deck(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card(f"dark-material-{index}", attribute="DARK"),
            )
            for index in range(2)
        ]
        opponent_hand = [
            put(
                state,
                "ai",
                "hand",
                new_card(f"opponent-hand-{index}", owner="ai"),
            )
            for index in range(2)
        ]
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": levianeer["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in materials
                ],
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(len(state["players"]["ai"]["hand"]), 1)
        self.assertEqual(len(state["players"]["ai"]["deck"]), 1)
        moved_card_id = state["players"]["ai"]["deck"][0]["instance_id"]
        self.assertIn(moved_card_id, {card["instance_id"] for card in opponent_hand})
        self.assertFalse(
            can_declare_attack(state, "player", levianeer["instance_id"])
        )

    def test_levianeer_mixed_summon_can_destroy_up_to_two_field_cards(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card("light-material", attribute="LIGHT"),
            ),
            put(
                state,
                "player",
                "graveyard",
                new_card("dark-material", attribute="DARK"),
            ),
        ]
        own_card = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("own-spell", "spell"),
        )
        opponent_card = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": levianeer["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in materials
                ],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "select_field_cards")
        self.assertEqual(state["pending_decision"]["min_count"], 0)
        self.assertEqual(state["pending_decision"]["max_count"], 2)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [
                    own_card["instance_id"],
                    opponent_card["instance_id"],
                ],
            },
        )
        self.assertEqual(find_card(state, own_card["instance_id"])[1], "graveyard")
        self.assertEqual(
            find_card(state, opponent_card["instance_id"])[1],
            "graveyard",
        )

    def test_levianeer_mixed_summon_can_skip_optional_destruction(self):
        state = new_state()
        levianeer = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card("light-material", attribute="LIGHT"),
            ),
            put(
                state,
                "player",
                "graveyard",
                new_card("dark-material", attribute="DARK"),
            ),
        ]
        opponent_card = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": levianeer["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in materials
                ],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": []},
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, opponent_card["instance_id"])[1], "monster_zone")

    def test_levianeer_summon_effect_is_once_per_turn_across_copies(self):
        state = new_state()
        actions = DuelActionEngine(self.engine)
        first_copy = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        first_materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card(f"first-dark-material-{index}", attribute="DARK"),
            )
            for index in range(2)
        ]
        put(
            state,
            "ai",
            "hand",
            new_card("opponent-hand-card", owner="ai"),
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": first_copy["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in first_materials
                ],
            },
        )
        second_copy = put(
            state,
            "player",
            "hand",
            new_card("m-chaos-dragon-levianeer"),
        )
        second_materials = [
            put(
                state,
                "player",
                "graveyard",
                new_card(f"second-light-material-{index}", attribute="LIGHT"),
            )
            for index in range(2)
        ]
        revival_target = put(
            state,
            "player",
            "graveyard",
            new_card("revival-target"),
        )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_levianeer",
                "source_instance_id": second_copy["instance_id"],
                "tribute_instance_ids": [
                    material["instance_id"] for material in second_materials
                ],
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, revival_target["instance_id"])[1], "graveyard")
        self.assertFalse(
            can_declare_attack(state, "player", second_copy["instance_id"])
        )

    def test_ai_summons_levianeer_and_resolves_dark_effect(self):
        state = new_state()
        levianeer = put(
            state,
            "ai",
            "hand",
            new_card("m-chaos-dragon-levianeer", owner="ai"),
        )
        materials = [
            put(
                state,
                "ai",
                "graveyard",
                new_card(f"ai-dark-material-{index}", owner="ai", attribute="DARK"),
            )
            for index in range(2)
        ]
        opponent_card = put(
            state,
            "player",
            "hand",
            new_card("player-hand-card"),
        )
        actions = DuelActionEngine(self.engine)

        actions._set_ai_card(state)
        actions._resolve_pending_card_triggers(state)

        self.assertEqual(find_card(state, levianeer["instance_id"])[1], "monster_zone")
        self.assertTrue(find_card(state, levianeer["instance_id"])[3]["properly_summoned"])
        self.assertTrue(
            all(find_card(state, material["instance_id"])[1] == "banished" for material in materials)
        )
        self.assertEqual(find_card(state, opponent_card["instance_id"])[1], "deck")

    def test_y_dragon_head_equips_x_head_cannon_and_grants_atk_and_defense(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "hand",
            new_card("m-y-dragon-head", atk=1500, race="Machine", **{"def": 1600}),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", atk=1800, race="Machine", **{"def": 1500}),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        equipped = find_card(state, y_dragon["instance_id"])
        self.assertEqual(equipped[1], "spell_trap_zone")
        self.assertTrue(equipped[3]["union_equipped"])
        self.assertEqual(equipped[3]["target_instance_id"], x_head["instance_id"])
        self.assertEqual(current_stats(state, x_head["instance_id"]), {"atk": 2200, "def": 1900})

    def test_y_dragon_head_rejects_non_x_head_or_face_down_targets(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "hand",
            new_card("m-y-dragon-head", race="Machine"),
        )
        wrong_target = put(
            state,
            "player",
            "monster_zone",
            new_card("other-machine", race="Machine"),
        )
        face_down_x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", face_down=True, position="defense"),
        )
        actions = DuelActionEngine(self.engine)

        for target in (wrong_target, face_down_x_head):
            with self.subTest(target=target["card_id"]):
                with self.assertRaises(DuelRuleError):
                    actions.apply(
                        state,
                        player="player",
                        action={
                            "type": "union_effect",
                            "mode": "equip",
                            "source_instance_id": y_dragon["instance_id"],
                            "target_instance_id": target["instance_id"],
                        },
                    )

        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "hand")

    def test_y_dragon_head_detaches_on_a_later_turn_and_removes_its_bonus(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "hand",
            new_card("m-y-dragon-head", atk=1500, race="Machine", **{"def": 1600}),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", atk=1800, race="Machine", **{"def": 1500}),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "union_effect",
                    "mode": "detach",
                    "source_instance_id": y_dragon["instance_id"],
                },
            )

        state["turn"] += 1
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "detach",
                "source_instance_id": y_dragon["instance_id"],
            },
        )

        detached = find_card(state, y_dragon["instance_id"])
        self.assertEqual(detached[1], "monster_zone")
        self.assertEqual(detached[3]["summon_method"], "special")
        self.assertFalse(detached[3].get("union_equipped", False))
        self.assertEqual(current_stats(state, x_head["instance_id"]), {"atk": 1800, "def": 1500})

    def test_y_dragon_head_replaces_destruction_of_equipped_x_head_cannon(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "hand",
            new_card("m-y-dragon-head", race="Machine"),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", race="Machine"),
        )
        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        destroy_card(state, x_head["instance_id"], by_player="ai")

        self.assertEqual(find_card(state, x_head["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "graveyard")
        self.assertEqual(current_stats(state, x_head["instance_id"]), {"atk": 1000, "def": 800})

    def test_y_dragon_head_is_destroyed_when_its_equipped_monster_leaves_field(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "hand",
            new_card("m-y-dragon-head", race="Machine"),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", race="Machine"),
        )
        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        move_card(state, x_head["instance_id"], "player", "graveyard")

        self.assertEqual(find_card(state, x_head["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "graveyard")

    def test_ai_equips_y_dragon_head_to_its_face_up_x_head_cannon(self):
        state = new_state()
        state["turn_player"] = "ai"
        y_dragon = put(
            state,
            "ai",
            "hand",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )
        x_head = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-x-head-cannon", owner="ai", race="Machine"),
        )

        DuelActionEngine(self.engine)._ai_use_union_monsters(state)

        equipped = find_card(state, y_dragon["instance_id"])
        self.assertEqual(equipped[1], "spell_trap_zone")
        self.assertEqual(equipped[3]["target_instance_id"], x_head["instance_id"])
        self.assertEqual(current_stats(state, x_head["instance_id"])["atk"], 1400)

    def test_z_metal_tank_equips_x_cannon_or_y_dragon_and_grants_600_stats(self):
        for target_card_id in ("m-x-head-cannon", "m-y-dragon-head"):
            with self.subTest(target_card_id=target_card_id):
                state = new_state()
                tank = put(
                    state,
                    "player",
                    "hand",
                    new_card("m-z-metal-tank", race="Machine"),
                )
                target = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(target_card_id, race="Machine", **{"def": 1200}),
                )
                state = DuelActionEngine(self.engine).apply(
                    state,
                    player="player",
                    action={
                        "type": "union_effect",
                        "mode": "equip",
                        "source_instance_id": tank["instance_id"],
                        "target_instance_id": target["instance_id"],
                    },
                )

                equipped = find_card(state, tank["instance_id"])
                self.assertEqual(equipped[1], "spell_trap_zone")
                self.assertTrue(equipped[3]["union_equipped"])
                self.assertEqual(
                    current_stats(state, target["instance_id"]),
                    {"atk": 1600, "def": 1800},
                )

    def test_z_metal_tank_cannot_equip_to_face_down_or_unlisted_monsters(self):
        state = new_state()
        tank = put(
            state,
            "player",
            "hand",
            new_card("m-z-metal-tank", race="Machine"),
        )
        face_down_y = put(
            state,
            "player",
            "monster_zone",
            new_card("m-y-dragon-head", race="Machine", face_down=True),
        )
        wrong_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("other-machine", race="Machine"),
        )
        actions = DuelActionEngine(self.engine)

        for target in (face_down_y, wrong_monster):
            with self.subTest(target=target["card_id"]):
                with self.assertRaises(DuelRuleError):
                    actions.apply(
                        state,
                        player="player",
                        action={
                            "type": "union_effect",
                            "mode": "equip",
                            "source_instance_id": tank["instance_id"],
                            "target_instance_id": target["instance_id"],
                        },
                    )

        self.assertEqual(find_card(state, tank["instance_id"])[1], "hand")

    def test_z_metal_tank_detaches_and_special_summons_on_a_later_turn(self):
        state = new_state()
        tank = put(
            state,
            "player",
            "hand",
            new_card("m-z-metal-tank", race="Machine"),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", race="Machine"),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": tank["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "union_effect",
                    "mode": "detach",
                    "source_instance_id": tank["instance_id"],
                },
            )

        state["turn"] += 1
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "detach",
                "source_instance_id": tank["instance_id"],
            },
        )

        detached = find_card(state, tank["instance_id"])
        self.assertEqual(detached[1], "monster_zone")
        self.assertEqual(detached[3]["summon_method"], "special")
        self.assertEqual(current_stats(state, x_head["instance_id"]), {"atk": 1000, "def": 800})

    def test_z_metal_tank_replaces_destruction_and_is_sent_to_grave_when_target_leaves(self):
        state = new_state()
        tank = put(
            state,
            "player",
            "hand",
            new_card("m-z-metal-tank", race="Machine"),
        )
        y_dragon = put(
            state,
            "player",
            "monster_zone",
            new_card("m-y-dragon-head", race="Machine"),
        )
        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": tank["instance_id"],
                "target_instance_id": y_dragon["instance_id"],
            },
        )

        destroy_card(state, y_dragon["instance_id"], by_player="ai")
        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, tank["instance_id"])[1], "graveyard")
        self.assertEqual(current_stats(state, y_dragon["instance_id"]), {"atk": 1000, "def": 800})

        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", race="Machine"),
        )
        second_tank = put(
            state,
            "player",
            "hand",
            new_card("m-z-metal-tank", race="Machine"),
        )
        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": second_tank["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )
        move_card(state, x_head["instance_id"], "player", "graveyard")

        self.assertEqual(find_card(state, x_head["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, second_tank["instance_id"])[1], "graveyard")

    def test_z_metal_tank_leaves_when_its_target_is_equipped_by_another_union(self):
        state = new_state()
        y_dragon = put(
            state,
            "player",
            "monster_zone",
            new_card("m-y-dragon-head", race="Machine"),
        )
        tank = put(
            state,
            "player",
            "hand",
            new_card("m-z-metal-tank", race="Machine"),
        )
        x_head = put(
            state,
            "player",
            "monster_zone",
            new_card("m-x-head-cannon", race="Machine"),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": tank["instance_id"],
                "target_instance_id": y_dragon["instance_id"],
            },
        )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "union_effect",
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )

        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "spell_trap_zone")
        self.assertEqual(find_card(state, tank["instance_id"])[1], "graveyard")
        self.assertEqual(current_stats(state, x_head["instance_id"])["atk"], 1400)

    def test_ai_equips_z_metal_tank_to_a_legal_union_target(self):
        state = new_state()
        state["turn_player"] = "ai"
        tank = put(
            state,
            "ai",
            "hand",
            new_card("m-z-metal-tank", owner="ai", race="Machine"),
        )
        y_dragon = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )

        DuelActionEngine(self.engine)._ai_use_union_monsters(state)

        equipped = find_card(state, tank["instance_id"])
        self.assertEqual(equipped[1], "spell_trap_zone")
        self.assertEqual(equipped[3]["target_instance_id"], y_dragon["instance_id"])
        self.assertEqual(current_stats(state, y_dragon["instance_id"])["atk"], 1600)

    def test_ai_keeps_union_card_equipped_across_turns(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        y_dragon = put(
            state,
            "ai",
            "hand",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-x-head-cannon", owner="ai", race="Machine"),
        )
        put(
            state,
            "player",
            "monster_zone",
            new_card("strong-opponent", owner="player", atk=2000),
        )
        actions = DuelActionEngine(self.engine)
        actions._use_union_monster_effect(
            state,
            "ai",
            {
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": target["instance_id"],
            },
        )
        state["turn"] += 1

        actions._ai_use_union_monsters(state)

        equipped = find_card(state, y_dragon["instance_id"])
        self.assertEqual(equipped[1], "spell_trap_zone")
        self.assertTrue(equipped[3]["union_equipped"])
        self.assertEqual(
            state["effect_uses"][
                f"{y_dragon['instance_id']}:m-y-dragon-head:union"
            ],
            state["turn"] - 1,
        )
        self.assertEqual(current_stats(state, target["instance_id"])["atk"], 1400)

    def test_ai_detaches_y_dragon_for_direct_attack_and_cannot_re_equip_this_turn(self):
        state = new_state()
        state.update({"turn": 1, "turn_player": "ai", "phase": "main1"})
        actions = DuelActionEngine(self.engine)
        y_dragon = put(
            state,
            "ai",
            "hand",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )
        x_head = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-x-head-cannon", owner="ai", race="Machine"),
        )
        actions._use_union_monster_effect(
            state,
            "ai",
            {
                "mode": "equip",
                "source_instance_id": y_dragon["instance_id"],
                "target_instance_id": x_head["instance_id"],
            },
        )
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        actions._resume_ai_main_phase(state)

        detached = find_card(state, y_dragon["instance_id"])
        self.assertEqual(detached[1], "monster_zone")
        self.assertFalse(detached[3].get("union_equipped", False))
        self.assertEqual(current_stats(state, x_head["instance_id"])["atk"], 1000)
        self.assertIn(y_dragon["instance_id"], state["attacked"]["ai"])
        self.assertEqual(
            state["effect_uses"][
                f"{y_dragon['instance_id']}:m-y-dragon-head:union"
            ],
            2,
        )
        self.assertEqual(state["turn_player"], "player")

    def test_twin_twisters_can_destroy_y_dragon_head_while_equipped(self):
        state = new_state()
        twin_twisters = put(
            state,
            "player",
            "hand",
            new_card("s-twin-twisters", "spell"),
        )
        discard = put(
            state,
            "player",
            "hand",
            new_card("discard-card", "spell"),
        )
        x_head = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-x-head-cannon", owner="ai", race="Machine"),
        )
        y_dragon = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )
        y_dragon["union_equipped"] = True
        y_dragon["target_instance_id"] = x_head["instance_id"]
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": twin_twisters["instance_id"],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_discard",
                "instance_ids": [discard["instance_id"]],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [y_dragon["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, y_dragon["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, x_head["instance_id"])[1], "monster_zone")
        self.assertFalse(find_card(state, y_dragon["instance_id"])[3].get("union_equipped"))

    def test_lava_golem_damages_its_controller_once_each_standby_phase(self):
        state = new_state()
        state["turn"] = 2
        golem = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-lava-golem", owner="player", atk=3000),
        )
        golem["controller"] = "ai"

        resolve_standby_effects(state, "ai")
        resolve_standby_effects(state, "ai")

        self.assertEqual(state["players"]["ai"]["lp"], 7000)
        state["turn"] += 1
        resolve_standby_effects(state, "ai")
        self.assertEqual(state["players"]["ai"]["lp"], 6000)

    def test_kaiser_vorse_raider_gains_atk_after_destroying_and_decreases_destroyer(self):
        actions = DuelActionEngine(self.engine)
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        raider = put(
            state,
            "player",
            "monster_zone",
            new_card("m-kaiser-vorse-raider", atk=1900),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai", atk=1600),
        )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": raider["instance_id"],
                "defender_instance_id": target["instance_id"],
            },
        )
        self.assertEqual(current_stats(state, raider["instance_id"])["atk"], 2400)

        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        destroyer = put(
            state,
            "player",
            "monster_zone",
            new_card("attacking-monster", atk=2400),
        )
        raider = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-kaiser-vorse-raider", owner="ai", atk=1900),
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": destroyer["instance_id"],
                "defender_instance_id": raider["instance_id"],
            },
        )

        self.assertEqual(find_card(state, raider["instance_id"])[1], "graveyard")
        self.assertEqual(current_stats(state, destroyer["instance_id"])["atk"], 1900)

    def test_lightning_storm_destroys_only_opponent_attack_position_monsters(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-lightning-storm", "spell"),
        )
        attack_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("attack-monster", owner="ai", position="attack"),
        )
        defense_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("defense-monster", owner="ai", position="defense"),
        )
        set_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("set-monster", owner="ai", position="defense", face_down=True),
        )
        opponent_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-spell", "spell", owner="ai"),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            payload={"mode": "destroy_attack_monsters"},
        )

        self.assertEqual(find_card(state, attack_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, defense_monster["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, set_monster["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, opponent_spell["instance_id"])[1], "spell_trap_zone")

    def test_lightning_storm_destroys_opponent_spell_and_trap_cards(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-lightning-storm", "spell"),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        opponent_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-spell", "spell", owner="ai"),
        )
        opponent_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-trap", "trap", owner="ai", face_down=True),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            payload={"mode": "destroy_spell_traps"},
        )

        self.assertEqual(find_card(state, opponent_monster["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, opponent_spell["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, opponent_trap["instance_id"])[1], "graveyard")

    def test_lightning_storm_requires_any_opponent_field_card_to_activate(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-lightning-storm", "spell"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=spell["instance_id"],
                effect_id="activate",
                payload={"mode": "destroy_attack_monsters"},
            )
        self.assertEqual(find_card(state, spell["instance_id"])[1], "hand")

        opponent_set_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-trap", "trap", owner="ai", face_down=True),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            payload={"mode": "destroy_attack_monsters"},
        )
        self.assertEqual(find_card(state, opponent_set_trap["instance_id"])[1], "spell_trap_zone")
        self.assertEqual(find_card(state, spell["instance_id"])[1], "graveyard")

    def test_lightning_storm_requires_a_valid_mode_and_is_once_per_turn(self):
        state = new_state()
        first_spell = put(
            state,
            "player",
            "hand",
            new_card("s-lightning-storm", "spell"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=first_spell["instance_id"],
                effect_id="activate",
                payload={"mode": "invalid"},
            )
        self.assertEqual(find_card(state, first_spell["instance_id"])[1], "hand")
        put(state, "ai", "monster_zone", new_card("enemy", owner="ai"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            first_spell,
            payload={"mode": "destroy_spell_traps"},
        )
        second_spell = put(
            state,
            "player",
            "hand",
            new_card("s-lightning-storm", "spell"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=second_spell["instance_id"],
                effect_id="activate",
                payload={"mode": "destroy_attack_monsters"},
            )

    def test_solemn_wishes_can_be_activated_from_a_previously_set_trap(self):
        state = new_state()
        state["phase"] = "main1"
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-solemn-wishes", "trap", face_down=True, set_turn=0),
        )
        state = activate_and_resolve(self.engine, state, "player", trap)
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        put(state, "player", "deck", new_card("one"))
        put(state, "player", "deck", new_card("two"))

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertEqual(state["players"]["player"]["lp"], 8500)
        self.assertFalse(state["players"]["player"]["spell_trap_zone"][0]["face_down"])

    def test_kaibaman_tributes_itself_to_summon_blue_eyes_from_hand_or_deck(self):
        for target_zone in ("hand", "deck"):
            with self.subTest(target_zone=target_zone):
                state = new_state()
                kaibaman = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card("m-kaibaman"),
                )
                blue_eyes = put(
                    state,
                    "player",
                    target_zone,
                    new_card(
                        "m-blue-eyes-white-dragon",
                        level=8,
                        attribute="LIGHT",
                        race="Rồng",
                    ),
                )
                actions = DuelActionEngine(self.engine)
                result = actions.apply(
                    state,
                    player="player",
                    action={
                        "type": "activate_effect",
                        "source_instance_id": kaibaman["instance_id"],
                    },
                )
                while result["chain"]["status"] == "open":
                    result = actions.apply(
                        result,
                        player=result["chain"]["priority_player"],
                        action={"type": "pass_chain"},
                    )

                self.assertEqual(
                    result["players"]["player"]["graveyard"][0]["instance_id"],
                    kaibaman["instance_id"],
                )
                self.assertTrue(
                    any(
                        card
                        and card["instance_id"] == blue_eyes["instance_id"]
                        and card["summon_method"] == "special"
                        for card in result["players"]["player"]["monster_zone"]
                    )
                )

    def test_kaibaman_cannot_be_activated_without_blue_eyes_in_hand_or_deck(self):
        state = new_state()
        kaibaman = put(
            state,
            "player",
            "monster_zone",
            new_card("m-kaibaman"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=kaibaman["instance_id"],
                effect_id="activate",
            )

        self.assertIs(
            state["players"]["player"]["monster_zone"][0],
            kaibaman,
        )

    def test_blizzard_dragon_locks_opponent_attack_and_position_until_their_turn_ends(self):
        state = new_state()
        blizzard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blizzard-dragon"),
        )
        friendly_target = put(
            state,
            "player",
            "monster_zone",
            new_card("friendly-monster"),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-monster", owner="ai"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=blizzard["instance_id"],
                effect_id="activate",
                target_instance_ids=(friendly_target["instance_id"],),
            )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            blizzard,
            targets=(target["instance_id"],),
        )

        locked_target = find_card(state, target["instance_id"])[3]
        self.assertEqual(locked_target["cannot_attack_until_turn"], 2)
        self.assertEqual(locked_target["cannot_change_position_until_turn"], 2)
        self.assertFalse(can_declare_attack(state, "ai", target["instance_id"]))
        self.assertFalse(
            can_change_battle_position(state, "ai", target["instance_id"])
        )

        state["turn"] = 3
        self.assertTrue(can_declare_attack(state, "ai", target["instance_id"]))
        self.assertTrue(
            can_change_battle_position(state, "ai", target["instance_id"])
        )

    def test_blizzard_dragon_is_once_per_turn_and_clears_lock_when_target_leaves(self):
        state = new_state()
        blizzard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blizzard-dragon"),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-monster", owner="ai"),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            blizzard,
            targets=(target["instance_id"],),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=blizzard["instance_id"],
                effect_id="activate",
                target_instance_ids=(target["instance_id"],),
            )

        move_card(state, target["instance_id"], "ai", "graveyard")
        moved_target = find_card(state, target["instance_id"])[3]
        self.assertNotIn("cannot_attack_until_turn", moved_target)
        self.assertNotIn("cannot_change_position_until_turn", moved_target)

    def test_catapult_turtle_tributes_a_friendly_monster_and_deals_half_current_atk(self):
        state = new_state()
        turtle = put(
            state,
            "player",
            "monster_zone",
            new_card("m-catapult-turtle"),
        )
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster", atk=1901),
        )
        state = add_stat_modifier(
            state,
            target_instance_id=tribute["instance_id"],
            source_instance_id=turtle["instance_id"],
            source_card_id="m-catapult-turtle",
            owner="player",
            stat="atk",
            operation="increase",
            value=101,
            duration={"type": "permanent"},
        )

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=turtle["instance_id"],
            effect_id="activate",
            target_instance_ids=(tribute["instance_id"],),
            payload={"damage": 8000},
        )

        self.assertEqual(find_card(state, tribute["instance_id"])[1], "graveyard")
        self.assertEqual(state["players"]["player"]["graveyard"][0]["instance_id"], tribute["instance_id"])
        self.assertEqual(state["players"]["ai"]["lp"], 8000)
        self.assertEqual(state["chain"]["links"][0]["payload"]["damage"], 1001)

        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(
                state,
                player=state["chain"]["priority_player"],
            )

        self.assertEqual(state["players"]["ai"]["lp"], 6999)

    def test_catapult_turtle_rejects_an_opponent_monster_as_tribute(self):
        state = new_state()
        turtle = put(
            state,
            "player",
            "monster_zone",
            new_card("m-catapult-turtle"),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=turtle["instance_id"],
                effect_id="activate",
                target_instance_ids=(opponent_monster["instance_id"],),
            )

        self.assertEqual(state["players"]["ai"]["lp"], 8000)

    def test_jinzo_prevents_trap_activation_without_blocking_spells(self):
        state = new_state()
        put(state, "ai", "monster_zone", new_card("m-jinzo", owner="ai"))
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-gravity-bind",
                "trap",
                face_down=True,
                set_turn=0,
            ),
        )
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-pot-of-greed", "spell"),
        )
        put(state, "player", "deck", new_card("draw-one"))
        put(state, "player", "deck", new_card("draw-two"))

        with self.assertRaisesRegex(DuelRuleError, "Jinzo"):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=trap["instance_id"],
                effect_id="activate",
            )

        activated = self.engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
        )
        self.assertEqual(activated["chain"]["status"], "open")
        self.assertTrue(trap["face_down"])

    def test_jinzo_negates_opposing_trap_continuous_effects_only(self):
        state = new_state()
        jinzo = put(
            state,
            "player",
            "monster_zone",
            new_card("m-jinzo"),
        )
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", level=4),
        )
        enemy_bind = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-gravity-bind",
                "trap",
                owner="ai",
                face_down=False,
            ),
        )

        self.assertTrue(can_declare_attack(state, "ai", attacker["instance_id"]))

        move_card(state, enemy_bind["instance_id"], "ai", "graveyard")
        own_bind = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-gravity-bind",
                "trap",
                face_down=False,
            ),
        )
        self.assertIsNotNone(find_card(state, jinzo["instance_id"]))
        self.assertFalse(can_declare_attack(state, "ai", attacker["instance_id"]))
        self.assertIsNotNone(find_card(state, own_bind["instance_id"]))

    def test_jinzo_suppresses_opposing_trap_stat_modifiers(self):
        state = new_state()
        monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-monster", owner="ai", atk=2000),
        )
        shadow_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-shadow-spell",
                "trap",
                owner="ai",
                face_down=False,
                target_instance_id=monster["instance_id"],
            ),
        )
        state = add_stat_modifier(
            state,
            target_instance_id=monster["instance_id"],
            source_instance_id=shadow_spell["instance_id"],
            source_card_id="t-shadow-spell",
            owner="ai",
            stat="atk",
            operation="decrease",
            value=700,
            duration={"type": "continuous"},
        )
        self.assertEqual(current_stats(state, monster["instance_id"])["atk"], 1300)

        put(state, "player", "monster_zone", new_card("m-jinzo"))

        self.assertEqual(current_stats(state, monster["instance_id"])["atk"], 2000)

    def test_jinzo_keeps_set_attack_traps_from_triggering(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("attacker", atk=2000),
        )
        defender = put(
            state,
            "ai",
            "monster_zone",
            new_card("defender", owner="ai", atk=1000),
        )
        put(state, "player", "monster_zone", new_card("m-jinzo"))
        mirror_force = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-mirror-force",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=0,
            ),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": defender["instance_id"],
            },
        )

        self.assertEqual(find_card(state, defender["instance_id"])[1], "graveyard")
        self.assertIsNotNone(find_card(state, mirror_force["instance_id"]))
        self.assertEqual(state["chain"]["status"], "closed")

    def test_double_tribute_monsters_only_count_for_matching_attributes(self):
        cases = (
            ("m-kaiser-seahorse", "LIGHT", "DARK"),
            ("m-double-coston", "DARK", "LIGHT"),
        )
        for tribute_id, matching_attribute, wrong_attribute in cases:
            with self.subTest(tribute_id=tribute_id):
                state = new_state()
                state["normal_summon_used"] = {"player": False, "ai": False}
                tribute = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(tribute_id, attribute=matching_attribute),
                )
                target = put(
                    state,
                    "player",
                    "hand",
                    new_card(
                        f"level-seven-{matching_attribute}",
                        level=7,
                        attribute=matching_attribute,
                    ),
                )
                action = {
                    "type": "summon",
                    "instance_id": target["instance_id"],
                    "zone_index": 0,
                    "tribute_instance_ids": [tribute["instance_id"]],
                }

                result = DuelActionEngine(self.engine).apply(
                    state, player="player", action=action
                )
                self.assertEqual(
                    result["players"]["player"]["monster_zone"][0]["instance_id"],
                    target["instance_id"],
                )

                invalid_state = new_state()
                invalid_state["normal_summon_used"] = {"player": False, "ai": False}
                invalid_tribute = put(
                    invalid_state,
                    "player",
                    "monster_zone",
                    new_card(tribute_id, attribute=matching_attribute),
                )
                invalid_target = put(
                    invalid_state,
                    "player",
                    "hand",
                    new_card(
                        f"wrong-attribute-{wrong_attribute}",
                        level=7,
                        attribute=wrong_attribute,
                    ),
                )
                with self.assertRaises(DuelRuleError):
                    DuelActionEngine(self.engine).apply(
                        invalid_state,
                        player="player",
                        action={
                            "type": "summon",
                            "instance_id": invalid_target["instance_id"],
                            "zone_index": 0,
                            "tribute_instance_ids": [
                                invalid_tribute["instance_id"]
                            ],
                        },
                    )

    def test_double_tribute_monster_can_be_used_as_one_tribute_for_level_five(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        seahorse = put(
            state,
            "player",
            "monster_zone",
            new_card("m-kaiser-seahorse", attribute="LIGHT"),
        )
        target = put(
            state,
            "player",
            "hand",
            new_card("light-level-five", level=5, attribute="LIGHT"),
        )

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": target["instance_id"],
                "zone_index": 0,
                "tribute_instance_ids": [seahorse["instance_id"]],
            },
        )

        self.assertEqual(
            result["players"]["player"]["monster_zone"][0]["instance_id"],
            target["instance_id"],
        )

    def test_graceful_charity_waits_for_exact_discard_choice(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-graceful-charity", "spell"))
        for card_id in ("one", "two", "three"):
            put(state, "player", "deck", new_card(card_id))

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertEqual(state["pending_decision"]["count"], 2)
        hand = state["players"]["player"]["hand"]
        complete_pending_discard(
            state,
            "player",
            [hand[0]["instance_id"], hand[1]["instance_id"]],
        )
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(len(state["players"]["player"]["graveyard"]), 3)
        self.assertNotIn(spell, state["players"]["player"]["spell_trap_zone"])

    def test_graceful_charity_rejects_non_string_discard_ids(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-graceful-charity", "spell"))
        for card_id in ("one", "two", "three"):
            put(state, "player", "deck", new_card(card_id))
        state = activate_and_resolve(self.engine, state, "player", spell)
        hand = state["players"]["player"]["hand"]

        with self.assertRaises(DuelRuleError):
            complete_pending_discard(
                state,
                "player",
                [[hand[0]["instance_id"]], hand[1]["instance_id"]],
            )

        self.assertEqual(state["pending_decision"]["count"], 2)

    def test_tricky_special_summons_after_discarding_another_hand_card(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tricky = put(state, "player", "hand", new_card("m-the-tricky"))
        cost = put(state, "player", "hand", new_card("discard-cost", "spell"))

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "begin_tricky_summon",
                "source_instance_id": tricky["instance_id"],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "tricky_discard")
        self.assertEqual(state["pending_decision"]["count"], 1)

        with self.assertRaises(DuelRuleError):
            DuelActionEngine(self.engine).apply(
                state,
                player="player",
                action={
                    "type": "complete_discard",
                    "instance_ids": [tricky["instance_id"]],
                },
            )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "complete_discard",
                "instance_ids": [cost["instance_id"]],
            },
        )

        summoned = state["players"]["player"]["monster_zone"][0]
        self.assertEqual(summoned["instance_id"], tricky["instance_id"])
        self.assertEqual(summoned["summon_method"], "special")
        self.assertEqual(summoned["position"], "attack")
        self.assertEqual(find_card(state, cost["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])
        self.assertFalse(state["normal_summon_used"]["player"])

    def test_tricky_requires_main_phase_a_discard_and_an_open_monster_zone(self):
        state = new_state()
        tricky = put(state, "player", "hand", new_card("m-the-tricky"))
        action = {
            "type": "begin_tricky_summon",
            "source_instance_id": tricky["instance_id"],
        }
        engine = DuelActionEngine(self.engine)

        with self.assertRaises(DuelRuleError):
            engine.apply(state, player="player", action=action)

        put(state, "player", "hand", new_card("discard-cost", "spell"))
        for index in range(5):
            put(state, "player", "monster_zone", new_card(f"field-{index}"))
        with self.assertRaises(DuelRuleError):
            engine.apply(state, player="player", action=action)

        state["players"]["player"]["monster_zone"][0] = None
        state["phase"] = "battle"
        with self.assertRaises(DuelRuleError):
            engine.apply(state, player="player", action=action)

    def test_dark_magic_curtain_summons_without_inventing_an_lp_cost(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-dark-magic-curtain", "spell"))
        put(state, "player", "deck", new_card("m-dark-magician", level=7))

        state = activate_and_resolve(self.engine, state, "player", spell)

        monster = state["players"]["player"]["monster_zone"][0]
        self.assertEqual(monster["card_id"], "m-dark-magician")
        self.assertEqual(state["players"]["player"]["lp"], 8000)

    def test_card_destruction_discards_both_hands_and_draws_each_count(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-card-destruction", "spell"))
        put(state, "player", "hand", new_card("player-old"))
        put(state, "ai", "hand", new_card("ai-old", owner="ai"))
        put(state, "player", "deck", new_card("player-new"))
        put(state, "ai", "deck", new_card("ai-new", owner="ai"))

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertEqual(state["players"]["player"]["hand"][0]["card_id"], "player-new")
        self.assertEqual(state["players"]["ai"]["hand"][0]["card_id"], "ai-new")
        self.assertEqual(state["players"]["player"]["graveyard"][0]["card_id"], "player-old")
        self.assertEqual(state["players"]["ai"]["graveyard"][0]["card_id"], "ai-old")

    def test_draw_of_fifth_exodia_piece_wins_immediately(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        opp_mon = put(state, "ai", "monster_zone", new_card("opp-mon", owner="ai"))
        opp_st = put(state, "ai", "spell_trap_zone", new_card("opp-st", "trap", owner="ai", face_down=True))
        for card_id in EXODIA_IDS[1:]:
            put(state, "player", "hand", new_card(card_id))
        put(state, "player", "deck", new_card("filler"))
        put(state, "player", "deck", new_card(EXODIA_IDS[0]))

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertTrue(check_win_by_exodia(state, "player"))
        self.assertEqual(state["winner"], "player")
        self.assertEqual(state["exodia_winner"], "player")
        self.assertEqual(state["players"]["ai"]["lp"], 0)
        self.assertTrue(all(card is None for card in state["players"]["ai"]["monster_zone"]))
        self.assertTrue(all(card is None for card in state["players"]["ai"]["spell_trap_zone"]))
        self.assertEqual(find_card(state, opp_mon["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, opp_st["instance_id"])[1], "graveyard")

    def test_draw_failure_ends_duel_by_deck_out(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        put(state, "player", "deck", new_card("last-card"))

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertTrue(state["over"])
        self.assertEqual(state["winner"], "ai")

    def test_negated_normal_spell_is_sent_to_its_owners_graveyard(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-negated", "spell"))
        registry = EffectRegistry()
        registry.register(
            EffectDefinition(
                card_id="s-negated",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=lambda _state, _context: None,
                source_zones=frozenset({"hand"}),
                phases=frozenset({"main1"}),
                move_source_on_activation=True,
            )
        )
        engine = DuelEffectEngine(registry)

        state = engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
        )
        state["chain"]["links"][0]["negated"] = True
        while state["chain"]["status"] == "open":
            state = engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            spell["instance_id"],
        )

    def test_cost_down_and_dice_of_destiny_apply_their_effects(self):
        state = new_state()
        cost_down = put(state, "player", "hand", new_card("s-cost-down", "spell"))
        monster = put(state, "player", "hand", new_card("level-eight", level=8))
        spell = put(state, "player", "hand", new_card("s-dice-of-destiny", "spell"))
        for index in range(6):
            put(state, "player", "deck", new_card(f"draw-{index}"))
        state = activate_and_resolve(self.engine, state, "player", cost_down)

        monster_after = next(
            card
            for card in state["players"]["player"]["hand"]
            if card["card_id"] == "level-eight"
        )
        self.assertEqual(monster_after["level"], 6)

        state["phase"] = "main1"
        state = activate_and_resolve(self.engine, state, "player", spell)
        self.assertEqual(len(state["players"]["player"]["hand"]), 5)

    def test_graceful_dice_boosts_only_its_controller_until_turn_end(self):
        state = new_state()
        engine = DuelEffectEngine(build_effect_registry(random_source=lambda: 0.2))
        spell = put(state, "player", "hand", new_card("s-graceful-dice", "spell"))
        friendly = put(state, "player", "monster_zone", new_card("friendly"))
        opponent = put(state, "ai", "monster_zone", new_card("opponent", owner="ai"))

        state = activate_and_resolve(engine, state, "player", spell)

        self.assertEqual(current_stats(state, friendly["instance_id"]), {"atk": 2000, "def": 1600})
        self.assertEqual(current_stats(state, opponent["instance_id"]), {"atk": 1000, "def": 800})
        state = expire_effects(state, "turn_end", player="player", turn=1)
        self.assertEqual(current_stats(state, friendly["instance_id"]), {"atk": 1000, "def": 800})

    def test_skull_dice_reduces_opponent_stats_and_goes_to_graveyard(self):
        state = new_state()
        engine = DuelEffectEngine(build_effect_registry(random_source=lambda: 0.2))
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-skull-dice", "trap", face_down=True, set_turn=0),
        )
        opponent = put(state, "ai", "monster_zone", new_card("opponent", owner="ai"))
        friendly = put(state, "player", "monster_zone", new_card("friendly"))

        state = activate_and_resolve(engine, state, "player", trap)

        self.assertEqual(current_stats(state, opponent["instance_id"]), {"atk": 500, "def": 400})
        self.assertEqual(current_stats(state, friendly["instance_id"]), {"atk": 1000, "def": 800})
        self.assertEqual(state["players"]["player"]["graveyard"][0]["instance_id"], trap["instance_id"])
        state = expire_effects(state, "turn_end", player="player", turn=1)
        self.assertEqual(current_stats(state, opponent["instance_id"]), {"atk": 1000, "def": 800})

    def test_swords_reveals_set_monsters_and_remains_face_up(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-swords-of-revealing-light", "spell"))
        monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("set-monster", owner="ai", face_down=True),
        )

        state = activate_and_resolve(self.engine, state, "player", spell)

        monster_after = state["players"]["ai"]["monster_zone"][0]
        self.assertFalse(monster_after["face_down"])
        self.assertEqual(monster_after["position"], "defense")
        self.assertIsNotNone(
            next(
                card
                for card in state["players"]["player"]["spell_trap_zone"]
                if card and card["card_id"] == "s-swords-of-revealing-light"
            )
        )
        for _ in range(3):
            resolve_end_phase_effects(state, "ai")
        self.assertTrue(
            any(
                card["card_id"] == "s-swords-of-revealing-light"
                for card in state["players"]["player"]["graveyard"]
            )
        )

    def test_swords_reveals_monsters_set_after_activation(self):
        state = new_state()
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "s-swords-of-revealing-light",
                "spell",
                owner="player",
                face_down=False,
            ),
        )
        monster = put(
            state,
            "ai",
            "hand",
            new_card("late-set-monster", owner="ai"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="ai",
            action={
                "type": "set_card",
                "instance_id": monster["instance_id"],
                "zone_index": 0,
            },
        )

        set_monster = state["players"]["ai"]["monster_zone"][0]
        self.assertFalse(set_monster["face_down"])
        self.assertEqual(set_monster["position"], "defense")

    def test_monster_reborn_summons_from_either_graveyard(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-monster-reborn", "spell"))
        target = put(state, "ai", "graveyard", new_card("enemy", owner="ai"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(target["instance_id"],),
        )

        self.assertEqual(state["players"]["player"]["monster_zone"][0]["card_id"], "enemy")
        self.assertEqual(state["players"]["ai"]["graveyard"], [])

    def test_monster_reborn_revived_monster_can_switch_from_attack_to_defense(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-monster-reborn", "spell"))
        target = put(state, "player", "graveyard", new_card("m-dark-magician", "monster"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(target["instance_id"],),
        )
        revived = state["players"]["player"]["monster_zone"][0]
        self.assertEqual(revived["position"], "attack")

        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "change_position",
                "instance_id": revived["instance_id"],
            },
        )
        self.assertEqual(state["players"]["player"]["monster_zone"][0]["position"], "defense")

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "change_position",
                    "instance_id": revived["instance_id"],
                },
            )

    def test_return_of_dragon_lords_revives_only_its_controller_dragon_level_7_or_8(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-return-of-the-dragon-lords", "spell"))
        dragon = put(
            state,
            "player",
            "graveyard",
            new_card("dragon-level-eight", level=8, race="Dragon"),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(dragon["instance_id"],),
        )

        self.assertEqual(
            state["players"]["player"]["monster_zone"][0]["card_id"],
            "dragon-level-eight",
        )
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            spell["instance_id"],
        )

    def test_return_of_dragon_lords_replaces_a_dragon_destruction(self):
        state = new_state()
        protection = put(
            state,
            "player",
            "graveyard",
            new_card("s-return-of-the-dragon-lords", "spell"),
        )
        dragon = put(
            state,
            "player",
            "monster_zone",
            new_card("dragon", race="Dragon"),
        )

        result = destroy_card(
            state,
            dragon["instance_id"],
            by_player="ai",
        )

        self.assertIsNone(result)
        self.assertEqual(
            state["players"]["player"]["monster_zone"][0]["instance_id"],
            dragon["instance_id"],
        )
        self.assertEqual(
            state["players"]["player"]["banished"][0]["instance_id"],
            protection["instance_id"],
        )

    def test_bond_graveyard_effect_protects_only_its_named_monsters(self):
        state = new_state()
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        bond = put(
            state,
            "player",
            "graveyard",
            new_card("s-bond-between-teacher-and-student", "spell"),
        )
        dark_magician = put(
            state,
            "player",
            "monster_zone",
            new_card("m-dark-magician"),
        )
        other_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("other-monster"),
            index=1,
        )
        raigeki = put(state, "ai", "hand", new_card("s-raigeki", "spell", owner="ai"))
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=raigeki["instance_id"],
            effect_id="activate",
        )
        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=bond["instance_id"],
            effect_id="graveyard-protection",
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        field_ids = {
            monster["instance_id"]
            for monster in state["players"]["player"]["monster_zone"]
            if monster
        }
        self.assertIn(dark_magician["instance_id"], field_ids)
        self.assertNotIn(other_monster["instance_id"], field_ids)
        self.assertEqual(
            state["players"]["player"]["banished"][0]["instance_id"],
            bond["instance_id"],
        )

    def test_flute_and_wingbeat_apply_dragon_summon_and_backrow_cost(self):
        state = new_state()
        flute = put(
            state,
            "player",
            "hand",
            new_card("s-the-flute-of-summoning-dragon", "spell"),
        )
        lord_of_d = put(
            state, "player", "monster_zone", new_card("m-lord-of-d")
        )
        first_dragon = put(state, "player", "hand", new_card("dragon-one", race="Dragon"))
        second_dragon = put(state, "player", "hand", new_card("dragon-two", race="Rồng"))
        third_dragon = put(state, "player", "hand", new_card("dragon-three", race="Dragon"))
        state = activate_and_resolve(self.engine, state, "player", flute)
        summoned_ids = {
            monster["instance_id"]
            for monster in state["players"]["player"]["monster_zone"]
            if monster
        }
        self.assertIn(first_dragon["instance_id"], summoned_ids)
        self.assertIn(second_dragon["instance_id"], summoned_ids)
        self.assertNotIn(third_dragon["instance_id"], summoned_ids)

        wingbeat = put(
            state,
            "player",
            "hand",
            new_card("s-a-wingbeat-of-giant-dragon", "spell"),
        )
        own_dragon = put(
            state,
            "player",
            "monster_zone",
            new_card("large-dragon", race="Dragon", level=5),
        )
        put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("enemy-backrow", "spell", owner="ai"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=wingbeat["instance_id"],
                effect_id="activate",
                target_instance_ids=(own_dragon["instance_id"],),
            )

        destroy_card(state, lord_of_d["instance_id"])
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            wingbeat,
            targets=(own_dragon["instance_id"],),
        )
        self.assertTrue(
            any(
                card["instance_id"] == own_dragon["instance_id"]
                for card in state["players"]["player"]["hand"]
            )
        )
        self.assertEqual(state["players"]["ai"]["graveyard"][0]["card_id"], "enemy-backrow")

    def test_change_of_heart_returns_control_at_end_phase(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-change-of-heart", "spell"))
        target = put(state, "ai", "monster_zone", new_card("enemy", owner="ai"), index=2)

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(target["instance_id"],),
        )
        borrowed = state["players"]["player"]["monster_zone"][0]
        self.assertEqual(borrowed["temporary_control"]["return_to"], "ai")

        resolve_end_phase_effects(state, "player")

        returned = state["players"]["ai"]["monster_zone"][2]
        self.assertEqual(returned["instance_id"], target["instance_id"])
        self.assertNotIn("temporary_control", returned)

    def test_brain_control_cannot_activate_without_a_valid_face_up_opponent_monster(self):
        for opponent_monster in (None, new_card("hidden-enemy", owner="ai", face_down=True)):
            with self.subTest(opponent_monster=opponent_monster):
                state = new_state()
                spell = put(
                    state,
                    "player",
                    "hand",
                    new_card("s-brain-control", "spell"),
                )
                if opponent_monster:
                    put(state, "ai", "monster_zone", opponent_monster)

                with self.assertRaisesRegex(DuelRuleError, "Tẩy Não"):
                    self.engine.activate(
                        state,
                        player="player",
                        source_instance_id=spell["instance_id"],
                        effect_id="activate",
                    )

                self.assertIn(spell, state["players"]["player"]["hand"])
                self.assertEqual(state["chain"]["status"], "closed")

    def test_lord_of_d_prevents_both_players_targeting_face_up_dragons(self):
        for controller in ("player", "ai"):
            with self.subTest(controller=controller):
                state = new_state()
                put(
                    state,
                    controller,
                    "monster_zone",
                    new_card("m-lord-of-d", owner=controller),
                )
                dragon = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card("dragon", owner="ai", race="Rồng"),
                    index=1,
                )
                spell = put(
                    state,
                    "player",
                    "hand",
                    new_card("s-change-of-heart", "spell"),
                )

                with self.assertRaises(DuelRuleError):
                    self.engine.activate(
                        state,
                        player="player",
                        source_instance_id=spell["instance_id"],
                        effect_id="activate",
                        target_instance_ids=(dragon["instance_id"],),
                    )

                self.assertIn(spell, state["players"]["player"]["hand"])
                self.assertIs(
                    state["players"]["ai"]["monster_zone"][1], dragon
                )

    def test_lord_of_d_does_not_protect_dragons_in_the_graveyard(self):
        state = new_state()
        put(state, "ai", "monster_zone", new_card("m-lord-of-d", owner="ai"))
        dragon = put(
            state,
            "ai",
            "graveyard",
            new_card("dragon", owner="ai", race="Rồng"),
        )
        spell = put(state, "player", "hand", new_card("s-monster-reborn", "spell"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(dragon["instance_id"],),
        )

        self.assertIn(
            dragon["instance_id"],
            {
                card["instance_id"]
                for card in state["players"]["player"]["monster_zone"]
                if card
            },
        )

    def test_face_down_lord_of_d_does_not_prevent_targeting_dragons(self):
        state = new_state()
        put(
            state,
            "player",
            "monster_zone",
            new_card("m-lord-of-d", face_down=True),
        )
        dragon = put(
            state,
            "ai",
            "monster_zone",
            new_card("dragon", owner="ai", race="Rồng"),
        )
        spell = put(state, "player", "hand", new_card("s-change-of-heart", "spell"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(dragon["instance_id"],),
        )

        self.assertIn(
            dragon["instance_id"],
            {
                card["instance_id"]
                for card in state["players"]["player"]["monster_zone"]
                if card
            },
        )

    def test_white_stone_battle_destruction_can_summon_blue_eyes_from_hand_or_deck(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        stone = put(
            state,
            "player",
            "monster_zone",
            new_card("m-the-white-stone-of-ancients", atk=600, **{"def": 500}),
        )
        opponent = put(
            state,
            "ai",
            "monster_zone",
            new_card("battle-opponent", owner="ai", atk=1000),
        )
        deck_blue_eyes = put(
            state,
            "player",
            "deck",
            new_card("m-blue-eyes-white-dragon"),
        )
        hand_blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": stone["instance_id"],
                "defender_instance_id": opponent["instance_id"],
            },
        )

        self.assertEqual(
            state["pending_decision"]["target_mode"],
            "deck-or-hand-blue-eyes-summon",
        )
        self.assertEqual(
            set(state["pending_decision"]["eligible_target_instance_ids"]),
            {deck_blue_eyes["instance_id"], hand_blue_eyes["instance_id"]},
        )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [deck_blue_eyes["instance_id"]],
            },
        )

        summoned = find_card(state, deck_blue_eyes["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertEqual(
            state["effect_uses"]["player:m-the-white-stone-of-ancients"],
            state["turn"],
        )
        self.assertEqual(find_card(state, hand_blue_eyes["instance_id"])[1], "hand")

    def test_white_stone_does_not_trigger_when_destroyed_by_effect(self):
        state = new_state()
        stone = put(
            state,
            "player",
            "monster_zone",
            new_card("m-the-white-stone-of-ancients"),
        )

        destroy_card(state, stone["instance_id"], by_player="ai")
        DuelActionEngine(self.engine)._resolve_pending_card_triggers(state)

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(state.get("pending_card_triggers", []), [])

    def test_white_stone_optional_battle_effect_can_be_skipped_without_using_it(self):
        state = new_state()
        stone = put(
            state,
            "player",
            "graveyard",
            new_card("m-the-white-stone-of-ancients"),
        )
        blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        state["pending_decision"] = {
            "type": "select_deck_card",
            "player": "player",
            "source_instance_id": stone["instance_id"],
            "effect_card_id": "m-the-white-stone-of-ancients",
            "min_count": 0,
            "max_count": 1,
            "target_mode": "deck-or-hand-blue-eyes-summon",
            "eligible_target_instance_ids": [blue_eyes["instance_id"]],
        }

        complete_pending_card_selection(state, "player", [])

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "hand")
        self.assertNotIn(
            "player:m-the-white-stone-of-ancients",
            state.get("effect_uses", {}),
        )

    def test_ai_white_stone_battle_effect_summons_blue_eyes_automatically(self):
        state = new_state()
        stone = put(
            state,
            "ai",
            "graveyard",
            new_card("m-the-white-stone-of-ancients", owner="ai"),
        )
        blue_eyes = put(
            state,
            "ai",
            "deck",
            new_card("m-blue-eyes-white-dragon", owner="ai"),
        )
        state["pending_card_triggers"] = [
            {
                "card_id": "m-the-white-stone-of-ancients",
                "source_instance_id": stone["instance_id"],
                "player": "ai",
            }
        ]

        DuelActionEngine(self.engine)._resolve_pending_card_triggers(state)

        summoned = find_card(state, blue_eyes["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertEqual(
            state["effect_uses"]["ai:m-the-white-stone-of-ancients"],
            state["turn"],
        )

    def test_white_stone_grave_effect_banishes_source_and_recovers_only_blue_eyes(self):
        state = new_state()
        stone = put(
            state,
            "player",
            "graveyard",
            new_card("m-the-white-stone-of-ancients"),
        )
        blue_eyes = put(
            state,
            "player",
            "graveyard",
            new_card("m-blue-eyes-white-dragon"),
        )
        other_dragon = put(
            state,
            "player",
            "graveyard",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=stone["instance_id"],
            effect_id="grave_recover",
            target_instance_ids=(blue_eyes["instance_id"],),
        )

        self.assertEqual(find_card(state, stone["instance_id"])[1], "banished")
        state = resolve_action_chain(DuelActionEngine(self.engine), state)

        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "hand")
        self.assertEqual(find_card(state, other_dragon["instance_id"])[1], "graveyard")
        self.assertEqual(
            state["effect_uses"]["player:m-the-white-stone-of-ancients"],
            state["turn"],
        )

        second_stone = put(
            state,
            "player",
            "graveyard",
            new_card("m-the-white-stone-of-ancients"),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=second_stone["instance_id"],
                effect_id="grave_recover",
                target_instance_ids=(other_dragon["instance_id"],),
            )

    def test_white_stone_grave_effect_requires_main_phase_and_exact_blue_eyes_target(self):
        state = new_state()
        stone = put(
            state,
            "player",
            "graveyard",
            new_card("m-the-white-stone-of-ancients"),
        )
        blue_eyes_alternative = put(
            state,
            "player",
            "graveyard",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                {**state, "phase": "battle"},
                player="player",
                source_instance_id=stone["instance_id"],
                effect_id="grave_recover",
                target_instance_ids=(blue_eyes_alternative["instance_id"],),
            )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=stone["instance_id"],
                effect_id="grave_recover",
                target_instance_ids=(blue_eyes_alternative["instance_id"],),
            )

    def test_night_assailant_flip_effect_destroys_selected_opponent_monster(self):
        state = new_state()
        night_assailant = put(
            state,
            "player",
            "monster_zone",
            new_card("m-night-assailant", atk=200, **{"def": 500}),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        resolve_monster_summon_effects(
            state,
            "player",
            night_assailant["instance_id"],
            "flip",
        )
        self.assertEqual(state["pending_decision"]["type"], "select_field_cards")

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [opponent_monster["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, opponent_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, night_assailant["instance_id"])[1], "monster_zone")
        self.assertIsNone(state["pending_decision"])

    def test_night_assailant_flip_effect_works_when_attacked_face_down(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("battle-attacker", owner="ai", atk=2000),
        )
        night_assailant = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-night-assailant",
                atk=200,
                **{"def": 500, "face_down": True, "position": "defense"},
            ),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": night_assailant["instance_id"],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "select_field_cards")

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [attacker["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, attacker["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, night_assailant["instance_id"])[1], "monster_zone")
        self.assertIsNone(state.get("pending_battle"))

    def test_night_assailant_destroyed_by_battle_keeps_selected_flip_effect(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("battle-attacker", owner="ai", atk=2000),
        )
        other_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("other-attacker", owner="ai", atk=1000),
        )
        night_assailant = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-night-assailant",
                atk=200,
                **{"def": 500, "face_down": True, "position": "defense"},
            ),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": night_assailant["instance_id"],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "select_field_cards")

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [other_monster["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, other_monster["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, night_assailant["instance_id"])[1], "graveyard")
        self.assertIsNone(state.get("pending_battle"))

    def test_night_assailant_grave_effect_returns_any_own_card_and_rejects_opponent_card(self):
        state = new_state()
        night_assailant = put(
            state,
            "player",
            "monster_zone",
            new_card("m-night-assailant"),
        )
        own_spell = put(
            state,
            "player",
            "graveyard",
            new_card("s-recoverable-spell", "spell"),
        )
        opponent_card = put(
            state,
            "ai",
            "graveyard",
            new_card("opponent-grave-card", "spell", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        destroy_card(state, night_assailant["instance_id"], by_player="ai")
        actions._resolve_pending_card_triggers(state)

        pending = state["pending_decision"]
        self.assertEqual(pending["type"], "select_graveyard_card")
        self.assertEqual(pending["target_mode"], "grave-own-any")
        self.assertEqual(
            pending["eligible_target_instance_ids"],
            [own_spell["instance_id"]],
        )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [opponent_card["instance_id"]],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [own_spell["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, own_spell["instance_id"])[1], "hand")
        self.assertEqual(find_card(state, night_assailant["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])

    def test_ai_night_assailant_grave_effect_can_win_by_exodia(self):
        state = new_state()
        night_assailant = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-night-assailant", owner="ai"),
        )
        for card_id in EXODIA_IDS[:-1]:
            put(state, "ai", "hand", new_card(card_id, owner="ai"))
        exodia_piece = put(
            state,
            "ai",
            "graveyard",
            new_card(EXODIA_IDS[-1], owner="ai"),
        )

        destroy_card(state, night_assailant["instance_id"], by_player="player")
        DuelActionEngine(self.engine)._resolve_pending_card_triggers(state)

        self.assertEqual(find_card(state, exodia_piece["instance_id"])[1], "hand")
        self.assertTrue(state["over"])
        self.assertEqual(state["winner"], "ai")

    def test_night_assailant_grave_effect_does_not_trigger_when_banished(self):
        state = new_state()
        night_assailant = put(
            state,
            "player",
            "monster_zone",
            new_card("m-night-assailant"),
        )

        destroy_card(
            state,
            night_assailant["instance_id"],
            by_player="ai",
            destination_zone="banished",
        )
        DuelActionEngine(self.engine)._resolve_pending_card_triggers(state)

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(state.get("pending_card_triggers", []), [])

    def test_maiden_quick_effect_negates_targeting_effect_and_summons_blue_eyes(self):
        state = new_state()
        maiden = put(
            state,
            "player",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", atk=0, **{"def": 0}),
        )
        opponent_effect = put(
            state,
            "ai",
            "hand",
            new_card("test-maiden-targeting-effect", "spell", owner="ai"),
        )
        blue_eyes = put(
            state,
            "player",
            "deck",
            new_card("m-blue-eyes-white-dragon"),
        )
        self.engine.registry.register(
            EffectDefinition(
                card_id="test-maiden-targeting-effect",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=lambda current_state, _context: current_state.update(
                    {"test_targeting_effect_resolved": True}
                ),
                target_is_valid=lambda _state, target_id, _context: (
                    target_id == maiden["instance_id"]
                ),
                source_zones=frozenset({"hand"}),
                requires_target=True,
                can_chain=True,
            )
        )
        state["chain"] = {
            "status": "open",
            "links": [
                {
                    "player": "ai",
                    "source_instance_id": opponent_effect["instance_id"],
                    "card_id": "test-maiden-targeting-effect",
                    "effect_id": "activate",
                    "target_instance_ids": [maiden["instance_id"]],
                    "payload": {},
                    "speed": 1,
                    "negated": False,
                }
            ],
            "priority_player": "player",
            "consecutive_passes": 0,
        }

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=maiden["instance_id"],
            effect_id="quick_summon",
        )
        self.assertFalse(state["chain"]["links"][0]["negated"])
        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")

        self.assertNotIn("test_targeting_effect_resolved", state)
        self.assertEqual(
            state["pending_decision"]["type"],
            "select_blue_eyes_summon",
        )
        self.assertEqual(state["pending_decision"]["min_count"], 1)
        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [blue_eyes["instance_id"]],
            },
        )
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "monster_zone")
        self.assertEqual(
            state["effect_uses"]["player:m-maiden-with-eyes-of-blue"],
            state["turn"],
        )

    def test_maiden_quick_effect_cannot_respond_to_its_controller_targeting_it(self):
        state = new_state()
        maiden = put(
            state,
            "player",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", atk=0, **{"def": 0}),
        )
        blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        own_effect = put(
            state,
            "player",
            "hand",
            new_card("test-maiden-own-targeting-effect", "spell"),
        )
        state["chain"] = {
            "status": "open",
            "links": [
                {
                    "player": "player",
                    "source_instance_id": own_effect["instance_id"],
                    "card_id": "test-maiden-own-targeting-effect",
                    "effect_id": "activate",
                    "target_instance_ids": [maiden["instance_id"]],
                    "payload": {},
                    "speed": 1,
                    "negated": False,
                }
            ],
            "priority_player": "player",
            "consecutive_passes": 0,
        }

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=maiden["instance_id"],
                effect_id="quick_summon",
            )
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "hand")

    def test_maiden_attack_effect_negates_attack_changes_position_and_can_summon(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("battle-attacker", owner="ai", atk=2000),
        )
        maiden = put(
            state,
            "player",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", atk=0, **{"def": 0}),
        )
        blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": maiden["instance_id"],
            },
        )
        self.assertEqual(state["pending_decision"]["type"], "maiden_attack")

        state = actions.apply(
            state,
            player="player",
            action={"type": "maiden_attack_effect"},
        )
        self.assertEqual(find_card(state, maiden["instance_id"])[3]["position"], "defense")
        self.assertEqual(
            state["pending_decision"]["type"],
            "select_blue_eyes_summon",
        )
        self.assertEqual(state["pending_decision"]["min_count"], 1)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [blue_eyes["instance_id"]],
            },
        )

        self.assertIsNone(state.get("pending_battle"))
        self.assertEqual(find_card(state, attacker["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, maiden["instance_id"])[3]["position"], "defense")
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "monster_zone")
        self.assertIn(attacker["instance_id"], state["attacked"]["ai"])
        self.assertEqual(
            state["effect_uses"]["player:m-maiden-with-eyes-of-blue"],
            state["turn"],
        )

    def test_maiden_attack_effect_is_unavailable_without_a_summonable_blue_eyes(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("battle-attacker", owner="ai", atk=2000),
        )
        maiden = put(
            state,
            "player",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", atk=0, **{"def": 0}),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": maiden["instance_id"],
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertIsNone(state.get("pending_battle"))
        self.assertEqual(find_card(state, maiden["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, attacker["instance_id"])[1], "monster_zone")

    def test_ai_maiden_responds_to_targeting_effect_and_summons_blue_eyes(self):
        state = new_state()
        maiden = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", owner="ai", atk=0, **{"def": 0}),
        )
        opponent_effect = put(
            state,
            "player",
            "hand",
            new_card("test-maiden-targeting-effect", "spell"),
        )
        blue_eyes = put(
            state,
            "ai",
            "hand",
            new_card("m-blue-eyes-white-dragon", owner="ai"),
        )
        self.engine.registry.register(
            EffectDefinition(
                card_id="test-maiden-targeting-effect",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=lambda _state, _context: None,
                source_zones=frozenset({"hand"}),
                requires_target=True,
                can_chain=True,
            )
        )
        state["chain"] = {
            "status": "open",
            "links": [
                {
                    "player": "player",
                    "source_instance_id": opponent_effect["instance_id"],
                    "card_id": "test-maiden-targeting-effect",
                    "effect_id": "activate",
                    "target_instance_ids": [maiden["instance_id"]],
                    "payload": {},
                    "speed": 1,
                    "negated": False,
                }
            ],
            "priority_player": "ai",
            "consecutive_passes": 0,
        }

        actions = DuelActionEngine(self.engine)
        state = actions._pass_ai_priority(state)
        self.assertEqual(state["chain"]["links"][-1]["effect_id"], "quick_summon")
        state = self.engine.pass_priority(state, player="player")
        state = self.engine.pass_priority(state, player="ai")

        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "monster_zone")
        self.assertIsNone(state.get("pending_decision"))
        self.assertEqual(
            state["effect_uses"]["ai:m-maiden-with-eyes-of-blue"],
            state["turn"],
        )

    def test_ai_maiden_automatically_uses_attack_effect(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("battle-attacker", atk=2000),
        )
        maiden = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", owner="ai", atk=0, **{"def": 0}),
        )
        blue_eyes = put(
            state,
            "ai",
            "deck",
            new_card("m-blue-eyes-white-dragon", owner="ai"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": maiden["instance_id"],
            },
        )

        self.assertIsNone(state.get("pending_decision"))
        self.assertEqual(find_card(state, maiden["instance_id"])[3]["position"], "defense")
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "monster_zone")
        self.assertIn(attacker["instance_id"], state["attacked"]["player"])

    def test_blue_eyes_attacking_ai_maiden_auto_triggers_attack_effect(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        blue_eyes = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-white-dragon", atk=3000, **{"def": 2500}),
        )
        maiden = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-maiden-with-eyes-of-blue", owner="ai", atk=0, **{"def": 0}),
        )
        summoned_blue_eyes = put(
            state,
            "ai",
            "deck",
            new_card("m-blue-eyes-white-dragon", owner="ai"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": blue_eyes["instance_id"],
                "defender_instance_id": maiden["instance_id"],
            },
        )

        self.assertIsNone(state.get("pending_decision"))
        self.assertEqual(find_card(state, maiden["instance_id"])[3]["position"], "defense")
        self.assertEqual(find_card(state, summoned_blue_eyes["instance_id"])[1], "monster_zone")
        self.assertIn(blue_eyes["instance_id"], state["attacked"]["player"])

    def test_blue_eyes_attacking_face_down_ai_maiden_reveals_and_auto_triggers(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        blue_eyes = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-white-dragon", atk=3000, **{"def": 2500}),
        )
        maiden = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-maiden-with-eyes-of-blue",
                owner="ai",
                atk=0,
                **{"def": 0, "face_down": True, "position": "defense"},
            ),
        )
        summoned_blue_eyes = put(
            state,
            "ai",
            "deck",
            new_card("m-blue-eyes-white-dragon", owner="ai"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": blue_eyes["instance_id"],
                "defender_instance_id": maiden["instance_id"],
            },
        )

        self.assertFalse(find_card(state, maiden["instance_id"])[3]["face_down"])
        self.assertEqual(find_card(state, maiden["instance_id"])[3]["position"], "defense")
        self.assertEqual(find_card(state, summoned_blue_eyes["instance_id"])[1], "monster_zone")
        self.assertIn(blue_eyes["instance_id"], state["attacked"]["player"])

    def test_ishzark_banishes_battle_destroyed_monster_without_graveyard_trigger(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        ishzark = put(
            state,
            "player",
            "monster_zone",
            new_card("m-divine-knight-ishzark", atk=2300),
        )
        germ = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-giant-germ", owner="ai", atk=1000),
        )
        spare_germ = put(
            state, "ai", "deck", new_card("m-giant-germ", owner="ai")
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": ishzark["instance_id"],
                "defender_instance_id": germ["instance_id"],
            },
        )

        self.assertIn(
            germ["instance_id"],
            {
                card["instance_id"]
                for card in state["players"]["ai"]["banished"]
            },
        )
        self.assertNotIn(
            germ["instance_id"],
            {
                card["instance_id"]
                for card in state["players"]["ai"]["graveyard"]
            },
        )
        self.assertEqual(state["players"]["ai"]["deck"], [spare_germ])
        self.assertEqual(state["players"]["ai"]["lp"], 6700)

    def test_ishzark_banishes_an_attacker_it_destroys_in_battle(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        state["attacked"] = {"player": [], "ai": []}
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("weak-attacker", owner="ai", atk=1000),
        )
        ishzark = put(
            state,
            "player",
            "monster_zone",
            new_card("m-divine-knight-ishzark", atk=2300),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": ishzark["instance_id"],
            },
        )

        self.assertIn(
            attacker["instance_id"],
            {
                card["instance_id"]
                for card in state["players"]["ai"]["banished"]
            },
        )

    def test_robbin_goblin_discards_random_card_after_direct_battle_damage(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "main1"
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-robbin-goblin", "trap", face_down=True, set_turn=0),
        )
        state = activate_and_resolve(self.engine, state, "player", trap)
        state["turn"] = 2
        attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("attacker", atk=1800),
        )
        first_card = put(
            state,
            "ai",
            "hand",
            new_card("first-card", owner="ai"),
        )
        second_card = put(
            state,
            "ai",
            "hand",
            new_card("second-card", owner="ai"),
        )
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )

        self.assertEqual(result["players"]["ai"]["lp"], 6200)
        self.assertEqual(len(result["players"]["ai"]["hand"]), 1)
        discarded_id = result["players"]["ai"]["graveyard"][0]["instance_id"]
        self.assertIn(discarded_id, {first_card["instance_id"], second_card["instance_id"]})
        self.assertFalse(
            result["players"]["player"]["spell_trap_zone"][0]["face_down"]
        )

    def test_diffusion_wave_motion_pays_lp_destroys_and_damages(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-diffusion-wave-motion", "spell"),
        )
        caster = put(
            state,
            "player",
            "monster_zone",
            new_card("caster", race="Spellcaster", level=7),
        )
        put(state, "ai", "monster_zone", new_card("enemy-one", owner="ai", atk=1000))
        put(state, "ai", "monster_zone", new_card("enemy-two", owner="ai", atk=1200), index=1)

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(caster["instance_id"],),
        )

        self.assertEqual(state["players"]["player"]["lp"], 7000)
        self.assertEqual(state["players"]["ai"]["lp"], 6900)
        self.assertEqual(
            [card["card_id"] for card in state["players"]["ai"]["graveyard"]],
            ["enemy-one", "enemy-two"],
        )

    def test_soul_release_banishes_mixed_graveyard_targets_and_applies_lp_per_owner(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-soul-release", "spell"))
        own_monster = put(state, "player", "graveyard", new_card("own-monster"))
        own_spell = put(
            state, "player", "graveyard", new_card("own-spell", "spell")
        )
        enemy_monster = put(
            state, "ai", "graveyard", new_card("enemy-monster", owner="ai")
        )
        enemy_trap = put(
            state, "ai", "graveyard", new_card("enemy-trap", "trap", owner="ai")
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(
                own_monster["instance_id"],
                own_spell["instance_id"],
                enemy_monster["instance_id"],
                enemy_trap["instance_id"],
            ),
        )

        self.assertEqual(
            {card["instance_id"] for card in state["players"]["player"]["banished"]},
            {own_monster["instance_id"], own_spell["instance_id"]},
        )
        self.assertEqual(
            {card["instance_id"] for card in state["players"]["ai"]["banished"]},
            {enemy_monster["instance_id"], enemy_trap["instance_id"]},
        )
        self.assertEqual(state["players"]["player"]["lp"], 9000)
        self.assertEqual(state["players"]["ai"]["lp"], 7000)

    def test_soul_release_rejects_more_than_five_targets_without_consuming_spell(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-soul-release", "spell"))
        targets = [
            put(state, "player", "graveyard", new_card(f"grave-{index}"))
            for index in range(6)
        ]

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=spell["instance_id"],
                effect_id="activate",
                target_instance_ids=tuple(
                    target["instance_id"] for target in targets
                ),
            )

        self.assertIn(spell, state["players"]["player"]["hand"])
        self.assertEqual(len(state["players"]["player"]["graveyard"]), 6)

    def test_soul_absorption_triggers_only_after_its_activation_resolves(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-soul-absorption", "spell"),
        )
        before_resolution = put(
            state, "player", "hand", new_card("before-resolution")
        )

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
        )
        move_card(
            state, before_resolution["instance_id"], "player", "graveyard"
        )
        self.assertEqual(state["players"]["player"]["lp"], 8000)

        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")
        active = state["players"]["player"]["spell_trap_zone"][0]
        self.assertTrue(active["effect_active"])

        after_resolution = put(
            state, "player", "hand", new_card("after-resolution")
        )
        move_card(state, after_resolution["instance_id"], "player", "banished")
        self.assertEqual(state["players"]["player"]["lp"], 8500)

    def test_diffusion_cost_is_paid_at_activation_even_when_negated(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-diffusion-wave-motion", "spell"),
        )
        caster = put(
            state,
            "player",
            "monster_zone",
            new_card("caster", race="Spellcaster", level=7),
        )
        enemy = put(state, "ai", "monster_zone", new_card("enemy", owner="ai"))

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
            target_instance_ids=(caster["instance_id"],),
        )
        self.assertEqual(state["players"]["player"]["lp"], 7000)
        state["chain"]["links"][0]["negated"] = True
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertEqual(state["players"]["ai"]["monster_zone"][0]["instance_id"], enemy["instance_id"])
        self.assertEqual(state["players"]["ai"]["lp"], 8000)
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            spell["instance_id"],
        )

    def test_paying_all_remaining_lp_ends_duel_before_resolution(self):
        state = new_state()
        state["players"]["player"]["lp"] = 1000
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-the-melody-of-awakening-dragon", "spell"),
        )
        put(state, "player", "hand", new_card("dragon-one", race="Dragon"))
        put(state, "player", "deck", new_card("dragon-two", race="Dragon"))

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
        )

        self.assertTrue(state["over"])
        self.assertEqual(state["winner"], "ai")
        self.assertEqual(state["players"]["player"]["lp"], 0)
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            spell["instance_id"],
        )
        self.assertEqual(state["players"]["player"]["monster_zone"], [None] * 5)

    def test_compulsory_evacuation_returns_target_to_its_owner(self):
        state = new_state()
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-compulsory-evacuation-device", "trap", face_down=True),
        )
        enemy = put(state, "ai", "monster_zone", new_card("enemy", owner="ai"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(enemy["instance_id"],),
        )

        self.assertEqual(
            state["players"]["ai"]["hand"][0]["instance_id"],
            enemy["instance_id"],
        )
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

    def test_compulsory_evacuation_returns_stolen_monster_to_controller_hand_permanently(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "player", "phase": "main1"})
        change_of_heart = put(
            state,
            "player",
            "hand",
            new_card("s-change-of-heart", "spell", owner="player"),
        )
        enemy = put(
            state,
            "ai",
            "monster_zone",
            new_card("enemy", owner="ai", atk=1800, level=4),
        )
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-compulsory-evacuation-device",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=1,
            ),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            change_of_heart,
            targets=(enemy["instance_id"],),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(state, player="player", action={"type": "advance_phase"})
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": enemy["instance_id"],
                "defender_instance_id": None,
            },
        )
        state = actions.apply(state, player="player", action={"type": "pass_chain"})

        player_hand_ids = [c["instance_id"] for c in state["players"]["player"]["hand"]]
        ai_hand_ids = [c["instance_id"] for c in state["players"]["ai"]["hand"]]
        self.assertIn(enemy["instance_id"], player_hand_ids)
        self.assertNotIn(enemy["instance_id"], ai_hand_ids)
        returned = find_card(state, enemy["instance_id"])[3]
        self.assertEqual(returned["owner"], "player")
        self.assertNotIn("temporary_control", returned)

    def test_compulsory_evacuation_only_chains_on_attack_and_goes_to_graveyard(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800, level=4),
        )
        player_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("player-monster", owner="player", atk=1500, level=4),
        )
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-compulsory-evacuation-device",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=1,
            ),
        )
        mst = put(
            state,
            "player",
            "hand",
            new_card("s-mystical-space-typhoon", "spell", owner="player"),
        )
        other_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-mirror-force", "trap", owner="ai", face_down=True, set_turn=1),
        )
        state["turn_player"] = "player"

        actions = DuelActionEngine(self.engine)
        after_mst = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": mst["instance_id"],
                "target_instance_ids": [other_trap["instance_id"]],
            },
        )
        self.assertEqual(find_card(after_mst, player_monster["instance_id"])[1], "monster_zone")
        self.assertTrue(find_card(after_mst, trap["instance_id"])[3]["face_down"])

        battle_state = new_state()
        battle_state.update({"turn": 2, "turn_player": "player", "phase": "battle"})
        battle_attacker = put(
            battle_state,
            "player",
            "monster_zone",
            new_card("player-attacker", owner="player", atk=1800, level=4),
        )
        ai_trap = put(
            battle_state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-compulsory-evacuation-device",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=1,
            ),
        )
        after_attack = actions.apply(
            battle_state,
            player="player",
            action={"type": "attack", "attacker_instance_id": battle_attacker["instance_id"]},
        )
        if after_attack.get("chain", {}).get("status") == "open":
            after_attack = actions.apply(
                after_attack,
                player="player",
                action={"type": "pass_chain"},
            )
        self.assertEqual(find_card(after_attack, battle_attacker["instance_id"])[1], "hand")
        self.assertEqual(find_card(after_attack, ai_trap["instance_id"])[1], "graveyard")
        self.assertEqual(after_attack["players"]["ai"]["lp"], 8000)

    def test_waboku_protects_for_turn_without_cancelling_attack(self):
        state = new_state()
        state["phase"] = "battle"
        attacker = put(state, "ai", "monster_zone", new_card("attacker", owner="ai"))
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-waboku", "trap", face_down=True),
        )

        state = resolve_attack_trap(
            self.engine,
            state,
            attacker_player="ai",
            attacker_instance_id=attacker["instance_id"],
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertEqual(state["battle_protection"]["player"], "player")
        self.assertTrue(is_battle_protected(state, "player", attacker["instance_id"]))
        self.assertNotIn("attack_cancelled", state.get("battle", {}))
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            trap["instance_id"],
        )

    def test_negate_attack_and_scrap_iron_scarecrow_apply_their_battle_effects(self):
        for card_id in ("t-negate-attack", "t-scrap-iron-scarecrow"):
            with self.subTest(card_id=card_id):
                state = new_state()
                state["phase"] = "battle"
                attacker = put(state, "ai", "monster_zone", new_card("attacker", owner="ai"))
                trap = put(
                    state,
                    "player",
                    "spell_trap_zone",
                    new_card(card_id, "trap", face_down=True),
                )
                state = resolve_attack_trap(
                    self.engine,
                    state,
                    attacker_player="ai",
                    attacker_instance_id=attacker["instance_id"],
                )
                while state["chain"]["status"] == "open":
                    state = self.engine.pass_priority(
                        state,
                        player=state["chain"]["priority_player"],
                    )

                self.assertTrue(state["battle"]["attack_cancelled"])
                if card_id == "t-negate-attack":
                    self.assertTrue(state["battle"]["phase_ended"])
                    self.assertEqual(
                        state["players"]["player"]["graveyard"][0]["instance_id"],
                        trap["instance_id"],
                    )
                else:
                    set_trap = state["players"]["player"]["spell_trap_zone"][0]
                    self.assertEqual(set_trap["instance_id"], trap["instance_id"])
                    self.assertTrue(set_trap["face_down"])

    def test_silent_commander_ends_battle_phase_and_draws_two(self):
        state = new_state()
        state["phase"] = "battle"
        attacker = put(state, "ai", "monster_zone", new_card("attacker", owner="ai"))
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-silent-commander", "trap", face_down=True),
        )
        put(state, "player", "deck", new_card("draw-one"))
        put(state, "player", "deck", new_card("draw-two"))

        state = resolve_attack_trap(
            self.engine,
            state,
            attacker_player="ai",
            attacker_instance_id=attacker["instance_id"],
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertTrue(state["battle"]["attack_cancelled"])
        self.assertTrue(state["battle"]["phase_ended"])
        self.assertEqual(len(state["players"]["player"]["hand"]), 2)
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            trap["instance_id"],
        )

    def test_ring_of_destruction_triggers_only_on_opponent_attack_and_burns_opponent_lp(self):
        state = new_state()
        state["turn"] = 2
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-ring-of-destruction", "trap", face_down=True, set_turn=1),
        )
        attacker_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("enemy", owner="ai", atk=2400),
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=trap["instance_id"],
                effect_id="activate",
                target_instance_ids=(attacker_monster["instance_id"],),
            )

        state["phase"] = "battle"
        state["pending_battle"] = {
            "attacker_player": "ai",
            "attacker_instance_id": attacker_monster["instance_id"],
            "defender_instance_id": None,
        }
        state = resolve_attack_trap(
            self.engine,
            state,
            attacker_player="ai",
            attacker_instance_id=attacker_monster["instance_id"],
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(
                state, player=state["chain"]["priority_player"]
            )
        self.assertEqual(
            find_card(state, attacker_monster["instance_id"])[1],
            "graveyard",
        )
        self.assertIn(
            attacker_monster["instance_id"],
            [card["instance_id"] for card in state["players"]["ai"]["graveyard"]],
        )
        self.assertEqual(state["players"]["ai"]["lp"], 5600)
        self.assertEqual(state["players"]["player"]["lp"], 8000)

    def test_morphing_jar_flips_face_up_in_ai_reveal_stage_before_effect_and_destruction(self):
        from duel.duel_actions import DuelActionEngine

        engine = DuelActionEngine(self.engine)
        state = new_state()
        state["turn"] = 2
        state["turn_player"] = "ai"
        state["phase"] = "battle"
        state["_ai_turn_stages"] = []
        for owner in ("player", "ai"):
            for idx in range(6):
                put(
                    state,
                    owner,
                    "deck",
                    new_card(f"{owner}-deck-{idx}", owner=owner),
                )
        attacker_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800, position="attack"),
        )
        morphing_jar = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-morphing-jar",
                owner="player",
                atk=700,
                face_down=True,
                position="defense",
                set_turn=1,
                **{"def": 600},
            ),
        )
        state["pending_battle"] = {
            "attacker_player": "ai",
            "attacker_instance_id": attacker_monster["instance_id"],
            "defender_instance_id": morphing_jar["instance_id"],
        }
        engine._prepare_pending_battle(state)

        stages = state["_ai_turn_stages"]
        self.assertEqual(stages[0]["type"], "attack_reveal")
        reveal_defender = stages[0]["state"]["players"]["player"]["monster_zone"][0]
        self.assertIsNotNone(reveal_defender)
        self.assertEqual(reveal_defender["card_id"], "m-morphing-jar")
        self.assertFalse(reveal_defender["face_down"])
        self.assertIn(
            morphing_jar["instance_id"],
            [card["instance_id"] for card in state["players"]["player"]["graveyard"]],
        )

    def test_trap_hole_cannot_destroy_revival_jam_during_kaibaman_chain(self):
        state = new_state()
        state["turn"] = 2
        kaibaman = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-kaibaman",
                summoned_turn=1,
                summon_method="normal",
            ),
        )
        revival_jam = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-revival-jam",
                atk=1500,
                summoned_turn=2,
                summon_method="normal",
            ),
        )
        blue_eyes = put(
            state,
            "player",
            "hand",
            new_card("m-blue-eyes-white-dragon"),
        )
        put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-trap-hole",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=1,
            ),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": kaibaman["instance_id"],
            },
        )
        self.assertEqual(
            [link["card_id"] for link in state["chain"]["links"]],
            ["m-kaibaman"],
        )
        state = actions.apply(
            state,
            player="player",
            action={"type": "pass_chain"},
        )

        self.assertEqual(
            find_card(state, revival_jam["instance_id"])[1],
            "monster_zone",
        )
        self.assertEqual(
            find_card(state, blue_eyes["instance_id"])[1],
            "monster_zone",
        )

    def test_trap_hole_only_targets_recent_normal_or_flip_summons(self):
        valid_cases = (
            {"summon_method": "normal", "summoned_turn": 1},
            {"summon_method": "tribute", "summoned_turn": 1},
            {"summoned_turn": 0, "flip_summoned_turn": 1},
        )
        for summon_state in valid_cases:
            with self.subTest(summon_state=summon_state):
                state = new_state()
                target = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card(
                        "summoned-monster",
                        owner="ai",
                        atk=1000,
                        **summon_state,
                    ),
                )
                trap = put(
                    state,
                    "player",
                    "spell_trap_zone",
                    new_card(
                        "t-trap-hole",
                        "trap",
                        face_down=True,
                        set_turn=0,
                    ),
                )

                state = activate_and_resolve(
                    self.engine,
                    state,
                    "player",
                    trap,
                    targets=(target["instance_id"],),
                )

                self.assertEqual(
                    find_card(state, target["instance_id"])[1],
                    "graveyard",
                )

        for summon_state in (
            {"summon_method": "special", "summoned_turn": 1},
            {"summon_method": "normal", "summoned_turn": 0},
            {"summon_method": "normal", "summoned_turn": 1, "atk": 999},
        ):
            with self.subTest(invalid_summon_state=summon_state):
                state = new_state()
                atk = summon_state.get("atk", 1000)
                summon_attributes = {
                    key: value
                    for key, value in summon_state.items()
                    if key != "atk"
                }
                target = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card(
                        "summoned-monster",
                        owner="ai",
                        atk=atk,
                        **summon_attributes,
                    ),
                )
                trap = put(
                    state,
                    "player",
                    "spell_trap_zone",
                    new_card(
                        "t-trap-hole",
                        "trap",
                        face_down=True,
                        set_turn=0,
                    ),
                )

                with self.assertRaises(DuelRuleError):
                    self.engine.activate(
                        state,
                        player="player",
                        source_instance_id=trap["instance_id"],
                        effect_id="activate",
                        target_instance_ids=(target["instance_id"],),
                    )

    def test_equip_spells_apply_their_catalog_stats_to_valid_targets(self):
        cases = (
            ("s-horn-of-the-unicorn", "m-generic", 700, 700),
            ("s-magic-formula", "m-dark-magician", 700, 0),
            ("s-butterfly-dagger-elma", "m-generic", 300, 0),
            ("s-sword-of-deep-seated", "m-generic", 500, 500),
        )
        for card_id, target_id, atk_bonus, def_bonus in cases:
            with self.subTest(card_id=card_id):
                state = new_state()
                target = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(target_id, atk=1400, **{"def": 900}),
                )
                equip = put(
                    state,
                    "player",
                    "hand",
                    new_card(card_id, "spell"),
                )

                state = activate_and_resolve(
                    self.engine,
                    state,
                    "player",
                    equip,
                    targets=(target["instance_id"],),
                )

                self.assertEqual(
                    current_stats(state, target["instance_id"]),
                    {"atk": 1400 + atk_bonus, "def": 900 + def_bonus},
                )
                source = find_card(state, equip["instance_id"])
                self.assertEqual(source[1], "spell_trap_zone")
                self.assertFalse(source[3]["face_down"])
                self.assertEqual(
                    source[3]["target_instance_id"], target["instance_id"]
                )

    def test_reused_equip_spells_only_boost_their_new_target(self):
        state = new_state()
        player_monster = put(
            state,
            "player",
            "monster_zone",
            new_card("m-needle-worm", atk=750, **{"def": 600}),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-breaker-the-magical-warrior",
                owner="ai",
                atk=1600,
                **{"def": 1000},
            ),
        )
        horn = put(
            state,
            "player",
            "hand",
            new_card("s-horn-of-the-unicorn", "spell"),
        )
        elma = put(
            state,
            "player",
            "hand",
            new_card("s-butterfly-dagger-elma", "spell"),
        )

        for equip in (horn, elma):
            state = activate_and_resolve(
                self.engine,
                state,
                "player",
                equip,
                targets=(opponent_monster["instance_id"],),
            )
            move_card(state, equip["instance_id"], "player", "hand")
            self.assertFalse(
                any(
                    modifier["source_instance_id"] == equip["instance_id"]
                    for modifier in state["stat_modifiers"]
                )
            )

        for equip in (horn, elma):
            state = activate_and_resolve(
                self.engine,
                state,
                "player",
                equip,
                targets=(player_monster["instance_id"],),
            )

        for equip, stat, value in (
            (horn, "atk", 700),
            (horn, "def", 700),
            (elma, "atk", 300),
        ):
            state = add_stat_modifier(
                state,
                target_instance_id=opponent_monster["instance_id"],
                source_instance_id=equip["instance_id"],
                source_card_id=equip["card_id"],
                owner="player",
                stat=stat,
                operation="increase",
                value=value,
                duration={"type": "continuous"},
            )

        self.assertEqual(
            current_stats(state, player_monster["instance_id"]),
            {"atk": 1750, "def": 1300},
        )
        self.assertEqual(
            current_stats(state, opponent_monster["instance_id"]),
            {"atk": 1600, "def": 1000},
        )

    def test_magic_formula_rejects_monsters_other_than_its_named_targets(self):
        state = new_state()
        equip = put(
            state,
            "player",
            "hand",
            new_card("s-magic-formula", "spell"),
        )
        target = put(state, "player", "monster_zone", new_card("m-other"))

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=equip["instance_id"],
                effect_id="activate",
                target_instance_ids=(target["instance_id"],),
            )

        self.assertIn(equip, state["players"]["player"]["hand"])

    def test_equipment_leave_effects_move_cards_and_apply_magic_formula_lp(self):
        expected_destinations = (
            ("s-horn-of-the-unicorn", "deck"),
            ("s-butterfly-dagger-elma", "hand"),
            ("s-magic-formula", "graveyard"),
        )
        for card_id, destination in expected_destinations:
            with self.subTest(card_id=card_id):
                state = new_state()
                target_id = (
                    "m-dark-magician"
                    if card_id == "s-magic-formula"
                    else "m-target"
                )
                target = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(target_id),
                )
                equip = put(
                    state,
                    "player",
                    "hand",
                    new_card(card_id, "spell"),
                )
                state = activate_and_resolve(
                    self.engine,
                    state,
                    "player",
                    equip,
                    targets=(target["instance_id"],),
                )

                destroy_card(state, target["instance_id"], by_player="ai")

                self.assertEqual(
                    find_card(state, equip["instance_id"])[1], destination
                )
                if card_id == "s-magic-formula":
                    self.assertEqual(state["players"]["player"]["lp"], 9000)

    def test_mask_and_nightmare_wheel_lock_attacks_and_resolve_standby_damage(self):
        mask_state = new_state()
        masked = put(
            mask_state,
            "ai",
            "monster_zone",
            new_card("masked", owner="ai"),
        )
        mask = put(
            mask_state,
            "player",
            "hand",
            new_card("s-mask-of-the-accursed", "spell"),
        )
        mask_state = activate_and_resolve(
            self.engine,
            mask_state,
            "player",
            mask,
            targets=(masked["instance_id"],),
        )

        self.assertFalse(can_declare_attack(mask_state, "ai", masked["instance_id"]))
        self.assertTrue(can_change_battle_position(mask_state, "ai", masked["instance_id"]))
        resolve_standby_effects(mask_state, "player")
        resolve_standby_effects(mask_state, "player")
        self.assertEqual(mask_state["players"]["ai"]["lp"], 7500)

        wheel_state = new_state()
        chained = put(
            wheel_state,
            "ai",
            "monster_zone",
            new_card("chained", owner="ai"),
        )
        wheel = put(
            wheel_state,
            "player",
            "spell_trap_zone",
            new_card("t-nightmare-wheel", "trap", face_down=True),
        )
        wheel_state = activate_and_resolve(
            self.engine,
            wheel_state,
            "player",
            wheel,
            targets=(chained["instance_id"],),
        )

        self.assertFalse(can_declare_attack(wheel_state, "ai", chained["instance_id"]))
        self.assertFalse(can_change_battle_position(wheel_state, "ai", chained["instance_id"]))
        resolve_standby_effects(wheel_state, "ai")
        self.assertEqual(wheel_state["players"]["ai"]["lp"], 7500)

        move_card(wheel_state, chained["instance_id"], "ai", "graveyard")
        self.assertEqual(
            find_card(wheel_state, wheel["instance_id"])[1], "graveyard"
        )

    def test_dimension_fusion_pays_lp_and_summons_both_players_banished_monsters(self):
        state = new_state()
        state["players"]["player"]["lp"] = 3000
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-dimension-fusion", "spell"),
        )
        for index in range(4):
            put(
                state,
                "player",
                "monster_zone",
                new_card(f"player-field-{index}"),
            )
        for index in range(3):
            put(state, "ai", "monster_zone", new_card(f"ai-field-{index}", owner="ai"))
        player_banished = [
            put(state, "player", "banished", new_card(f"player-banished-{index}"))
            for index in range(2)
        ]
        ai_banished = [
            put(state, "ai", "banished", new_card(f"ai-banished-{index}", owner="ai"))
            for index in range(3)
        ]
        banished_spell = put(
            state,
            "ai",
            "banished",
            new_card("banished-spell", "spell", owner="ai"),
        )

        state = activate_and_resolve(self.engine, state, "player", spell)

        self.assertEqual(state["players"]["player"]["lp"], 1000)
        self.assertEqual(len(state["players"]["player"]["monster_zone"]), 5)
        self.assertEqual(len(state["players"]["ai"]["monster_zone"]), 5)
        self.assertEqual(
            sum(card is not None for card in state["players"]["player"]["monster_zone"]),
            5,
        )
        self.assertEqual(
            {card["instance_id"] for card in state["players"]["player"]["banished"]},
            {player_banished[1]["instance_id"]},
        )
        self.assertEqual(
            {card["instance_id"] for card in state["players"]["ai"]["banished"]},
            {ai_banished[2]["instance_id"], banished_spell["instance_id"]},
        )
        self.assertEqual(
            state["players"]["player"]["graveyard"][0]["instance_id"],
            spell["instance_id"],
        )

    def test_graverobber_takes_an_opponent_grave_card_without_changing_ownership(self):
        state = new_state()
        state["phase"] = "main1"
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-graverobber", "trap", face_down=True, set_turn=0),
        )
        recovered = put(
            state,
            "ai",
            "graveyard",
            new_card("s-pot-of-greed", "spell", owner="ai"),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(recovered["instance_id"],),
        )

        recovered_after = find_card(state, recovered["instance_id"])
        self.assertEqual(recovered_after[:2], ("player", "hand"))
        self.assertEqual(recovered_after[3]["owner"], "ai")
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

        move_card(state, recovered["instance_id"], "player", "graveyard")
        self.assertEqual(
            find_card(state, recovered["instance_id"])[:2],
            ("ai", "graveyard"),
        )

    def test_graverobber_rejects_a_card_in_its_own_graveyard(self):
        state = new_state()
        state["phase"] = "main1"
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-graverobber", "trap", face_down=True, set_turn=0),
        )
        own_card = put(
            state,
            "player",
            "graveyard",
            new_card("s-pot-of-greed", "spell"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=trap["instance_id"],
                effect_id="activate",
                target_instance_ids=(own_card["instance_id"],),
            )

        self.assertEqual(find_card(state, own_card["instance_id"])[1], "graveyard")
        self.assertTrue(find_card(state, trap["instance_id"])[3]["face_down"])

    def test_call_of_the_haunted_links_revived_monster_to_the_trap(self):
        state = new_state()
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-call-of-the-haunted", "trap", face_down=True, set_turn=0),
        )
        target = put(
            state,
            "ai",
            "graveyard",
            new_card("grave-monster", owner="ai"),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(target["instance_id"],),
        )

        revived = find_card(state, target["instance_id"])
        self.assertEqual(revived[0:2], ("player", "monster_zone"))
        self.assertEqual(revived[3]["owner"], "ai")
        self.assertEqual(revived[3]["controller"], "player")
        self.assertEqual(
            find_card(state, trap["instance_id"])[3]["target_instance_id"],
            target["instance_id"],
        )

        move_card(state, target["instance_id"], "ai", "graveyard")
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

        second_state = new_state()
        second_trap = put(
            second_state,
            "player",
            "spell_trap_zone",
            new_card("t-call-of-the-haunted", "trap", face_down=True, set_turn=0),
        )
        second_target = put(
            second_state,
            "player",
            "graveyard",
            new_card("second-grave-monster"),
        )
        second_state = activate_and_resolve(
            self.engine,
            second_state,
            "player",
            second_trap,
            targets=(second_target["instance_id"],),
        )

        destroy_card(second_state, second_trap["instance_id"])
        self.assertEqual(find_card(second_state, second_target["instance_id"])[1], "graveyard")

    def test_counter_traps_negate_the_matching_chain_link(self):
        cases = (
            ("t-seven-tools-of-the-bandit", "trap", 500, 0),
            ("t-trap-jammer", "trap", 0, 0),
            ("t-dark-bribe", "spell", 0, 1),
        )
        for counter_id, target_category, lp_cost, expected_player_draws in cases:
            with self.subTest(counter_id=counter_id):
                state = new_state()
                if target_category == "spell":
                    target = put(
                        state,
                        "player",
                        "hand",
                        new_card("s-pot-of-greed", "spell"),
                    )
                    for index in range(3):
                        put(state, "player", "deck", new_card(f"draw-{index}"))
                    state = self.engine.activate(
                        state,
                        player="player",
                        source_instance_id=target["instance_id"],
                        effect_id="activate",
                    )
                else:
                    target = put(
                        state,
                        "player",
                        "spell_trap_zone",
                        new_card(
                            "t-solemn-wishes",
                            "trap",
                            face_down=True,
                            set_turn=0,
                        ),
                    )
                    state = self.engine.activate(
                        state,
                        player="player",
                        source_instance_id=target["instance_id"],
                        effect_id="activate",
                    )

                counter = put(
                    state,
                    "ai",
                    "spell_trap_zone",
                    new_card(counter_id, "trap", face_down=True, set_turn=0),
                )
                state = self.engine.activate(
                    state,
                    player="ai",
                    source_instance_id=counter["instance_id"],
                    effect_id="activate",
                )
                while state["chain"]["status"] == "open":
                    state = self.engine.pass_priority(
                        state,
                        player=state["chain"]["priority_player"],
                    )

                self.assertEqual(
                    state["players"]["ai"]["lp"], 8000 - lp_cost
                )
                self.assertEqual(
                    len(state["players"]["player"]["hand"]),
                    expected_player_draws,
                )
                self.assertEqual(
                    find_card(state, target["instance_id"])[1], "graveyard"
                )
                self.assertEqual(
                    find_card(state, counter["instance_id"])[1], "graveyard"
                )

    def test_counter_trap_rejects_a_chain_link_of_the_wrong_type(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-trap-jammer", "trap", face_down=True, set_turn=0),
        )
        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="ai",
                source_instance_id=trap["instance_id"],
                effect_id="activate",
            )

        self.assertEqual(len(state["chain"]["links"]), 1)

    def test_chain_response_options_include_registered_effects_for_human_player(self):
        state = new_state()
        state.update({"turn": 2, "phase": "battle"})
        trigger = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-solemn-wishes", "trap", owner="ai", face_down=True, set_turn=1),
        )
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-trap-jammer", "trap", owner="player", face_down=True, set_turn=1),
        )
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-skull-dice", "trap", owner="player", face_down=True, set_turn=1),
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=trigger["instance_id"],
            effect_id="activate",
        )
        actions = DuelActionEngine(self.engine)

        options = actions.chain_response_options(state, "player")
        option_card_ids = {option["card_id"] for option in options}

        self.assertIn("t-trap-jammer", option_card_ids)
        self.assertIn("t-skull-dice", option_card_ids)

    def test_chain_response_options_include_valid_effects_from_the_deck(self):
        state = new_state()
        state.update({"turn": 2, "phase": "battle"})
        trigger = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-solemn-wishes", "trap", owner="ai", face_down=True, set_turn=1),
        )
        deck_response = put(
            state,
            "player",
            "deck",
            new_card("test-deck-response", "spell"),
        )
        self.engine.registry.register(
            EffectDefinition(
                card_id="test-deck-response",
                effect_id="activate",
                effect_type="quick",
                speed=2,
                resolve=lambda state, context: None,
                source_zones=frozenset({"deck"}),
                can_chain=True,
            )
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=trigger["instance_id"],
            effect_id="activate",
        )

        options = DuelActionEngine(self.engine).chain_response_options(state, "player")

        self.assertIn(
            deck_response["instance_id"],
            {option["source_instance_id"] for option in options},
        )

    def test_ai_skips_valid_response_when_simulation_predicts_a_worse_outcome(self):
        state = new_state()
        state.update({"turn": 2, "phase": "battle"})

        def benefit_ai(state, _context):
            state["players"]["ai"]["lp"] += 5000

        self.engine.registry.register(
            EffectDefinition(
                card_id="t-test-benefit-ai",
                effect_id="activate",
                effect_type="activated",
                speed=2,
                resolve=benefit_ai,
                source_zones=frozenset({"spell_trap_zone"}),
                can_chain=True,
            )
        )
        benefit = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-test-benefit-ai", "trap", face_down=True, set_turn=1),
        )
        jammer = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-trap-jammer", "trap", owner="ai", face_down=True, set_turn=1),
        )
        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=benefit["instance_id"],
            effect_id="activate",
        )
        actions = DuelActionEngine(self.engine)

        state = actions._finish_player_activation(state, "player")

        self.assertEqual(len(state["chain"]["links"]), 1)
        self.assertEqual(state["chain"]["priority_player"], "player")
        self.assertTrue(find_card(state, jammer["instance_id"])[3]["face_down"])

    def test_chain_cannot_activate_same_source_more_than_once(self):
        state = new_state()
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-solemn-wishes", "trap", face_down=True, set_turn=0),
        )
        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=trap["instance_id"],
            effect_id="activate",
        )
        state = self.engine.pass_priority(state, player="ai")

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=trap["instance_id"],
                effect_id="activate",
            )

        self.assertEqual(len(state["chain"]["links"]), 1)

    def test_big_shield_gardna_flips_up_and_negates_a_targeting_spell(self):
        state = new_state()
        gardna = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-big-shield-gardna",
                owner="ai",
                face_down=True,
                position="defense",
            ),
        )
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-targeting-test-spell", "spell"),
        )

        def resolve_spell(state, _context):
            state["test_spell_resolved"] = True

        registry = EffectRegistry()
        registry.register(
            EffectDefinition(
                card_id="s-targeting-test-spell",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=resolve_spell,
                target_is_valid=lambda state, target_id, _context: bool(
                    find_card(state, target_id)
                ),
                source_zones=frozenset({"hand"}),
                phases=frozenset({"main1"}),
                requires_target=True,
                move_source_on_activation=True,
            )
        )
        engine = DuelEffectEngine(registry)

        state = engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
            target_instance_ids=(gardna["instance_id"],),
        )

        flipped_gardna = find_card(state, gardna["instance_id"])[3]
        self.assertFalse(flipped_gardna["face_down"])
        self.assertEqual(flipped_gardna["position"], "defense")
        self.assertTrue(state["chain"]["links"][0]["negated"])

        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")

        self.assertNotIn("test_spell_resolved", state)
        self.assertEqual(find_card(state, spell["instance_id"])[1], "graveyard")

        state = new_state()
        gardna = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-big-shield-gardna",
                owner="ai",
                face_down=True,
                position="defense",
            ),
        )
        other_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("other-target", owner="ai", face_down=True, position="defense"),
        )
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-targeting-test-spell", "spell"),
        )

        state = engine.activate(
            state,
            player="player",
            source_instance_id=spell["instance_id"],
            effect_id="activate",
            target_instance_ids=(other_target["instance_id"],),
        )

        self.assertTrue(find_card(state, gardna["instance_id"])[3]["face_down"])
        self.assertFalse(state["chain"]["links"][0]["negated"])

    def test_ai_uses_dark_bribe_in_response_to_a_player_spell(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        for index in range(3):
            put(state, "player", "deck", new_card(f"draw-{index}"))
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-dark-bribe", "trap", face_down=True, set_turn=0),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": spell["instance_id"],
            },
        )

        self.assertEqual(state["chain"]["status"], "open")
        self.assertEqual(len(state["chain"]["links"]), 2)
        self.assertEqual(state["chain"]["links"][1]["card_id"], "t-dark-bribe")
        state = actions.apply(state, player="player", action={"type": "pass_chain"})

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(len(state["players"]["player"]["hand"]), 1)
        self.assertEqual(find_card(state, spell["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

    def test_player_spell_resolves_after_ai_passes_and_allows_summoning(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        rain = put(
            state,
            "player",
            "hand",
            new_card("s-rain-of-mercy", "spell"),
        )
        monster = put(
            state,
            "player",
            "hand",
            new_card("normal-monster", level=4),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": rain["instance_id"],
            },
        )

        state = resolve_action_chain(actions, state)
        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(state["players"]["player"]["lp"], 8000)
        self.assertEqual(find_card(state, rain["instance_id"])[1], "spell_trap_zone")

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": monster["instance_id"],
                "zone_index": 0,
            },
        )

        self.assertEqual(find_card(state, monster["instance_id"])[1], "monster_zone")
        state["turn"] = 2
        resolve_standby_effects(state, "player")
        self.assertEqual(state["players"]["player"]["lp"], 9000)

    def test_targeted_effect_revalidates_and_rejects_invalid_target(self):
        state = new_state()
        spell = put(state, "player", "hand", new_card("s-thousand-knives", "spell"))
        enemy = put(state, "ai", "monster_zone", new_card("enemy", owner="ai"))

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=spell["instance_id"],
                effect_id="activate",
                target_instance_ids=(enemy["instance_id"],),
            )

        self.assertIs(state["players"]["ai"]["monster_zone"][0], enemy)

    def test_conditional_spell_and_unknown_effect_are_rejected(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-burst-stream-of-destruction", "spell"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=spell["instance_id"],
                effect_id="activate",
            )
        with self.assertRaises(DuelRuleError):
            self.engine.registry.get("s-not-implemented", "activate")

        self.assertIn(spell, state["players"]["player"]["hand"])

    def test_divine_shield_protects_from_raigeki(self):
        state = new_state()
        shield = put(state, "player", "hand", new_card("s-divine-shield", "spell"))
        raigeki = put(state, "ai", "hand", new_card("s-raigeki", "spell", owner="ai"))
        protected = put(state, "player", "monster_zone", new_card("protected"))

        state = activate_and_resolve(self.engine, state, "player", shield)
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        state = activate_and_resolve(self.engine, state, "ai", raigeki)

        self.assertEqual(
            state["players"]["player"]["monster_zone"][0]["instance_id"],
            protected["instance_id"],
        )
        self.assertEqual(
            [card["card_id"] for card in state["players"]["player"]["graveyard"]],
            ["s-divine-shield"],
        )

    def test_berfomet_and_kings_knight_summon_triggers(self):
        state = new_state()
        berfomet = put(state, "player", "monster_zone", new_card("m-berfomet"))
        gazelle = put(
            state,
            "player",
            "deck",
            new_card("m-gazelle-king-of-mythical-beasts"),
        )
        resolve_monster_summon_effects(state, "player", berfomet["instance_id"], "normal")
        self.assertIs(state["players"]["player"]["hand"][0], gazelle)

        queen = put(state, "player", "monster_zone", new_card("m-queens-knight"), index=1)
        queen["face_down"] = False
        king = put(state, "player", "monster_zone", new_card("m-kings-knight"), index=2)
        jack = put(state, "player", "deck", new_card("m-jacks-knight"))
        put(state, "player", "deck", new_card("m-jacks-knight"))
        resolve_monster_summon_effects(state, "player", king["instance_id"], "normal")
        self.assertEqual(state["players"]["player"]["monster_zone"][3]["card_id"], jack["card_id"])
        self.assertEqual(
            sum(
                card is not None and card.get("card_id") == "m-jacks-knight"
                for card in state["players"]["player"]["monster_zone"]
            ),
            1,
        )
        self.assertEqual(
            sum(card["card_id"] == "m-jacks-knight" for card in state["players"]["player"]["deck"]),
            1,
        )
        tribute_state = new_state()
        put(
            tribute_state,
            "player",
            "monster_zone",
            new_card("m-queens-knight"),
            index=0,
        )
        tribute_king = put(
            tribute_state,
            "player",
            "monster_zone",
            new_card("m-kings-knight"),
            index=1,
        )
        put(
            tribute_state,
            "player",
            "deck",
            new_card("m-jacks-knight"),
        )
        resolve_monster_summon_effects(
            tribute_state,
            "player",
            tribute_king["instance_id"],
            "tribute",
        )
        self.assertEqual(len(tribute_state["players"]["player"]["deck"]), 1)
        self.assertFalse(
            any(
                card and card.get("card_id") == "m-jacks-knight"
                for card in tribute_state["players"]["player"]["monster_zone"]
            )
        )

    def test_mobius_tribute_summon_waits_for_up_to_two_spell_trap_choices(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        mobius = put(
            state,
            "player",
            "hand",
            new_card("m-mobius-the-frost-monarch", level=6),
        )
        enemy_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("s-enemy-spell", "spell", owner="ai", face_down=True),
        )
        enemy_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-enemy-trap", "trap", owner="ai", face_down=True),
        )
        extra_enemy_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-extra-trap", "trap", owner="ai", face_down=True),
        )
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-own-spell", "spell"),
        )

        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": mobius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )

        self.assertEqual(
            state["pending_decision"],
            {
                "type": "select_field_cards",
                "player": "player",
                "source_instance_id": mobius["instance_id"],
                "effect_card_id": "m-mobius-the-frost-monarch",
                "min_count": 0,
                "max_count": 2,
                "target_mode": "field-spell-trap",
            },
        )
        self.assertIsNotNone(find_card(state, enemy_spell["instance_id"]))

        for invalid_targets in (
            [
                enemy_spell["instance_id"],
                enemy_trap["instance_id"],
                extra_enemy_trap["instance_id"],
            ],
            [enemy_spell["instance_id"], enemy_spell["instance_id"]],
        ):
            with self.assertRaises(DuelRuleError):
                actions.apply(
                    state,
                    player="player",
                    action={
                        "type": "complete_card_selection",
                        "instance_ids": invalid_targets,
                    },
                )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [mobius["instance_id"]],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [
                    enemy_spell["instance_id"],
                    own_spell["instance_id"],
                ],
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, enemy_spell["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, own_spell["instance_id"])[1], "graveyard")
        self.assertIsNotNone(find_card(state, enemy_trap["instance_id"]))
        self.assertIsNotNone(find_card(state, extra_enemy_trap["instance_id"]))

    def test_mobius_effect_can_be_skipped_without_destroying_any_cards(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        mobius = put(
            state,
            "player",
            "hand",
            new_card("m-mobius-the-frost-monarch", level=6),
        )
        spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("s-enemy-spell", "spell", owner="ai"),
        )

        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": mobius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": []},
        )

        self.assertIsNotNone(find_card(state, spell["instance_id"]))
        self.assertIsNone(state["pending_decision"])

    def test_magical_dimension_tributes_summons_chosen_spellcaster_and_destroys_target(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-magical-dimension", "spell"),
        )
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("m-tribute"),
        )
        spellcaster = put(
            state,
            "player",
            "hand",
            new_card("m-spellcaster", race="Spellcaster"),
        )
        enemy = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-enemy", owner="ai"),
        )
        actions = DuelActionEngine(self.engine)

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(tribute["instance_id"],),
        )

        self.assertEqual(find_card(state, tribute["instance_id"])[1], "graveyard")
        self.assertEqual(state["pending_decision"]["selection_stage"], "summon")
        self.assertEqual(state["pending_decision"]["target_mode"], "hand-spellcaster")
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [spellcaster["instance_id"]],
            },
        )
        summoned = find_card(state, spellcaster["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertFalse(summoned[3]["face_down"])
        self.assertEqual(summoned[3]["position"], "attack")
        self.assertEqual(summoned[3]["summon_method"], "special")
        self.assertEqual(
            state["pending_decision"]["target_mode"],
            "field-opponent-monster",
        )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [spellcaster["instance_id"]],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [enemy["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, enemy["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, spell["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])

    def test_magical_dimension_can_skip_optional_destruction(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-magical-dimension", "spell"),
        )
        tribute = put(state, "player", "monster_zone", new_card("m-tribute"))
        spellcaster = put(
            state,
            "player",
            "hand",
            new_card("m-spellcaster", race="Spellcaster"),
        )
        actions = DuelActionEngine(self.engine)
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(tribute["instance_id"],),
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [spellcaster["instance_id"]],
            },
        )

        state = actions.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": []},
        )

        self.assertEqual(find_card(state, spellcaster["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, spell["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])

    def test_magical_dimension_rejects_non_spellcaster_hand_choice(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-magical-dimension", "spell"),
        )
        tribute = put(state, "player", "monster_zone", new_card("m-tribute"))
        put(state, "player", "hand", new_card("m-warrior", race="Warrior"))
        put(state, "player", "hand", new_card("m-spellcaster", race="Spellcaster"))
        actions = DuelActionEngine(self.engine)
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            spell,
            targets=(tribute["instance_id"],),
        )
        warrior = next(
            card
            for card in state["players"]["player"]["hand"]
            if card["card_id"] == "m-warrior"
        )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [warrior["instance_id"]],
                },
            )

        self.assertEqual(state["pending_decision"]["selection_stage"], "summon")

    def test_magical_dimension_cannot_be_activated_without_a_summonable_spellcaster(self):
        state = new_state()
        spell = put(
            state,
            "player",
            "hand",
            new_card("s-magical-dimension", "spell"),
        )
        tribute = put(state, "player", "monster_zone", new_card("m-tribute"))
        put(state, "player", "hand", new_card("m-warrior", race="Warrior"))

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=spell["instance_id"],
                effect_id="activate",
                target_instance_ids=(tribute["instance_id"],),
            )

        self.assertEqual(find_card(state, tribute["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, spell["instance_id"])[1], "hand")

    def test_magicat_can_add_a_chosen_spell_after_an_effect_destroys_it(self):
        state = new_state()
        magicat = put(
            state,
            "player",
            "monster_zone",
            new_card("m-magicat"),
        )
        time_wizard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-time-wizard"),
        )
        selected_spell = put(
            state,
            "player",
            "deck",
            new_card("s-selected-spell", "spell"),
        )
        put(state, "player", "deck", new_card("m-deck-monster"))
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": time_wizard["instance_id"],
            },
        )
        state = resolve_action_chain(actions, state)

        self.assertEqual(find_card(state, magicat["instance_id"])[1], "graveyard")
        self.assertEqual(state["pending_decision"]["type"], "select_deck_card")
        self.assertEqual(
            state["pending_decision"]["eligible_target_instance_ids"],
            [selected_spell["instance_id"]],
        )

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [
                        next(
                            card["instance_id"]
                            for card in state["players"]["player"]["deck"]
                            if card["category"] == "monster"
                        )
                    ],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [selected_spell["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, selected_spell["instance_id"])[1], "hand")
        self.assertIsNone(state["pending_decision"])

    def test_magicat_search_is_optional(self):
        state = new_state()
        put(state, "player", "monster_zone", new_card("m-magicat"))
        time_wizard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-time-wizard"),
        )
        spell = put(state, "player", "deck", new_card("s-spell", "spell"))
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": time_wizard["instance_id"],
            },
        )
        state = resolve_action_chain(actions, state)

        state = actions.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": []},
        )

        self.assertEqual(find_card(state, spell["instance_id"])[1], "deck")
        self.assertIsNone(state["pending_decision"])

    def test_archfiend_of_gilfer_reduces_one_random_face_up_monster_atk(self):
        state = new_state()
        gilfer = put(
            state,
            "player",
            "monster_zone",
            new_card("m-archfiend-of-gilfer"),
        )
        time_wizard = put(
            state,
            "player",
            "monster_zone",
            new_card("m-time-wizard"),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("first-target", owner="ai", atk=1800),
        )
        second_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("second-target", owner="ai", atk=1800),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": time_wizard["instance_id"],
            },
        )
        state = resolve_action_chain(actions, state)

        self.assertEqual(find_card(state, gilfer["instance_id"])[1], "graveyard")
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(
            sorted(
                [
                    current_stats(state, target["instance_id"])["atk"],
                    current_stats(state, second_target["instance_id"])["atk"],
                ]
            ),
            [1300, 1800],
        )
        modifier = state["stat_modifiers"][0]
        self.assertEqual(modifier["operation"], "decrease")
        self.assertEqual(modifier["value"], 500)
        self.assertEqual(modifier["source_instance_id"], gilfer["instance_id"])

        destroy_card(state, modifier["target_instance_id"])
        self.assertEqual(state["stat_modifiers"], [])

    def test_archfiend_of_gilfer_does_not_trigger_when_banished_or_sent_without_destruction(self):
        state = new_state()
        gilfer = put(
            state,
            "player",
            "monster_zone",
            new_card("m-archfiend-of-gilfer"),
        )
        destroy_card(state, gilfer["instance_id"], destination_zone="banished")
        self.assertNotIn("pending_card_triggers", state)

        sent_to_grave = put(
            state,
            "player",
            "hand",
            new_card("m-archfiend-of-gilfer"),
        )
        move_card(state, sent_to_grave["instance_id"], "player", "graveyard")
        self.assertNotIn("pending_card_triggers", state)

    def test_archfiend_of_gilfer_skips_effect_without_face_up_opponent_monsters(self):
        state = new_state()
        gilfer = put(
            state,
            "player",
            "monster_zone",
            new_card("m-archfiend-of-gilfer"),
        )
        friendly = put(
            state,
            "player",
            "monster_zone",
            new_card("friendly-monster"),
        )
        put(
            state,
            "ai",
            "monster_zone",
            new_card("face-down-opponent", owner="ai", face_down=True),
        )
        destroy_card(state, gilfer["instance_id"])

        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={"type": "advance_phase"},
        )

        self.assertEqual(current_stats(state, friendly["instance_id"])["atk"], 1000)
        self.assertEqual(state["stat_modifiers"], [])
        self.assertEqual(state["pending_card_triggers"], [])

    def test_caius_tribute_summon_banishes_target_and_burns_for_dark_monster(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        caius = put(
            state,
            "player",
            "hand",
            new_card("m-caius-the-shadow-monarch", level=6),
        )
        dark_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-dark-target", owner="ai", attribute="DARK", face_down=True),
        )
        other_target = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("s-other-target", "spell", owner="ai"),
        )
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-own-spell", "spell"),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": caius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )
        self.assertEqual(state["pending_decision"]["min_count"], 1)
        self.assertEqual(state["pending_decision"]["max_count"], 1)
        self.assertEqual(state["pending_decision"]["target_mode"], "field-card")
        self.assertEqual(state["pending_decision"]["target_player"], "ai")

        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={"type": "complete_card_selection", "instance_ids": []},
            )
        with self.assertRaises(DuelRuleError):
            actions.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [own_spell["instance_id"]],
                },
            )

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [dark_target["instance_id"]],
            },
        )

        banished = find_card(state, dark_target["instance_id"])
        self.assertEqual(banished[1], "banished")
        self.assertFalse(banished[3]["face_down"])
        self.assertEqual(state["players"]["ai"]["lp"], 7000)
        self.assertIsNotNone(find_card(state, other_target["instance_id"]))
        self.assertIsNone(state["pending_decision"])

    def test_caius_does_not_burn_when_banishing_a_non_dark_monster(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        caius = put(
            state,
            "player",
            "hand",
            new_card("m-caius-the-shadow-monarch", level=6),
        )
        light_target = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-light-target", owner="ai", attribute="LIGHT"),
        )
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": caius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [light_target["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, light_target["instance_id"])[1], "banished")
        self.assertEqual(state["players"]["ai"]["lp"], 8000)

    def test_caius_can_be_tribute_summoned_when_opponent_has_no_monsters(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        caius = put(
            state,
            "player",
            "hand",
            new_card("m-caius-the-shadow-monarch", level=6),
        )
        opponent_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("s-opponent-spell", "spell", owner="ai", face_down=True),
        )
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": caius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )

        self.assertEqual(
            state["players"]["player"]["monster_zone"][0]["instance_id"],
            caius["instance_id"],
        )
        self.assertEqual(state["players"]["ai"]["monster_zone"], [None] * 5)
        self.assertTrue(state["normal_summon_used"]["player"])
        self.assertIsNotNone(state["pending_decision"])

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [opponent_spell["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, opponent_spell["instance_id"])[1], "banished")
        self.assertEqual(state["players"]["player"]["monster_zone"][0]["instance_id"], caius["instance_id"])

    def test_caius_summon_is_not_blocked_when_no_other_field_card_can_be_targeted(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        caius = put(
            state,
            "player",
            "hand",
            new_card("m-caius-the-shadow-monarch", level=6),
        )

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": caius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )

        self.assertEqual(
            result["players"]["player"]["monster_zone"][0]["instance_id"],
            caius["instance_id"],
        )
        self.assertIsNone(result["pending_decision"])

    def test_caius_does_not_select_own_cards_if_opponent_has_no_field_cards(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        tribute = put(
            state,
            "player",
            "monster_zone",
            new_card("tribute-monster"),
        )
        caius = put(
            state,
            "player",
            "hand",
            new_card("m-caius-the-shadow-monarch", level=6),
        )
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-own-spell", "spell"),
        )

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": caius["instance_id"],
                "zone_index": 0,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )

        self.assertEqual(
            result["players"]["player"]["monster_zone"][0]["instance_id"],
            caius["instance_id"],
        )
        self.assertIsNotNone(find_card(result, own_spell["instance_id"]))
        self.assertEqual(result["players"]["ai"]["monster_zone"], [None] * 5)
        self.assertEqual(result["players"]["ai"]["spell_trap_zone"], [None] * 5)
        self.assertIsNone(result["pending_decision"])

    def test_needle_worm_flip_summon_mills_five_from_opponents_deck(self):
        state = new_state()
        worm = put(
            state,
            "player",
            "monster_zone",
            new_card("m-needle-worm", face_down=True, set_turn=0),
        )
        for index in range(6):
            put(state, "ai", "deck", new_card(f"ai-deck-{index}", owner="ai"))

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={"type": "flip_summon", "instance_id": worm["instance_id"]},
        )

        self.assertEqual(
            [card["card_id"] for card in result["players"]["ai"]["graveyard"]],
            ["ai-deck-5", "ai-deck-4", "ai-deck-3", "ai-deck-2", "ai-deck-1"],
        )
        self.assertEqual(
            [card["card_id"] for card in result["players"]["ai"]["deck"]],
            ["ai-deck-0"],
        )

    def test_ryko_flip_summon_destroys_selected_card_then_mills_three(self):
        state = new_state()
        state["normal_summon_used"] = {"player": False, "ai": False}
        ryko = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-ryko-lightsworn-hunter",
                face_down=True,
                position="defense",
                set_turn=0,
            ),
        )
        target = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-ryko-target", "trap", owner="ai", face_down=True),
        )
        for index in range(4):
            put(state, "ai", "deck", new_card(f"ai-ryko-deck-{index}", owner="ai"))
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={"type": "flip_summon", "instance_id": ryko["instance_id"]},
        )
        self.assertEqual(state["pending_decision"]["target_mode"], "field-card-any")
        self.assertEqual(len(state["players"]["ai"]["deck"]), 4)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [target["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(
            [card["card_id"] for card in state["players"]["ai"]["graveyard"][-3:]],
            ["ai-ryko-deck-3", "ai-ryko-deck-2", "ai-ryko-deck-1"],
        )
        self.assertEqual(
            [card["card_id"] for card in state["players"]["ai"]["deck"]],
            ["ai-ryko-deck-0"],
        )
        self.assertIsNone(state["pending_decision"])

    def test_ryko_battle_flip_resolves_even_when_ryko_was_destroyed(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        state["attacked"] = {"player": [], "ai": []}
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("attacker", owner="ai", atk=1000),
        )
        ryko = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-ryko-lightsworn-hunter",
                face_down=True,
                position="defense",
            ),
        )
        for index in range(3):
            put(state, "ai", "deck", new_card(f"ai-ryko-deck-{index}", owner="ai"))

        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": ryko["instance_id"],
            },
        )

        self.assertEqual(find_card(state, ryko["instance_id"])[1], "graveyard")
        self.assertEqual(state["pending_decision"]["source_instance_id"], ryko["instance_id"])
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [attacker["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, attacker["instance_id"])[1], "graveyard")
        self.assertEqual(len(state["players"]["ai"]["graveyard"]), 4)
        self.assertEqual(state["players"]["ai"]["deck"], [])

    def test_face_down_defender_is_revealed_when_destroyed_or_surviving_battle(self):
        for attacker_atk, defender_def, expected_zone in (
            (2000, 1000, "graveyard"),
            (1000, 1500, "monster_zone"),
        ):
            with self.subTest(expected_zone=expected_zone):
                state = new_state()
                state["turn"] = 2
                state["phase"] = "battle"
                state["attacked"] = {"player": [], "ai": []}
                attacker = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card("attacker", atk=attacker_atk),
                )
                defender = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card(
                        "hidden-defender",
                        owner="ai",
                        **{"def": defender_def},
                        face_down=True,
                        position="defense",
                    ),
                )

                result = DuelActionEngine(self.engine).apply(
                    state,
                    player="player",
                    action={
                        "type": "attack",
                        "attacker_instance_id": attacker["instance_id"],
                        "defender_instance_id": defender["instance_id"],
                    },
                )

                revealed = find_card(result, defender["instance_id"])
                self.assertEqual(revealed[1], "monster_zone")
                self.assertFalse(revealed[3]["face_down"])
                self.assertTrue(result["pending_battle"]["awaiting_resolution"])
                self.assertEqual(result["attacked"]["player"], [])
                self.assertEqual(result["players"]["player"]["lp"], 8000)

                with self.assertRaises(DuelRuleError):
                    DuelActionEngine(self.engine).apply(
                        result,
                        player="player",
                        action={"type": "advance_phase"},
                    )

                result = DuelActionEngine(self.engine).apply(
                    result,
                    player="player",
                    action={"type": "resolve_battle"},
                )
                revealed = find_card(result, defender["instance_id"])
                self.assertEqual(revealed[1], expected_zone)
                self.assertFalse(revealed[3]["face_down"])
                self.assertEqual(revealed[3]["card_id"], "hidden-defender")
                self.assertNotIn("pending_battle", result)
                self.assertIn(attacker["instance_id"], result["attacked"]["player"])
                self.assertEqual(
                    find_card(result, attacker["instance_id"])[1],
                    "monster_zone",
                )
                expected_player_lp = (
                    8000
                    if attacker_atk >= defender_def
                    else 8000 - defender_def + attacker_atk
                )
                self.assertEqual(result["players"]["player"]["lp"], expected_player_lp)

    def test_big_shield_gardna_switches_to_attack_after_surviving_battle(self):
        for face_down in (False, True):
            with self.subTest(face_down=face_down):
                state = new_state()
                state["turn"] = 2
                state["phase"] = "battle"
                state["attacked"] = {"player": [], "ai": []}
                attacker = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card("attacker", atk=2000),
                )
                gardna = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card(
                        "m-big-shield-gardna",
                        owner="ai",
                        atk=100,
                        **{"def": 2600},
                        face_down=face_down,
                        position="defense",
                    ),
                )
                actions = DuelActionEngine(self.engine)

                result = actions.apply(
                    state,
                    player="player",
                    action={
                        "type": "attack",
                        "attacker_instance_id": attacker["instance_id"],
                        "defender_instance_id": gardna["instance_id"],
                    },
                )
                if result.get("pending_battle"):
                    result = actions.apply(
                        result,
                        player="player",
                        action={"type": "resolve_battle"},
                    )

                found_gardna = find_card(result, gardna["instance_id"])
                self.assertEqual(found_gardna[1], "monster_zone")
                self.assertFalse(found_gardna[3]["face_down"])
                self.assertEqual(found_gardna[3]["position"], "attack")
                self.assertEqual(result["players"]["player"]["lp"], 7400)

    def test_big_shield_gardna_does_not_change_position_if_destroyed_in_battle(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("attacker", atk=3000),
        )
        gardna = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-big-shield-gardna",
                owner="ai",
                atk=100,
                **{"def": 2600},
                position="defense",
            ),
        )

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": gardna["instance_id"],
            },
        )

        self.assertEqual(find_card(result, gardna["instance_id"])[1], "graveyard")

    def test_morphing_jar_flips_in_battle_then_resets_both_hands(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("attacker", atk=1000),
        )
        jar = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-morphing-jar",
                owner="ai",
                atk=700,
                **{"def": 700},
                face_down=True,
                position="defense",
            ),
        )
        put(state, "player", "hand", new_card("old-player-hand"))
        put(state, "ai", "hand", new_card("old-ai-hand", owner="ai"))
        for player in ("player", "ai"):
            for index in range(5):
                put(
                    state,
                    player,
                    "deck",
                    new_card(f"{player}-draw-{index}", owner=player),
                )

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": jar["instance_id"],
            },
        )
        self.assertTrue(result["pending_battle"]["awaiting_resolution"])
        result = DuelActionEngine(self.engine).apply(
            result,
            player="player",
            action={"type": "resolve_battle"},
        )

        self.assertEqual(len(result["players"]["player"]["hand"]), 5)
        self.assertEqual(len(result["players"]["ai"]["hand"]), 5)
        self.assertEqual(
            {card["card_id"] for card in result["players"]["player"]["hand"]},
            {f"player-draw-{index}" for index in range(5)},
        )
        self.assertEqual(
            {card["card_id"] for card in result["players"]["ai"]["hand"]},
            {f"ai-draw-{index}" for index in range(5)},
        )
        self.assertIn(jar["instance_id"], {
            card["instance_id"] for card in result["players"]["ai"]["graveyard"]
        })

    def test_blade_knight_alone_negates_needle_worm_flip_effect_in_battle(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        blade_knight = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blade-knight", atk=1600, **{"def": 1000}),
        )
        worm = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-needle-worm",
                owner="ai",
                face_down=True,
                position="defense",
            ),
        )
        for index in range(5):
            put(state, "player", "deck", new_card(f"player-deck-{index}"))

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": blade_knight["instance_id"],
                "defender_instance_id": worm["instance_id"],
            },
        )
        self.assertTrue(result["pending_battle"]["awaiting_resolution"])
        result = DuelActionEngine(self.engine).apply(
            result,
            player="player",
            action={"type": "resolve_battle"},
        )

        self.assertEqual(len(result["players"]["player"]["deck"]), 5)
        self.assertIn(
            worm["instance_id"],
            {card["instance_id"] for card in result["players"]["ai"]["graveyard"]},
        )

    def test_blade_knight_does_not_negate_flip_effect_with_another_friendly_monster(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["attacked"] = {"player": [], "ai": []}
        blade_knight = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blade-knight", atk=1600, **{"def": 1000}),
        )
        put(state, "player", "monster_zone", new_card("ally"), index=1)
        worm = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-needle-worm",
                owner="ai",
                face_down=True,
                position="defense",
            ),
        )
        for index in range(6):
            put(state, "player", "deck", new_card(f"player-deck-{index}"))

        result = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": blade_knight["instance_id"],
                "defender_instance_id": worm["instance_id"],
            },
        )
        self.assertTrue(result["pending_battle"]["awaiting_resolution"])
        result = DuelActionEngine(self.engine).apply(
            result,
            player="player",
            action={"type": "resolve_battle"},
        )

        self.assertEqual(len(result["players"]["player"]["deck"]), 1)
        self.assertEqual(len(result["players"]["player"]["graveyard"]), 5)

    def test_standby_triggers_heal_and_mill_once(self):
        state = new_state()
        rain = put(state, "player", "spell_trap_zone", new_card("s-rain-of-mercy", "spell"))
        counterbalance = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-counterbalance-card", "spell"),
        )
        put(state, "player", "monster_zone", new_card("my-monster"))
        put(state, "ai", "monster_zone", new_card("ai-monster", owner="ai"))
        top_one = put(state, "ai", "deck", new_card("top-one", owner="ai"))
        top_two = put(state, "ai", "deck", new_card("top-two", owner="ai"))

        resolve_standby_effects(state, "player")
        self.assertEqual(state["players"]["player"]["lp"], 9000)
        resolve_standby_effects(state, "player")
        self.assertEqual(state["players"]["player"]["lp"], 9000)
        resolve_standby_effects(state, "ai")
        self.assertEqual(state["players"]["ai"]["graveyard"], [top_two, top_one])

    def test_gravity_bind_and_dragon_capture_jar_remain_face_up(self):
        state = new_state()
        gravity = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-gravity-bind", "trap", face_down=True, set_turn=0),
        )
        dragon = put(
            state,
            "ai",
            "monster_zone",
            new_card("dragon", owner="ai", race="Dragon"),
        )
        jar = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-dragon-capture-jar", "trap", face_down=True, set_turn=0),
        )

        state = activate_and_resolve(self.engine, state, "player", gravity)
        state = activate_and_resolve(self.engine, state, "player", jar)

        field = state["players"]["player"]["spell_trap_zone"]
        gravity_after = next(card for card in field if card and card["card_id"] == "t-gravity-bind")
        jar_after = next(card for card in field if card and card["card_id"] == "t-dragon-capture-jar")
        dragon_after = state["players"]["ai"]["monster_zone"][0]
        self.assertFalse(gravity_after["face_down"])
        self.assertFalse(jar_after["face_down"])
        self.assertEqual(dragon_after["position"], "defense")
        self.assertFalse(can_change_battle_position(state, "ai", dragon_after["instance_id"]))

    def test_spellbinding_circle_locks_its_target_and_is_destroyed_with_it(self):
        state = new_state()
        state["phase"] = "main1"
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        other = put(
            state,
            "ai",
            "monster_zone",
            new_card("other-opponent-monster", owner="ai"),
            index=1,
        )
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-spellbinding-circle", "trap", set_turn=0, face_down=True),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(target["instance_id"],),
        )

        self.assertFalse(can_declare_attack(state, "ai", target["instance_id"]))
        self.assertFalse(can_change_battle_position(state, "ai", target["instance_id"]))
        self.assertTrue(can_declare_attack(state, "ai", other["instance_id"]))
        active_trap = next(
            card
            for card in state["players"]["player"]["spell_trap_zone"]
            if card and card["card_id"] == "t-spellbinding-circle"
        )
        self.assertFalse(active_trap["face_down"])

        destroy_card(state, target["instance_id"], by_player="player")

        self.assertTrue(
            any(
                card["card_id"] == "t-spellbinding-circle"
                for card in state["players"]["player"]["graveyard"]
            )
        )
        self.assertTrue(can_declare_attack(state, "ai", other["instance_id"]))

    def test_spellbinding_circle_is_not_destroyed_when_target_is_returned_to_hand(self):
        state = new_state()
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-spellbinding-circle", "trap", set_turn=0, face_down=True),
        )
        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(target["instance_id"],),
        )

        move_card(state, target["instance_id"], "ai", "hand")

        self.assertTrue(
            any(
                card and card["card_id"] == "t-spellbinding-circle"
                for card in state["players"]["player"]["spell_trap_zone"]
            )
        )
        self.assertFalse(
            any(
                card["card_id"] == "t-spellbinding-circle"
                for card in state["players"]["player"]["graveyard"]
            )
        )

    def test_shadow_spell_reduces_atk_locks_target_and_expires_when_it_leaves(self):
        state = new_state()
        state["phase"] = "main1"
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai", atk=1200),
        )
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-shadow-spell", "trap", set_turn=0, face_down=True),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            trap,
            targets=(target["instance_id"],),
        )

        self.assertEqual(current_stats(state, target["instance_id"])["atk"], 500)
        self.assertFalse(can_declare_attack(state, "ai", target["instance_id"]))
        self.assertFalse(can_change_battle_position(state, "ai", target["instance_id"]))

        move_card(
            state,
            target["instance_id"],
            "player",
            "monster_zone",
            destination_index=0,
        )
        self.assertFalse(can_declare_attack(state, "player", target["instance_id"]))
        self.assertFalse(
            can_change_battle_position(state, "player", target["instance_id"])
        )
        move_card(state, target["instance_id"], "ai", "hand")

        self.assertTrue(
            any(
                card["card_id"] == "t-shadow-spell"
                for card in state["players"]["player"]["graveyard"]
            )
        )
        self.assertEqual(current_stats(state, target["instance_id"])["atk"], 1200)

    def test_continuous_target_traps_reject_face_down_or_own_monsters(self):
        state = new_state()
        face_down = put(
            state,
            "ai",
            "monster_zone",
            new_card("face-down", owner="ai", face_down=True),
        )
        own = put(state, "player", "monster_zone", new_card("own-monster"), index=1)
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-shadow-spell", "trap", set_turn=0, face_down=True),
        )

        for target in (face_down, own):
            with self.assertRaises(DuelRuleError):
                self.engine.activate(
                    state,
                    player="player",
                    source_instance_id=trap["instance_id"],
                    effect_id="activate",
                    target_instance_ids=(target["instance_id"],),
                )

    def test_swords_and_gravity_bind_block_legal_attack_declarations(self):
        state = new_state()
        opponent_monster = put(state, "ai", "monster_zone", new_card("level-four", owner="ai"))
        my_monster = put(state, "player", "monster_zone", new_card("my-monster"))
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-gravity-bind", "trap", face_down=False),
        )
        self.assertFalse(can_declare_attack(state, "ai", opponent_monster["instance_id"]))
        put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "s-swords-of-revealing-light",
                "spell",
                owner="ai",
                face_down=False,
            ),
        )
        self.assertFalse(can_declare_attack(state, "player", my_monster["instance_id"]))

    def test_mirror_force_opens_chain_and_destroys_attacking_monsters(self):
        state = new_state()
        state["phase"] = "battle"
        attacker = put(state, "player", "monster_zone", new_card("attacker"))
        other_attacker = put(state, "player", "monster_zone", new_card("other-attacker"), index=1)
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card("defender", position="defense"),
            index=2,
        )
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-mirror-force", "trap", owner="ai", face_down=True, set_turn=0),
        )

        state = resolve_attack_trap(
            self.engine,
            state,
            attacker_player="player",
            attacker_instance_id=attacker["instance_id"],
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertIsNone(state["players"]["player"]["monster_zone"][0])
        self.assertIsNone(state["players"]["player"]["monster_zone"][1])
        self.assertEqual(
            state["players"]["player"]["monster_zone"][2]["instance_id"],
            defender["instance_id"],
        )
        self.assertEqual(
            state["players"]["ai"]["graveyard"][0]["instance_id"],
            trap["instance_id"],
        )
        self.assertTrue(state["battle"]["attack_cancelled"])

    def test_ordeal_of_a_traveler_returns_attacker_when_guess_is_wrong(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        attacker = put(state, "player", "monster_zone", new_card("attacker"))
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-ordeal-of-a-traveler",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=0,
            ),
        )
        put(state, "ai", "hand", new_card("hidden-spell", "spell", owner="ai"))
        actions = DuelActionEngine(self.engine)

        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        state = resolve_action_chain(actions, state)

        self.assertEqual(
            state["pending_decision"]["type"],
            "ordeal_traveler_guess",
        )
        self.assertEqual(state["_ordeal_traveler_pending"]["selected_type"], "spell")
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_ordeal_traveler_guess",
                "guess": "monster",
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertNotIn("pending_battle", state)
        self.assertEqual(
            state["players"]["player"]["hand"][0]["instance_id"],
            attacker["instance_id"],
        )
        self.assertIn(attacker["instance_id"], state["attacked"]["player"])
        active_trap = state["players"]["ai"]["spell_trap_zone"][0]
        self.assertEqual(active_trap["instance_id"], trap["instance_id"])
        self.assertFalse(active_trap["face_down"])

    def test_ordeal_of_a_traveler_keeps_active_and_accepts_correct_guess(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        attacker = put(state, "player", "monster_zone", new_card("attacker"))
        put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-ordeal-of-a-traveler",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=0,
            ),
        )
        put(state, "ai", "hand", new_card("hidden-spell", "spell", owner="ai"))
        actions = DuelActionEngine(self.engine)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        state = resolve_action_chain(actions, state)
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "complete_ordeal_traveler_guess",
                "guess": "spell",
            },
        )

        self.assertEqual(state["players"]["ai"]["lp"], 7000)
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(
            state["players"]["ai"]["spell_trap_zone"][0]["card_id"],
            "t-ordeal-of-a-traveler",
        )
        self.assertFalse(state["players"]["ai"]["spell_trap_zone"][0]["face_down"])

        second_attacker = put(
            state,
            "player",
            "monster_zone",
            new_card("second-attacker", owner="player"),
            index=1,
        )
        state = actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": second_attacker["instance_id"],
                "defender_instance_id": None,
            },
        )
        self.assertEqual(state["chain"]["status"], "open")

    def test_magic_cylinder_cancels_attack_and_deals_current_atk(self):
        state = new_state()
        state["phase"] = "battle"
        attacker = put(state, "player", "monster_zone", new_card("attacker", atk=2400))
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-magic-cylinder", "trap", owner="ai", face_down=True, set_turn=0),
        )

        state = resolve_attack_trap(
            self.engine,
            state,
            attacker_player="player",
            attacker_instance_id=attacker["instance_id"],
        )
        while state["chain"]["status"] == "open":
            state = self.engine.pass_priority(state, player=state["chain"]["priority_player"])

        self.assertEqual(state["players"]["player"]["lp"], 5600)
        self.assertTrue(state["battle"]["attack_cancelled"])
        self.assertEqual(
            state["players"]["ai"]["graveyard"][0]["instance_id"],
            trap["instance_id"],
        )

    def test_heavy_storm_duster_destroys_up_to_two_spell_traps_on_both_fields(self):
        state = new_state()
        state["turn"] = 2
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("own-spell", "spell"),
        )
        opponent_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-trap", "trap", owner="ai"),
        )
        untouched_monster = put(state, "ai", "monster_zone", new_card("monster", owner="ai"))
        storm_duster = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-heavy-storm-duster",
                "trap",
                face_down=True,
                set_turn=1,
            ),
        )

        action_engine = DuelActionEngine(self.engine)
        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": storm_duster["instance_id"],
                "target_instance_ids": [
                    own_spell["instance_id"],
                    opponent_trap["instance_id"],
                ],
            },
        )
        while state["chain"]["status"] == "open":
            state = action_engine.apply(
                state,
                player=state["chain"]["priority_player"],
                action={"type": "pass_chain"},
            )

        self.assertEqual(
            {card["instance_id"] for card in state["players"]["player"]["graveyard"]},
            {storm_duster["instance_id"], own_spell["instance_id"]},
        )
        self.assertEqual(
            [card["instance_id"] for card in state["players"]["ai"]["graveyard"]],
            [opponent_trap["instance_id"]],
        )
        self.assertEqual(
            state["players"]["ai"]["monster_zone"][0]["instance_id"],
            untouched_monster["instance_id"],
        )

    def test_heavy_storm_duster_rejects_monsters_and_more_than_two_targets(self):
        state = new_state()
        state["turn"] = 2
        storm_duster = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-heavy-storm-duster",
                "trap",
                face_down=True,
                set_turn=1,
            ),
        )
        monster = put(state, "ai", "monster_zone", new_card("monster", owner="ai"))
        spell_traps = [
            put(state, "ai", "spell_trap_zone", new_card(f"spell-{index}", "spell", owner="ai"))
            for index in range(3)
        ]

        with self.assertRaises(DuelRuleError):
            activate_and_resolve(
                self.engine,
                state,
                "player",
                storm_duster,
                targets=(monster["instance_id"],),
            )
        with self.assertRaises(DuelRuleError):
            activate_and_resolve(
                self.engine,
                state,
                "player",
                storm_duster,
                targets=tuple(card["instance_id"] for card in spell_traps),
            )

    def test_gandora_pays_half_lp_banishes_other_cards_and_gains_atk(self):
        state = new_state()
        state["turn"] = 2
        gandora = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-gandora-the-dragon-of-destruction",
                atk=0,
                base_def=0,
                race="Rồng",
            ),
        )
        own_spell = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("own-spell", "spell"),
        )
        protected_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("protected-monster", owner="ai"),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
            index=1,
        )
        equipped_spell = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "s-mask-of-the-accursed",
                "spell",
                owner="ai",
                target_instance_id=opponent_monster["instance_id"],
            ),
        )
        opponent_trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("opponent-trap", "trap", owner="ai"),
        )
        state["card_effect_protection"][protected_monster["instance_id"]] = state["turn"]

        action_engine = DuelActionEngine(self.engine)
        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": gandora["instance_id"],
            },
        )
        while state["chain"]["status"] == "open":
            state = action_engine.apply(
                state,
                player=state["chain"]["priority_player"],
                action={"type": "pass_chain"},
            )

        self.assertEqual(state["players"]["player"]["lp"], 4000)
        self.assertEqual(current_stats(state, gandora["instance_id"])["atk"], 1200)
        self.assertEqual(
            state["players"]["player"]["banished"][0]["instance_id"],
            own_spell["instance_id"],
        )
        self.assertEqual(
            {
                card["instance_id"]
                for card in state["players"]["ai"]["banished"]
            },
            {
                opponent_monster["instance_id"],
                equipped_spell["instance_id"],
                opponent_trap["instance_id"],
            },
        )
        self.assertEqual(
            state["players"]["ai"]["monster_zone"][0]["instance_id"],
            protected_monster["instance_id"],
        )

    def test_gandora_cannot_be_special_summoned_by_monster_reborn(self):
        state = new_state()
        gandora = put(
            state,
            "player",
            "graveyard",
            new_card("m-gandora-the-dragon-of-destruction"),
        )
        monster_reborn = put(
            state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=monster_reborn["instance_id"],
                effect_id="activate",
                target_instance_ids=(gandora["instance_id"],),
            )

    def test_gandora_is_sent_to_grave_after_normal_tribute_or_flip_summon(self):
        summon_states = (
            {"summon_method": "normal", "summoned_turn": 2},
            {"summon_method": "tribute", "summoned_turn": 2},
            {"flip_summoned_turn": 2},
        )
        for summon_state in summon_states:
            with self.subTest(summon_state=summon_state):
                state = new_state()
                state["turn"] = 2
                gandora = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(
                        "m-gandora-the-dragon-of-destruction",
                        **summon_state,
                    ),
                )

                resolve_end_phase_effects(state, "player")

                found = find_card(state, gandora["instance_id"])
                self.assertIsNotNone(found)
                self.assertEqual(found[1], "graveyard")

    def test_slifer_special_summoned_sent_to_grave_at_end_phase(self):
        state = new_state()
        state["turn"] = 1
        state["turn_player"] = "player"
        state["phase"] = "main1"
        slifer = put(
            state,
            "player",
            "graveyard",
            new_card("m-slifer-the-sky-dragon"),
        )
        reborn = put(state, "player", "hand", new_card("s-monster-reborn", "spell"))
        put(state, "player", "deck", new_card("player-draw-1"))
        put(state, "ai", "deck", new_card("ai-draw-1", owner="ai"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            reborn,
            targets=(slifer["instance_id"],),
        )
        self.assertEqual(find_card(state, slifer["instance_id"])[1], "monster_zone")

        state["phase"] = "end"
        actions = DuelActionEngine(self.engine)
        ended = actions.apply(state, player="player", action={"type": "advance_phase"})
        stages = ended.get("_ai_turn_stages", [])
        self.assertGreaterEqual(len(stages), 1)
        self.assertEqual(stages[0]["type"], "end")
        self.assertEqual(
            find_card(stages[0]["state"], slifer["instance_id"])[1],
            "graveyard",
        )
        self.assertEqual(find_card(ended, slifer["instance_id"])[1], "graveyard")

        tribute_state = new_state()
        tribute_state["turn"] = 2
        tribute_slifer = put(
            tribute_state,
            "player",
            "monster_zone",
            new_card(
                "m-slifer-the-sky-dragon",
                summon_method="tribute",
                summoned_turn=2,
            ),
        )
        resolve_end_phase_effects(tribute_state, "player")
        self.assertEqual(
            find_card(tribute_state, tribute_slifer["instance_id"])[1],
            "monster_zone",
        )

    def test_slifer_thunderforce_modifier_expires_when_monster_leaves_field(self):
        state = new_state()
        state["turn"] = 2
        state["turn_player"] = "ai"
        state["phase"] = "main1"
        slifer = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-slifer-the-sky-dragon",
                summon_method="tribute",
                summoned_turn=1,
            ),
        )
        blue_eyes = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-blue-eyes-white-dragon",
                owner="ai",
                atk=3000,
                defense=2500,
            ),
        )
        actions = DuelActionEngine(self.engine)
        actions._apply_slifer_summon_effect(state, "ai", blue_eyes)
        self.assertEqual(current_stats(state, blue_eyes["instance_id"])["atk"], 1000)

        destroy_card(state, blue_eyes["instance_id"], by_player="player")
        destroy_card(state, slifer["instance_id"], by_player="ai")
        reborn = put(state, "ai", "hand", new_card("s-monster-reborn", "spell", owner="ai"))
        state = activate_and_resolve(
            self.engine,
            state,
            "ai",
            reborn,
            targets=(blue_eyes["instance_id"],),
        )
        self.assertEqual(find_card(state, blue_eyes["instance_id"])[1], "monster_zone")
        self.assertEqual(current_stats(state, blue_eyes["instance_id"])["atk"], 3000)

    def test_crass_clown_returns_opponent_monster_to_its_owners_hand(self):
        state = new_state()
        state["turn"] = 2
        state["normal_summon_used"] = {"player": False, "ai": False}
        clown = put(
            state,
            "player",
            "hand",
            new_card("m-crass-clown"),
        )
        opponent_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "owned-by-player",
                owner="player",
                controller="ai",
            ),
        )
        action_engine = DuelActionEngine(self.engine)

        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": clown["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )

        self.assertEqual(state["pending_decision"]["effect_card_id"], "m-crass-clown")
        self.assertEqual(state["pending_decision"]["target_player"], "ai")
        self.assertEqual(
            state["pending_decision"]["target_mode"],
            "field-opponent-monster",
        )
        with self.assertRaises(DuelRuleError):
            action_engine.apply(
                state,
                player="player",
                action={
                    "type": "complete_card_selection",
                    "instance_ids": [clown["instance_id"]],
                },
            )

        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [opponent_monster["instance_id"]],
            },
        )

        returned = find_card(state, opponent_monster["instance_id"])
        self.assertEqual(returned[0], "player")
        self.assertEqual(returned[1], "hand")
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, clown["instance_id"])[1], "monster_zone")

    def test_crass_clown_does_not_wait_for_target_when_opponent_has_no_monsters(self):
        state = new_state()
        state["turn"] = 2
        state["normal_summon_used"] = {"player": False, "ai": False}
        clown = put(
            state,
            "player",
            "hand",
            new_card("m-crass-clown"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": clown["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, clown["instance_id"])[1], "monster_zone")

    def test_crass_clown_does_not_trigger_when_only_changing_position(self):
        state = new_state()
        state["turn"] = 2
        clown = put(
            state,
            "player",
            "monster_zone",
            new_card("m-crass-clown", position="defense"),
        )
        put(state, "ai", "monster_zone", new_card("opponent-monster", owner="ai"))

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "change_position",
                "instance_id": clown["instance_id"],
            },
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(
            find_card(state, clown["instance_id"])[3]["position"],
            "attack",
        )

    def test_crass_clown_triggers_when_flip_summoned_into_attack_position(self):
        state = new_state()
        state["turn"] = 2
        clown = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-crass-clown",
                face_down=True,
                position="defense",
                set_turn=1,
            ),
        )
        put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-monster", owner="ai"),
        )

        state = DuelActionEngine(self.engine).apply(
            state,
            player="player",
            action={
                "type": "flip_summon",
                "instance_id": clown["instance_id"],
            },
        )

        self.assertEqual(
            state["pending_decision"]["effect_card_id"],
            "m-crass-clown",
        )
        self.assertFalse(find_card(state, clown["instance_id"])[3]["face_down"])

    def test_crass_clown_returns_fusion_monsters_to_the_extra_deck(self):
        state = new_state()
        state["turn"] = 2
        state["normal_summon_used"] = {"player": False, "ai": False}
        clown = put(
            state,
            "player",
            "hand",
            new_card("m-crass-clown"),
        )
        fusion = put(
            state,
            "ai",
            "monster_zone",
            new_card("fusion-monster", "fusion", owner="ai"),
        )
        action_engine = DuelActionEngine(self.engine)
        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": clown["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )

        state = action_engine.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [fusion["instance_id"]],
            },
        )

        self.assertEqual(find_card(state, fusion["instance_id"])[1], "extra_deck")

    def test_crass_clown_triggers_when_special_summoned(self):
        state = new_state()
        crass_clown = put(
            state,
            "player",
            "graveyard",
            new_card("m-crass-clown"),
        )
        monster_reborn = put(
            state,
            "player",
            "hand",
            new_card("s-monster-reborn", "spell"),
        )
        put(state, "ai", "monster_zone", new_card("opponent-monster", owner="ai"))

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            monster_reborn,
            targets=(crass_clown["instance_id"],),
        )

        self.assertEqual(
            state["pending_decision"]["effect_card_id"],
            "m-crass-clown",
        )
        self.assertEqual(find_card(state, crass_clown["instance_id"])[1], "monster_zone")


    def test_twin_twisters_human_discard_and_target_flow(self):
        state = new_state()
        twin = put(state, "player", "hand", new_card("s-twin-twisters", "spell"))
        put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        own_target = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-swords-of-revealing-light", "spell", face_down=False),
        )
        target = put(state, "ai", "spell_trap_zone", new_card("t-soul-shield", "trap", owner="ai", face_down=True))
        action_engine = DuelActionEngine(DuelEffectEngine(build_effect_registry()))

        with self.assertRaisesRegex(DuelRuleError, "bỏ 1 lá bài làm chi phí"):
            action_engine.apply(
                state,
                player="player",
                action={
                    "type": "activate_effect",
                    "source_instance_id": twin["instance_id"],
                    "target_instance_ids": [target["instance_id"]],
                },
            )
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, twin["instance_id"])[1], "hand")

        state = action_engine.apply(
            state,
            player="player",
            action={"type": "activate_effect", "source_instance_id": twin["instance_id"]},
        )
        self.assertEqual(state["pending_decision"]["type"], "twin_twisters_discard")

        discard = next(card for card in state["players"]["player"]["hand"] if card["instance_id"] != twin["instance_id"])
        state = action_engine.apply(
            state,
            player="player",
            action={"type": "complete_discard", "instance_ids": [discard["instance_id"]]},
        )
        self.assertEqual(state["pending_decision"]["effect_card_id"], "s-twin-twisters")
        self.assertEqual(
            state["pending_decision"]["target_mode"],
            "field-opponent-spell-trap",
        )

        for invalid_target in (twin["instance_id"], own_target["instance_id"]):
            with self.assertRaisesRegex(DuelRuleError, "Mục tiêu không hợp lệ"):
                action_engine.apply(
                    state,
                    player="player",
                    action={
                        "type": "complete_card_selection",
                        "instance_ids": [invalid_target],
                    },
                )

        state = action_engine.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": [target["instance_id"]]},
        )
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, twin["instance_id"])[1], "graveyard")

    def test_twin_twisters_requires_opponent_backrow_before_cost(self):
        state = new_state()
        twin = put(state, "player", "hand", new_card("s-twin-twisters", "spell"))
        put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-swords-of-revealing-light", "spell", face_down=False),
        )
        action_engine = DuelActionEngine(DuelEffectEngine(build_effect_registry()))

        with self.assertRaisesRegex(DuelRuleError, "đối thủ có Lá Phép/Bẫy"):
            action_engine.apply(
                state,
                player="player",
                action={
                    "type": "activate_effect",
                    "source_instance_id": twin["instance_id"],
                },
            )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(len(state["players"]["player"]["hand"]), 2)

    def test_dicephoon_human_pending_target_flow(self):
        state = new_state()
        dice = put(state, "player", "hand", new_card("s-dicephoon", "spell"))
        target = put(state, "ai", "spell_trap_zone", new_card("t-soul-shield", "trap", owner="ai", face_down=True))
        engine = DuelEffectEngine(build_effect_registry(random_source=lambda: 0.25))
        state = engine.activate(
            state,
            player="player",
            source_instance_id=dice["instance_id"],
            effect_id="activate",
        )
        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")
        self.assertEqual(state["pending_decision"]["effect_card_id"], "s-dicephoon")
        self.assertEqual(state["pending_decision"]["target_mode"], "field-opponent-spell-trap")
        complete_pending_card_selection(state, "player", [target["instance_id"]])
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, dice["instance_id"])[1], "graveyard")

    def test_dicephoon_roll_5_destroys_up_to_two_opponent_monsters_and_fizzles_when_empty(self):
        # Roll 5 with 2 opponent monsters (1 face-up, 1 face-down): destroys both.
        state = new_state()
        dice = put(state, "player", "hand", new_card("s-dicephoon", "spell"))
        opp_mon_1 = put(state, "ai", "monster_zone", new_card("opp-1", owner="ai", face_down=False))
        opp_mon_2 = put(state, "ai", "monster_zone", new_card("opp-2", owner="ai", face_down=True))
        engine = DuelEffectEngine(build_effect_registry(random_source=lambda: 0.7))  # roll = 5
        state = engine.activate(
            state,
            player="player",
            source_instance_id=dice["instance_id"],
            effect_id="activate",
        )
        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")
        self.assertEqual(state["pending_decision"]["target_mode"], "field-opponent-monster")
        self.assertEqual(state["pending_decision"]["max_count"], 2)
        complete_pending_card_selection(
            state,
            "player",
            [opp_mon_1["instance_id"], opp_mon_2["instance_id"]],
        )
        self.assertEqual(find_card(state, opp_mon_1["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, opp_mon_2["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, dice["instance_id"])[1], "graveyard")

        # Roll 2..4 or 5 with NO valid opponent targets: moves straight to Graveyard with no pending_decision.
        empty_state = new_state()
        dice_empty = put(empty_state, "player", "hand", new_card("s-dicephoon", "spell"))
        empty_state = engine.activate(
            empty_state,
            player="player",
            source_instance_id=dice_empty["instance_id"],
            effect_id="activate",
        )
        empty_state = engine.pass_priority(empty_state, player="ai")
        empty_state = engine.pass_priority(empty_state, player="player")
        self.assertIsNone(empty_state.get("pending_decision"))
        self.assertEqual(find_card(empty_state, dice_empty["instance_id"])[1], "graveyard")

    def test_soul_exchange_marks_opponent_for_valid_tribute(self):
        state = new_state()
        soul = put(state, "player", "hand", new_card("s-soul-exchange", "spell"))
        opponent = put(state, "ai", "monster_zone", new_card("opponent-monster", owner="ai"))
        engine = DuelEffectEngine(build_effect_registry())
        state = engine.activate(
            state,
            player="player",
            source_instance_id=soul["instance_id"],
            effect_id="activate",
            target_instance_ids=[opponent["instance_id"]],
        )
        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")
        updated = find_card(state, opponent["instance_id"])
        self.assertEqual(updated[3]["soul_exchange_owner"], "player")
        self.assertEqual(updated[3]["soul_exchange_turn"], 1)

    def test_multiply_creates_defense_tokens_for_human(self):
        state = new_state()
        kuriboh = put(state, "player", "monster_zone", new_card("m-kuriboh"))
        multiply = put(state, "player", "hand", new_card("s-multiply", "spell"))
        engine = DuelEffectEngine(build_effect_registry())
        state = engine.activate(
            state,
            player="player",
            source_instance_id=multiply["instance_id"],
            effect_id="activate",
            target_instance_ids=[kuriboh["instance_id"]],
        )
        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")
        tokens = [card for card in state["players"]["player"]["monster_zone"] if card and card["card_id"] == "token-kuriboh"]
        self.assertEqual(len(tokens), 5)
        self.assertTrue(all(card["position"] == "defense" for card in tokens))
        token = tokens[0]
        token_zone_index = next(
            index
            for index, card in enumerate(state["players"]["player"]["monster_zone"])
            if card and card["instance_id"] == token["instance_id"]
        )
        tribute_monster = put(
            state,
            "player",
            "hand",
            new_card("multiply-tribute-test", level=5),
        )
        state = DuelActionEngine(engine).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": tribute_monster["instance_id"],
                "zone_index": token_zone_index,
                "tribute_instance_ids": [token["instance_id"]],
            },
        )
        self.assertIsNone(find_card(state, token["instance_id"]))
        self.assertFalse(
            any(
                card.get("card_id") == "token-kuriboh"
                for card in state["players"]["player"]["graveyard"]
            )
        )
        self.assertEqual(
            state["players"]["player"]["monster_zone"][token_zone_index]["card_id"],
            "multiply-tribute-test",
        )


    def test_berfomet_normal_summon_searches_gazelle(self):
        state = new_state()
        berfomet = put(state, "player", "hand", new_card("m-berfomet"))
        gazelle = put(state, "player", "deck", new_card("m-gazelle-king-of-mythical-beasts"))
        state = DuelActionEngine(DuelEffectEngine(build_effect_registry())).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": berfomet["instance_id"],
                "zone_index": 0,
                "position": "attack",
            },
        )
        self.assertIn(gazelle["instance_id"], [card["instance_id"] for card in state["players"]["player"]["hand"]])

    def test_odd_eyes_tribute_summon_pending_destroy(self):
        state = new_state()
        odd = put(state, "player", "hand", new_card("m-odd-eyes-advance-dragon", level=5))
        tribute = put(state, "player", "monster_zone", new_card("m-double-coston"))
        opponent = put(state, "ai", "monster_zone", new_card("opponent-monster", owner="ai"))
        state = DuelActionEngine(DuelEffectEngine(build_effect_registry())).apply(
            state,
            player="player",
            action={
                "type": "summon",
                "instance_id": odd["instance_id"],
                "zone_index": 1,
                "position": "attack",
                "tribute_instance_ids": [tribute["instance_id"]],
            },
        )
        self.assertEqual(state["pending_decision"]["effect_card_id"], "m-odd-eyes-advance-dragon")
        state = DuelActionEngine(DuelEffectEngine(build_effect_registry())).apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": [opponent["instance_id"]]},
        )
        found = find_card(state, opponent["instance_id"])
        self.assertIsNotNone(found)
        self.assertEqual(found[1], "graveyard")

    def test_burning_dragon_special_summon_and_discard_effect_work_in_duel(self):
        state = new_state()
        state["turn"] = 2
        state["first_player"] = "ai"
        burning = put(
            state,
            "player",
            "hand",
            new_card("m-burning-dragon", atk=2500, **{"def": 2100}),
        )
        spell_cost = put(
            state,
            "player",
            "hand",
            new_card("s-pot-of-greed", "spell"),
        )
        own_backrow = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-soul-shield", "trap"),
        )
        enemy_backrow = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-soul-shield", "trap", owner="ai"),
        )
        put(state, "ai", "monster_zone", new_card("enemy-one", owner="ai"))
        put(state, "ai", "monster_zone", new_card("enemy-two", owner="ai"))
        actions = DuelActionEngine(DuelEffectEngine(build_effect_registry()))

        state = actions.apply(
            state,
            player="player",
            action={"type": "activate_effect", "source_instance_id": burning["instance_id"]},
        )
        state = resolve_action_chain(actions, state)
        self.assertEqual(find_card(state, burning["instance_id"])[1], "monster_zone")
        self.assertEqual(state["pending_decision"]["type"], "burning_dragon_discard")

        state = actions.apply(
            state,
            player="player",
            action={"type": "complete_discard", "instance_ids": [spell_cost["instance_id"]]},
        )
        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, spell_cost["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, enemy_backrow["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, own_backrow["instance_id"])[1], "spell_trap_zone")

    def test_burning_dragon_optional_trigger_can_be_skipped(self):
        state = new_state()
        state["turn"] = 2
        state["first_player"] = "ai"
        burning = put(
            state,
            "player",
            "hand",
            new_card("m-burning-dragon", atk=2500, **{"def": 2100}),
        )
        put(state, "player", "hand", new_card("s-pot-of-greed", "spell"))
        put(state, "ai", "monster_zone", new_card("enemy-one", owner="ai"))
        put(state, "ai", "monster_zone", new_card("enemy-two", owner="ai"))
        actions = DuelActionEngine(DuelEffectEngine(build_effect_registry()))

        state = actions.apply(
            state,
            player="player",
            action={"type": "activate_effect", "source_instance_id": burning["instance_id"]},
        )
        state = resolve_action_chain(actions, state)
        self.assertEqual(state["pending_decision"]["type"], "burning_dragon_discard")
        state = actions.apply(
            state,
            player="player",
            action={"type": "skip_burning_dragon_effect"},
        )
        self.assertIsNone(state["pending_decision"])
        self.assertIsNone(state.get("effect_uses", {}).get("player:m-burning-dragon:destroy-backrow"))


class PalladiumOracleManaTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry())
        self.actions = DuelActionEngine(self.engine)

    def test_quick_effect_can_chain_from_hand_to_opponents_activation(self):
        self.engine.registry.register(
            EffectDefinition(
                card_id="m-test-opponent-effect",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=lambda _state, _context: None,
                source_zones=frozenset({"monster_zone"}),
                phases=frozenset({"main1"}),
            )
        )
        state = new_state()
        mana = put(
            state,
            "player",
            "hand",
            new_card("m-palladium-oracle-mana", race="Spellcaster"),
        )
        opponent_effect = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-test-opponent-effect", owner="ai"),
        )

        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=opponent_effect["instance_id"],
            effect_id="activate",
        )
        options = self.engine.chain_response_options(state, "player")
        mana_option = next(
            option for option in options
            if option["source_instance_id"] == mana["instance_id"]
        )
        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=mana_option["source_instance_id"],
            effect_id=mana_option["effect_id"],
        )
        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")

        summoned = find_card(state, mana["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertEqual(summoned[3]["summon_method"], "special")

    def test_ai_chains_mana_from_hand_to_player_activation(self):
        self.engine.registry.register(
            EffectDefinition(
                card_id="m-test-player-effect",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=lambda _state, _context: None,
                source_zones=frozenset({"monster_zone"}),
                phases=frozenset({"main1"}),
            )
        )
        state = new_state()
        mana = put(
            state,
            "ai",
            "hand",
            new_card(
                "m-palladium-oracle-mana",
                owner="ai",
                race="Spellcaster",
            ),
        )
        player_effect = put(
            state,
            "player",
            "monster_zone",
            new_card("m-test-player-effect"),
        )

        state = self.engine.activate(
            state,
            player="player",
            source_instance_id=player_effect["instance_id"],
            effect_id="activate",
        )
        state = self.actions._pass_ai_priority(state)
        self.assertEqual(
            state["chain"]["links"][-1]["source_instance_id"],
            mana["instance_id"],
        )
        state = self.actions.apply(
            state,
            player="player",
            action={"type": "pass_chain"},
        )

        self.assertEqual(
            find_card(state, mana["instance_id"])[1],
            "monster_zone",
        )

    def test_face_up_mana_protects_spellcasters_from_effect_destruction(self):
        state = new_state()
        mana = put(
            state,
            "player",
            "monster_zone",
            new_card("m-palladium-oracle-mana", race="Phù thủy"),
        )
        spellcaster = put(
            state,
            "player",
            "monster_zone",
            new_card("friendly-spellcaster", race="Spellcaster"),
        )

        self.assertIsNone(
            destroy_card(
                state,
                spellcaster["instance_id"],
                by_player="ai",
            )
        )
        self.assertEqual(
            find_card(state, spellcaster["instance_id"])[1],
            "monster_zone",
        )
        self.assertIsNone(
            destroy_card(state, mana["instance_id"], by_player="ai")
        )
        battle_spellcaster = put(
            state,
            "player",
            "monster_zone",
            new_card("battle-spellcaster", race="Spellcaster"),
        )
        destroyed_in_battle = destroy_card(
            state,
            battle_spellcaster["instance_id"],
            by_player="ai",
            by_battle=True,
        )
        self.assertIsNotNone(destroyed_in_battle)
        self.assertEqual(
            find_card(state, battle_spellcaster["instance_id"])[1],
            "graveyard",
        )

        mana["monster_effects_negated"] = True
        destroyed = destroy_card(
            state,
            spellcaster["instance_id"],
            by_player="ai",
        )
        self.assertIsNotNone(destroyed)
        self.assertEqual(
            find_card(state, spellcaster["instance_id"])[1],
            "graveyard",
        )

    def test_destruction_trigger_summons_dark_magician_girl_with_battle_protection(self):
        state = new_state()
        mana = put(
            state,
            "player",
            "monster_zone",
            new_card("m-palladium-oracle-mana", race="Spellcaster"),
        )
        dark_magician_girl = put(
            state,
            "player",
            "deck",
            new_card("m-dark-magician-girl", race="Spellcaster"),
        )
        mana["monster_effects_negated"] = True
        destroy_card(state, mana["instance_id"], by_player="ai")
        self.actions._resolve_pending_card_triggers(state)

        pending = state["pending_decision"]
        self.assertEqual(pending["effect_card_id"], "m-palladium-oracle-mana")
        self.assertIn(
            dark_magician_girl["instance_id"],
            pending["eligible_target_instance_ids"],
        )
        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [dark_magician_girl["instance_id"]],
            },
        )

        summoned = find_card(state, dark_magician_girl["instance_id"])
        self.assertEqual(summoned[1], "monster_zone")
        self.assertTrue(summoned[3]["cannot_be_destroyed_by_battle"])

    def test_battle_destruction_also_queues_manas_optional_trigger(self):
        state = new_state()
        mana = put(
            state,
            "player",
            "monster_zone",
            new_card("m-palladium-oracle-mana", race="Spellcaster"),
        )
        put(
            state,
            "player",
            "graveyard",
            new_card("m-dark-magician-girl", race="Spellcaster"),
        )

        destroy_card(
            state,
            mana["instance_id"],
            by_player="ai",
            by_battle=True,
        )
        self.actions._resolve_pending_card_triggers(state)

        self.assertEqual(
            state["pending_decision"]["effect_card_id"],
            "m-palladium-oracle-mana",
        )

    def test_dark_magician_girl_granted_battle_protection_survives_losing_battle(self):
        state = new_state()
        state["phase"] = "battle"
        state["turn_player"] = "ai"
        dark_magician_girl = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-dark-magician-girl",
                race="Spellcaster",
                atk=2000,
                **{"def": 1700, "cannot_be_destroyed_by_battle": True},
            ),
        )
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("opponent-attacker", owner="ai", atk=2500),
        )

        state = self.actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": dark_magician_girl["instance_id"],
            },
        )

        self.assertEqual(
            find_card(state, dark_magician_girl["instance_id"])[1],
            "monster_zone",
        )
        self.assertEqual(state["players"]["player"]["lp"], 7500)
        destroy_card(
            state,
            dark_magician_girl["instance_id"],
            by_player="ai",
        )
        self.assertNotIn(
            "cannot_be_destroyed_by_battle",
            find_card(state, dark_magician_girl["instance_id"])[3],
        )


class BlackLusterSoldierTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry())
        self.actions = DuelActionEngine(self.engine)

    def test_special_summon_requires_light_and_dark_graveyard_monsters(self):
        state = new_state()
        soldier = put(
            state,
            "player",
            "hand",
            new_card(
                "m-black-luster-soldier-envoy-of-the-beginning",
                attribute="LIGHT",
            ),
        )
        light = put(
            state,
            "player",
            "graveyard",
            new_card("light-material", attribute="LIGHT"),
        )
        dark = put(
            state,
            "player",
            "graveyard",
            new_card("dark-material", attribute="DARK"),
        )

        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "special_summon_black_luster_soldier",
                "source_instance_id": soldier["instance_id"],
                "tribute_instance_ids": [light["instance_id"], dark["instance_id"]],
            },
        )

        summoned = find_card(state, soldier["instance_id"])
        self.assertIsNotNone(summoned)
        self.assertEqual(summoned[1], "monster_zone")
        self.assertEqual(summoned[3]["position"], "attack")
        self.assertEqual(summoned[3]["summon_method"], "special")
        light_location = find_card(state, light["instance_id"])
        dark_location = find_card(state, dark["instance_id"])
        self.assertEqual(light_location[1], "banished")
        self.assertEqual(dark_location[1], "banished")

    def test_banish_effect_targets_monster_and_blocks_attack_this_turn(self):
        state = new_state()
        soldier = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-black-luster-soldier-envoy-of-the-beginning",
                attribute="LIGHT",
                atk=3000,
                def_=2500,
            ),
        )
        target = put(
            state,
            "ai",
            "monster_zone",
            new_card("enemy-monster", owner="ai"),
        )

        state = activate_and_resolve(
            self.engine,
            state,
            "player",
            soldier,
            effect_id="banish_monster",
            targets=(target["instance_id"],),
        )

        banished_location = find_card(state, target["instance_id"])
        self.assertIsNotNone(banished_location)
        self.assertEqual(banished_location[1], "banished")
        self.assertFalse(
            can_declare_attack(state, "player", soldier["instance_id"])
        )
        with self.assertRaises(DuelRuleError):
            activate_and_resolve(
                self.engine,
                state,
                "player",
                soldier,
                effect_id="banish_monster",
                targets=(soldier["instance_id"],),
            )

    def test_battle_destruction_grants_one_second_attack(self):
        state = new_state()
        state["turn"] = 2
        state["phase"] = "battle"
        state["turn_player"] = "player"
        soldier = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-black-luster-soldier-envoy-of-the-beginning",
                attribute="LIGHT",
                atk=3000,
                def_=2500,
            ),
        )
        defender = put(
            state,
            "ai",
            "monster_zone",
            new_card("enemy-monster", owner="ai", atk=1000, def_=800),
        )

        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": soldier["instance_id"],
                "defender_instance_id": defender["instance_id"],
            },
        )
        resolved_soldier = find_card(state, soldier["instance_id"])[3]
        self.assertEqual(
            resolved_soldier["black_luster_second_attack"],
            state["turn"],
        )
        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "attack",
                "attacker_instance_id": soldier["instance_id"],
                "defender_instance_id": None,
            },
        )
        self.assertEqual(state["players"]["ai"]["lp"], 3000)


class CloningTrapTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry())
        self.actions = DuelActionEngine(self.engine)

    def _armed_state(self, trap_owner="player", summoned_card_id="m-night-assailant"):
        state = new_state()
        state["turn"] = 2
        trap = put(
            state,
            trap_owner,
            "spell_trap_zone",
            new_card(
                "t-cloning",
                "trap",
                owner=trap_owner,
                face_down=True,
                set_turn=1,
            ),
        )
        summoned_player = "ai" if trap_owner == "player" else "player"
        summoned = put(
            state,
            summoned_player,
            "monster_zone",
            new_card(
                summoned_card_id,
                owner=summoned_player,
                skills=[{"name": "Kỹ năng", "description": "Skill text"}],
                monsterType="Hiệu quả",
                attribute="DARK",
                image="assets/images/artwork/test-monster.png",
                atk=1200,
                **{"def": 1000},
                summon_method="normal",
                summoned_turn=2,
            ),
        )
        return state, trap, summoned

    def test_player_can_clone_a_summoned_monster_without_copying_skills(self):
        state, trap, summoned = self._armed_state()
        resolve_monster_summon_effects(
            state, "ai", summoned["instance_id"], "normal"
        )
        state = add_stat_modifier(
            state,
            target_instance_id=summoned["instance_id"],
            source_instance_id=summoned["instance_id"],
            source_card_id=summoned["card_id"],
            owner="ai",
            stat="atk",
            operation="increase",
            value=500,
            duration={"type": "permanent"},
        )
        self.actions._resolve_pending_card_triggers(state)

        self.assertEqual(state["pending_decision"]["type"], "cloning_offer")
        state = self.actions.apply(
            state,
            player="player",
            action={"type": "activate_cloning"},
        )
        state = resolve_action_chain(self.actions, state)

        token = next(
            card
            for card in state["players"]["player"]["monster_zone"]
            if card and card.get("is_token")
        )
        self.assertEqual(token["name"], "Clone Token")
        self.assertEqual(token["card_id"], "token-clone")
        self.assertEqual(token["token_source_instance_id"], summoned["instance_id"])
        self.assertEqual(current_stats(state, summoned["instance_id"])["atk"], 1700)
        self.assertEqual(token["base_atk"], 1200)
        self.assertEqual(token["base_def"], 1000)
        self.assertEqual(token["race"], summoned["race"])
        self.assertEqual(token["attribute"], "DARK")
        self.assertEqual(token["level"], summoned["level"])
        self.assertEqual(token["monsterType"], summoned["monsterType"])
        self.assertEqual(token["image"], summoned["image"])
        self.assertNotIn("skills", token)
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

        destroy_card(state, summoned["instance_id"], by_player="player")
        self.assertIsNone(find_card(state, token["instance_id"]))
        self.assertFalse(
            any(
                card and card["instance_id"] == token["instance_id"]
                for card in state["players"]["player"]["graveyard"]
            )
        )
        self.assertTrue(
            any(
                trigger.get("card_id") == "m-night-assailant"
                for trigger in state.get("pending_card_triggers", [])
            )
        )

    def test_cloning_no_longer_requires_the_target_skill_to_be_supported(self):
        state, trap, summoned = self._armed_state(
            summoned_card_id="m-odd-eyes-advance-dragon"
        )
        resolve_monster_summon_effects(
            state, "ai", summoned["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)

        self.assertEqual(state["pending_decision"]["type"], "cloning_offer")
        state = self.actions.apply(
            state,
            player="player",
            action={"type": "activate_cloning"},
        )
        state = resolve_action_chain(self.actions, state)
        token = next(
            card
            for card in state["players"]["player"]["monster_zone"]
            if card and card.get("is_token")
        )
        self.assertNotIn("skills", token)
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")

    def test_clone_token_survives_when_target_is_banished_instead_of_sent_to_grave(self):
        state, _, summoned = self._armed_state()
        resolve_monster_summon_effects(
            state, "ai", summoned["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)
        state = self.actions.apply(
            state,
            player="player",
            action={"type": "activate_cloning"},
        )
        state = resolve_action_chain(self.actions, state)
        token = next(
            card
            for card in state["players"]["player"]["monster_zone"]
            if card and card.get("is_token")
        )

        destroy_card(
            state,
            summoned["instance_id"],
            by_player="player",
            destination_zone="banished",
        )

        self.assertIsNotNone(find_card(state, token["instance_id"]))
        self.assertEqual(find_card(state, summoned["instance_id"])[1], "banished")

    def test_clients_cannot_activate_cloning_without_queued_summon_prompt(self):
        state, trap, summoned = self._armed_state()
        with self.assertRaises(DuelRuleError):
            self.actions.apply(
                state,
                player="player",
                action={
                    "type": "activate_effect",
                    "source_instance_id": trap["instance_id"],
                    "effect_id": "activate",
                    "target_instance_ids": [summoned["instance_id"]],
                    "payload": {
                        "summoned_instance_id": summoned["instance_id"]
                    },
                },
            )

    def test_magical_dimension_direct_summon_queues_cloning_trigger(self):
        state = new_state()
        state["turn"] = 2
        trap = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card(
                "t-cloning",
                "trap",
                owner="ai",
                face_down=True,
                set_turn=1,
            ),
        )
        source = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("s-magical-dimension", "spell"),
        )
        summoned = put(
            state,
            "player",
            "hand",
            new_card("m-dark-magician-girl", race="Spellcaster"),
        )
        state["pending_decision"] = {
            "type": "select_field_cards",
            "player": "player",
            "source_instance_id": source["instance_id"],
            "effect_card_id": "s-magical-dimension",
            "selection_stage": "summon",
        }

        complete_pending_card_selection(
            state, "player", [summoned["instance_id"]]
        )

        self.assertEqual(find_card(state, summoned["instance_id"])[1], "monster_zone")
        self.assertEqual(
            find_card(state, summoned["instance_id"])[3]["summon_method"],
            "special",
        )
        self.assertEqual(
            state["pending_card_triggers"][0]["source_instance_id"],
            trap["instance_id"],
        )

    def test_only_face_up_normal_and_special_summons_queue_the_trap(self):
        for summon_method in ("normal", "tribute", "special"):
            state, _, summoned = self._armed_state()
            summoned["summon_method"] = summon_method
            resolve_monster_summon_effects(
                state, "ai", summoned["instance_id"], summon_method
            )
            self.assertEqual(
                len(state.get("pending_card_triggers", [])), 1
            )

        state, _, summoned = self._armed_state()
        resolve_monster_summon_effects(
            state, "ai", summoned["instance_id"], "flip"
        )
        self.assertFalse(state.get("pending_card_triggers"))

        state, _, summoned = self._armed_state()
        state["players"]["player"]["spell_trap_zone"][0]["set_turn"] = 2
        resolve_monster_summon_effects(
            state, "ai", summoned["instance_id"], "normal"
        )
        self.assertFalse(state.get("pending_card_triggers"))

    def test_ai_automatically_activates_cloning_for_a_supported_summon(self):
        state, trap, summoned = self._armed_state(trap_owner="ai")
        resolve_monster_summon_effects(
            state, "player", summoned["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)

        self.assertEqual(state["chain"]["status"], "open")
        state = resolve_action_chain(self.actions, state)
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")
        self.assertTrue(
            any(
                card and card.get("is_token")
                for card in state["players"]["ai"]["monster_zone"]
            )
        )


class CrushCardVirusTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry())
        self.actions = DuelActionEngine(self.engine)

    def test_ai_counter_trap_responds_to_virus_before_battle_continues(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
        virus = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-crush-card-virus",
                "trap",
                owner="player",
                face_down=True,
                set_turn=1,
            ),
        )
        target = put(
            state,
            "player",
            "monster_zone",
            new_card("dark-weak-monster", owner="player", attribute="DARK", atk=500),
        )
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("strong-attacker", owner="ai", atk=1800),
        )
        jammer = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-trap-jammer", "trap", owner="ai", face_down=True, set_turn=1),
        )
        high_atk = put(
            state,
            "ai",
            "hand",
            new_card("high-atk-hand", owner="ai", atk=1600),
        )

        state = self.actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": target["instance_id"],
            },
        )

        self.assertEqual(state["chain"]["status"], "open")
        self.assertEqual(state["chain"]["priority_player"], "player")
        self.assertEqual(
            [link["card_id"] for link in state["chain"]["links"]],
            ["t-crush-card-virus", "t-trap-jammer"],
        )
        self.assertFalse(find_card(state, virus["instance_id"])[3].get("crush_card_virus_armed"))

        state = self.actions.apply(
            state, player="player", action={"type": "pass_chain"}
        )

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, jammer["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, high_atk["instance_id"])[1], "hand")

    def test_player_can_chain_a_counter_to_ai_response_and_lifo_resumes_battle(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
        virus = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-crush-card-virus",
                "trap",
                owner="player",
                face_down=True,
                set_turn=1,
            ),
        )
        target = put(
            state,
            "player",
            "monster_zone",
            new_card("dark-weak-monster", owner="player", attribute="DARK", atk=500),
        )
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("strong-attacker", owner="ai", atk=1800),
        )
        jammer = put(
            state,
            "ai",
            "spell_trap_zone",
            new_card("t-trap-jammer", "trap", owner="ai", face_down=True, set_turn=1),
        )
        bribe = put(
            state,
            "player",
            "spell_trap_zone",
            new_card("t-dark-bribe", "trap", owner="player", face_down=True, set_turn=1),
        )
        high_atk = put(
            state,
            "ai",
            "hand",
            new_card("high-atk-hand", owner="ai", atk=1600),
        )
        low_atk_draw = put(
            state,
            "ai",
            "deck",
            new_card("low-atk-draw", owner="ai", atk=100),
        )

        state = self.actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": target["instance_id"],
            },
        )
        self.assertEqual(state["chain"]["links"][-1]["card_id"], "t-trap-jammer")
        self.assertTrue(
            any(
                option["source_instance_id"] == bribe["instance_id"]
                for option in self.actions.chain_response_options(state, "player")
            )
        )

        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": bribe["instance_id"],
                "effect_id": "activate",
            },
        )
        self.assertEqual(
            [link["card_id"] for link in state["chain"]["links"]],
            ["t-crush-card-virus", "t-trap-jammer", "t-dark-bribe"],
        )
        state = self.actions.apply(
            state, player="player", action={"type": "pass_chain"}
        )

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(find_card(state, virus["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, jammer["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, bribe["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, high_atk["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, low_atk_draw["instance_id"])[1], "hand")

    def test_attack_does_not_activate_virus_for_light_or_1000_atk_targets(self):
        for attribute, atk in (("LIGHT", 500), ("DARK", 1000)):
            with self.subTest(attribute=attribute, atk=atk):
                state = new_state()
                state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
                virus = put(
                    state,
                    "player",
                    "spell_trap_zone",
                    new_card(
                        "t-crush-card-virus",
                        "trap",
                        owner="player",
                        face_down=True,
                        set_turn=1,
                    ),
                )
                target = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card(
                        "target-monster",
                        owner="player",
                        attribute=attribute,
                        atk=atk,
                    ),
                )
                attacker = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card("attacker", owner="ai", atk=1800),
                )

                state = self.actions.apply(
                    state,
                    player="ai",
                    action={
                        "type": "attack",
                        "attacker_instance_id": attacker["instance_id"],
                        "defender_instance_id": target["instance_id"],
                    },
                )

                self.assertEqual(state["chain"]["status"], "closed")
                found_virus = find_card(state, virus["instance_id"])
                self.assertEqual(found_virus[1], "spell_trap_zone")
                self.assertTrue(found_virus[3]["face_down"])

    def test_attack_activates_virus_and_sends_all_high_atk_opponent_monsters_to_grave(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
        virus = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-crush-card-virus",
                "trap",
                owner="player",
                face_down=True,
                set_turn=1,
            ),
        )
        target = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "dark-weak-monster",
                owner="player",
                attribute="DARK",
                atk=500,
            ),
        )
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("strong-attacker", owner="ai", atk=1800),
        )
        hand_monster = put(
            state,
            "ai",
            "hand",
            new_card("high-atk-hand", owner="ai", atk=1500),
        )
        deck_monster = put(
            state,
            "ai",
            "deck",
            new_card("high-atk-deck", owner="ai", atk=2000),
        )
        field_monster = put(
            state,
            "ai",
            "monster_zone",
            new_card("high-atk-field", owner="ai", atk=1600),
        )
        low_atk_monster = put(
            state,
            "ai",
            "hand",
            new_card("low-atk-hand", owner="ai", atk=1499),
        )
        spell = put(state, "ai", "hand", new_card("spell-in-hand", "spell", owner="ai"))

        state = self.actions.apply(
            state,
            player="ai",
            action={
                "type": "attack",
                "attacker_instance_id": attacker["instance_id"],
                "defender_instance_id": target["instance_id"],
            },
        )
        self.assertEqual(state["chain"]["status"], "open")
        self.assertEqual(state["chain"]["priority_player"], "player")
        self.assertEqual(find_card(state, target["instance_id"])[1], "monster_zone")
        self.assertFalse(find_card(state, virus["instance_id"])[3].get("crush_card_virus_armed"))
        state = resolve_action_chain(self.actions, state)

        self.assertEqual(find_card(state, virus["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        for monster in (hand_monster, deck_monster, field_monster):
            found = find_card(state, monster["instance_id"])
            self.assertEqual(found[1], "graveyard")
            self.assertTrue(found[3]["crush_card_virus_no_special_summon_from_graveyard"])
        self.assertEqual(find_card(state, low_atk_monster["instance_id"])[1], "hand")
        self.assertEqual(find_card(state, spell["instance_id"])[1], "hand")
        with self.assertRaises(DuelRuleError):
            move_card(state, hand_monster["instance_id"], "ai", "monster_zone")

    def test_virus_does_not_trigger_when_qualifying_monster_is_destroyed_by_effect(self):
        state = new_state()
        target = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "dark-weak-monster",
                owner="player",
                attribute="DARK",
                atk=500,
            ),
        )
        virus = put(
            state,
            "player",
            "graveyard",
            new_card(
                "t-crush-card-virus",
                "trap",
                owner="player",
                crush_card_virus_armed=True,
                crush_card_virus_target_instance_id=target["instance_id"],
            ),
        )

        destroy_card(state, target["instance_id"], by_player="ai")

        self.assertEqual(find_card(state, virus["instance_id"])[1], "graveyard")
        self.assertFalse(state.get("pending_card_triggers"))

    def test_virus_effect_is_negated_if_trap_leaves_grave_before_resolution(self):
        state = new_state()
        target = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "dark-weak-monster",
                owner="player",
                attribute="DARK",
                atk=500,
            ),
        )
        virus = put(
            state,
            "player",
            "graveyard",
            new_card(
                "t-crush-card-virus",
                "trap",
                owner="player",
                crush_card_virus_armed=True,
                crush_card_virus_target_instance_id=target["instance_id"],
            ),
        )
        high_atk = put(
            state,
            "ai",
            "hand",
            new_card("high-atk-hand", owner="ai", atk=2000),
        )

        destroy_card(state, target["instance_id"], by_player="ai", by_battle=True)
        move_card(state, virus["instance_id"], "player", "banished")
        self.actions._resolve_pending_card_triggers(state)

        self.assertEqual(find_card(state, high_atk["instance_id"])[1], "hand")


class CloneDragonTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(build_effect_registry())
        self.actions = DuelActionEngine(self.engine)

    def test_player_can_skip_or_copy_a_supported_face_up_monster_effect(self):
        state = new_state()
        clone = put(
            state,
            "player",
            "hand",
            new_card(
                "m-clone-dragon",
                name="Rồng Vô Tính",
                description="Hiệu ứng gốc",
                skills=["Hiệu ứng gốc"],
                atk=1000,
                **{"def": 1000},
            ),
        )
        summoned = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "m-blue-eyes-alternative-white-dragon",
                atk=3000,
                **{"def": 2500},
            ),
        )
        opponent_target = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-blue-eyes-alternative-white-dragon",
                owner="ai",
                atk=1800,
            ),
        )
        unsupported = put(
            state,
            "ai",
            "monster_zone",
            new_card("unsupported-monster", owner="ai", atk=4000),
        )
        face_down = put(
            state,
            "ai",
            "monster_zone",
            new_card(
                "m-blue-eyes-alternative-white-dragon",
                owner="ai",
                face_down=True,
                atk=5000,
            ),
        )

        resolve_monster_summon_effects(
            state, "player", summoned["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)
        pending = state["pending_decision"]
        self.assertEqual(pending["effect_card_id"], "m-clone-dragon")
        self.assertIn(summoned["instance_id"], pending["eligible_target_instance_ids"])
        self.assertIn(opponent_target["instance_id"], pending["eligible_target_instance_ids"])
        self.assertNotIn(unsupported["instance_id"], pending["eligible_target_instance_ids"])
        self.assertNotIn(face_down["instance_id"], pending["eligible_target_instance_ids"])

        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "complete_card_selection",
                "instance_ids": [summoned["instance_id"]],
            },
        )
        copied = find_card(state, clone["instance_id"])[3]
        self.assertEqual(find_card(state, clone["instance_id"])[1], "monster_zone")
        self.assertEqual(copied["card_id"], "m-clone-dragon")
        self.assertEqual(
            copied["clone_dragon_copied_card_id"],
            "m-blue-eyes-alternative-white-dragon",
        )
        self.assertEqual((copied["base_atk"], copied["base_def"]), (3000, 2500))
        self.assertEqual(copied["name"], summoned["name"])
        copy_options = self.engine.copied_monster_effect_options(
            state,
            player="player",
            source_instance_id=clone["instance_id"],
        )
        self.assertTrue(
            any(
                option["effect_id"] == "activate"
                and option["target_instance_ids"] == [opponent_target["instance_id"]]
                for option in copy_options
            )
        )

        state = self.actions.apply(
            state,
            player="player",
            action={
                "type": "activate_effect",
                "source_instance_id": clone["instance_id"],
                "effect_id": "activate",
                "target_instance_ids": [opponent_target["instance_id"]],
            },
        )
        state = resolve_action_chain(self.actions, state)
        self.assertEqual(
            find_card(state, opponent_target["instance_id"])[1],
            "graveyard",
        )
        self.assertEqual(
            find_card(state, clone["instance_id"])[3]["card_id"],
            "m-clone-dragon",
        )

        destroy_card(state, clone["instance_id"], by_player="ai")
        self.actions._resolve_pending_card_triggers(state)
        restored = find_card(state, clone["instance_id"])[3]
        self.assertEqual(find_card(state, clone["instance_id"])[1], "graveyard")
        self.assertEqual(state["players"]["player"]["lp"], 9000)
        self.assertEqual(restored["name"], "Rồng Vô Tính")
        self.assertEqual(restored["description"], "Hiệu ứng gốc")
        self.assertEqual(restored["skills"], ["Hiệu ứng gốc"])
        self.assertEqual((restored["base_atk"], restored["base_def"]), (1000, 1000))
        self.assertNotIn("clone_dragon_original_values", restored)
        self.assertNotIn("clone_dragon_copied_card_id", restored)

    def test_player_can_skip_copying(self):
        state = new_state()
        clone = put(state, "player", "hand", new_card("m-clone-dragon"))
        summoned = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-alternative-white-dragon"),
        )
        resolve_monster_summon_effects(
            state, "player", summoned["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)

        state = self.actions.apply(
            state,
            player="player",
            action={"type": "complete_card_selection", "instance_ids": []},
        )

        self.assertIsNone(state["pending_decision"])
        self.assertEqual(find_card(state, clone["instance_id"])[1], "hand")

    def test_ai_copies_highest_current_atk_and_only_graveyard_destruction_gains_lp(self):
        state = new_state()
        state["turn_player"] = "ai"
        clone = put(state, "ai", "hand", new_card("m-clone-dragon", owner="ai"))
        lower = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-blue-eyes-alternative-white-dragon", owner="ai", atk=2500),
        )
        higher = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-alternative-white-dragon", atk=3000),
        )
        state = add_stat_modifier(
            state,
            target_instance_id=higher["instance_id"],
            source_instance_id=higher["instance_id"],
            source_card_id="m-blue-eyes-alternative-white-dragon",
            owner="player",
            stat="atk",
            operation="increase",
            value=500,
            duration={"type": "turn_end", "turn": state["turn"]},
        )
        state["players"]["player"]["lp"] = 7000

        resolve_monster_summon_effects(
            state, "ai", lower["instance_id"], "normal"
        )
        self.actions._resolve_pending_card_triggers(state)

        copied = find_card(state, clone["instance_id"])[3]
        self.assertEqual(find_card(state, clone["instance_id"])[1], "monster_zone")
        self.assertEqual(
            copied["clone_dragon_copied_card_id"],
            "m-blue-eyes-alternative-white-dragon",
        )
        self.assertEqual((copied["base_atk"], copied["base_def"]), (3500, 800))

        move_card(state, clone["instance_id"], "ai", "banished")
        self.actions._resolve_pending_card_triggers(state)
        self.assertEqual(state["players"]["ai"]["lp"], 8000)
        self.assertEqual(state["players"]["player"]["lp"], 7000)

    def _state_with_ai_copy(self):
        state = new_state()
        clone = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-clone-dragon", owner="ai"),
        )
        target = put(
            state,
            "player",
            "monster_zone",
            new_card("m-blue-eyes-alternative-white-dragon", atk=2500),
        )
        state = self.engine.apply_clone_dragon_copy(
            state,
            source_instance_id=clone["instance_id"],
            target_instance_id=target["instance_id"],
        )
        put(state, "ai", "deck", new_card("ai-draw", "spell", owner="ai"))
        put(state, "player", "deck", new_card("player-draw", "spell"))
        return state, clone, target

    def test_ai_activates_beneficial_copied_effect(self):
        state, clone, target = self._state_with_ai_copy()

        self.actions._run_ai_turn(state)

        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, clone["instance_id"])[1], "monster_zone")
        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(state["turn_player"], "player")
        self.assertNotIn("_pending_ai_turn", state)

    def test_ai_waits_for_player_chain_response_then_resumes_its_turn(self):
        response_card_id = "test-ai-copy-response"
        self.engine.registry.register(
            EffectDefinition(
                card_id=response_card_id,
                effect_id="activate",
                effect_type="quick",
                speed=2,
                resolve=lambda state, context: None,
                source_zones=frozenset({"hand"}),
                can_chain=True,
            )
        )
        state, _, target = self._state_with_ai_copy()
        response = put(
            state,
            "player",
            "hand",
            new_card(response_card_id),
        )

        self.actions._run_ai_turn(state)

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(find_card(state, target["instance_id"])[1], "graveyard")
        self.assertEqual(state["turn_player"], "player")
        self.assertNotIn("_pending_ai_turn", state)


class DuelAiTurnTests(unittest.TestCase):
    def setUp(self):
        self.engine = DuelEffectEngine(
            build_effect_registry(random_source=lambda: 0.5)
        )
        self.actions = DuelActionEngine(self.engine)

    def test_ai_does_not_re_equip_union_after_detaching_it_this_turn(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        y_dragon = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-y-dragon-head", owner="ai", race="Machine"),
        )
        x_head = put(
            state,
            "ai",
            "monster_zone",
            new_card("m-x-head-cannon", owner="ai", race="Machine"),
        )
        state["effect_uses"] = {
            f"{y_dragon['instance_id']}:m-y-dragon-head:union": state["turn"]
        }

        self.actions._ai_use_union_monsters(state)

        union_card = find_card(state, y_dragon["instance_id"])
        self.assertEqual(union_card[1], "monster_zone")
        self.assertFalse(union_card[3].get("union_equipped", False))
        self.assertEqual(
            state["effect_uses"][
                f"{y_dragon['instance_id']}:m-y-dragon-head:union"
            ],
            state["turn"],
        )

    def test_ai_discards_for_tricky_before_recording_its_special_summon(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        tricky = put(
            state,
            "ai",
            "hand",
            new_card("m-the-tricky", owner="ai", atk=2000),
        )
        cost = put(
            state,
            "ai",
            "hand",
            new_card("ai-discard-cost", owner="ai", atk=300),
        )
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        stages = state["_ai_turn_stages"]
        discard_stage = next(stage for stage in stages if stage["type"] == "discard")
        summon_stage = next(stage for stage in stages if stage["type"] == "summon")
        discard_state = discard_stage["state"]["players"]["ai"]
        summon_state = summon_stage["state"]["players"]["ai"]
        self.assertIn(cost["instance_id"], [
            card["instance_id"] for card in discard_state["graveyard"]
        ])
        self.assertIn(tricky["instance_id"], [
            card["instance_id"] for card in discard_state["hand"]
        ])
        self.assertFalse(any(discard_state["monster_zone"]))
        self.assertIn(tricky["instance_id"], [
            card["instance_id"] for card in summon_state["monster_zone"] if card
        ])
        self.assertLess(
            [stage["type"] for stage in stages].index("discard"),
            [stage["type"] for stage in stages].index("summon"),
        )

    def test_ai_activates_spell_summons_sets_trap_and_attacks_in_one_turn(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        monster = put(
            state,
            "ai",
            "hand",
            new_card("ai-monster", owner="ai", atk=1800),
        )
        pot = put(
            state,
            "ai",
            "hand",
            new_card("s-pot-of-greed", "spell", owner="ai"),
        )
        trap = put(
            state,
            "ai",
            "hand",
            new_card("t-waboku", "trap", owner="ai"),
        )
        put(state, "ai", "deck", new_card("ai-draw-one", owner="ai"))
        put(state, "ai", "deck", new_card("ai-draw-two", owner="ai"))
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertEqual(find_card(state, pot["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, monster["instance_id"])[1], "monster_zone")
        self.assertEqual(find_card(state, trap["instance_id"])[1], "spell_trap_zone")
        self.assertTrue(find_card(state, trap["instance_id"])[3]["face_down"])
        self.assertEqual(state["players"]["player"]["lp"], 6200)
        self.assertIn(monster["instance_id"], state["attacked"]["ai"])
        self.assertEqual(state["turn_player"], "player")
        self.assertNotIn("_pending_ai_turn", state)
        stages = state["_ai_turn_stages"]
        stage_types = [stage["type"] for stage in stages]
        self.assertLess(stage_types.index("spell"), stage_types.index("summon"))
        self.assertLess(stage_types.index("summon"), stage_types.index("set"))
        self.assertLess(stage_types.index("set"), stage_types.index("attack"))
        self.assertIn("end", stage_types)
        summon_stage = next(stage for stage in stages if stage["type"] == "summon")
        self.assertIn(
            monster["instance_id"],
            [
                card["instance_id"]
                for card in summon_stage["state"]["players"]["ai"]["monster_zone"]
                if card
            ],
        )
        set_stage = next(stage for stage in stages if stage["type"] == "set")
        self.assertIn(
            trap["instance_id"],
            [
                card["instance_id"]
                for card in set_stage["state"]["players"]["ai"]["spell_trap_zone"]
                if card
            ],
        )

    def test_ai_does_not_attack_a_stronger_face_up_monster(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800),
        )
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card("stronger-defender", atk=2000),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertNotIn(attacker["instance_id"], state["attacked"]["ai"])
        self.assertEqual(state["players"]["player"]["lp"], 8000)
        self.assertEqual(
            find_card(state, defender["instance_id"])[1],
            "monster_zone",
        )

    def test_ai_attacks_an_equal_atk_face_up_monster(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800),
        )
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card("equal-atk-defender", atk=1800),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertIn(attacker["instance_id"], state["attacked"]["ai"])
        self.assertEqual(find_card(state, attacker["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, defender["instance_id"])[1], "graveyard")
        self.assertEqual(state["players"]["player"]["lp"], 8000)
        self.assertEqual(state["players"]["ai"]["lp"], 8000)

    def test_ai_attacks_a_weaker_face_up_monster(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=2400),
        )
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card("weaker-defender", atk=1800),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertEqual(find_card(state, defender["instance_id"])[1], "graveyard")
        self.assertIn(attacker["instance_id"], state["attacked"]["ai"])
        self.assertEqual(state["players"]["player"]["lp"], 7400)

    def test_ai_attacks_a_face_down_monster_without_using_its_hidden_stats(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "main1"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800),
        )
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card(
                "face-down-defender",
                **{
                    "atk": 3000,
                    "def": 2000,
                    "face_down": True,
                    "position": "defense",
                },
            ),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "main",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertIn(attacker["instance_id"], state["attacked"]["ai"])
        self.assertFalse(defender["face_down"])
        self.assertEqual(defender["position"], "defense")
        self.assertEqual(state["players"]["ai"]["lp"], 7800)

    def test_ai_waits_for_player_chain_response_during_attack_then_resumes(self):
        response_card_id = "test-ai-attack-response"
        self.engine.registry.register(
            EffectDefinition(
                card_id=response_card_id,
                effect_id="activate",
                effect_type="quick",
                speed=2,
                resolve=lambda state, context: None,
                source_zones=frozenset({"hand"}),
                can_chain=True,
            )
        )
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=1800),
        )
        trap = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-mirror-force",
                "trap",
                owner="player",
                face_down=True,
                set_turn=1,
            ),
        )
        response = put(
            state,
            "player",
            "hand",
            new_card(response_card_id, "spell"),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "battle",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertIn(
            "attack",
            [stage["type"] for stage in state["_ai_turn_stages"]],
        )

        self.assertEqual(state["chain"]["status"], "closed")
        self.assertEqual(find_card(state, trap["instance_id"])[1], "graveyard")
        self.assertEqual(find_card(state, attacker["instance_id"])[1], "graveyard")
        self.assertEqual(state["turn_player"], "player")
        self.assertNotIn("_pending_ai_turn", state)

    def test_gravity_bind_stops_level_4_or_higher_attack_immediately(self):
        state = new_state()
        state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
        attacker = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker", owner="ai", atk=2000, level=4),
        )
        defender = put(
            state,
            "player",
            "monster_zone",
            new_card("player-defender", owner="player", atk=1200, level=4),
        )
        gravity_bind = put(
            state,
            "player",
            "spell_trap_zone",
            new_card(
                "t-gravity-bind",
                "trap",
                owner="player",
                face_down=True,
                set_turn=1,
            ),
        )
        put(state, "player", "deck", new_card("player-draw", "spell"))
        state["_pending_ai_turn"] = {
            "stage": "battle",
            "used_copy_effect_sources": [],
        }

        self.actions._resume_ai_main_phase(state)

        found_trap = find_card(state, gravity_bind["instance_id"])
        self.assertIsNotNone(found_trap)
        self.assertEqual(found_trap[1], "spell_trap_zone")
        self.assertFalse(found_trap[3]["face_down"])
        self.assertEqual(find_card(state, defender["instance_id"])[1], "monster_zone")
        self.assertEqual(state["players"]["player"]["lp"], 8000)
        self.assertFalse(can_declare_attack(state, "ai", attacker["instance_id"]))

    def test_spellbinding_circle_and_shadow_spell_activate_on_opponent_attack(self):
        for card_id, expected_atk in (
            ("t-spellbinding-circle", 2000),
            ("t-shadow-spell", 1300),
        ):
            with self.subTest(card_id=card_id):
                state = new_state()
                state.update({"turn": 2, "turn_player": "ai", "phase": "battle"})
                attacker = put(
                    state,
                    "ai",
                    "monster_zone",
                    new_card("ai-attacker", owner="ai", atk=2000, level=4),
                )
                defender = put(
                    state,
                    "player",
                    "monster_zone",
                    new_card("player-defender", owner="player", atk=1200, level=4),
                )
                trap = put(
                    state,
                    "player",
                    "spell_trap_zone",
                    new_card(
                        card_id,
                        "trap",
                        owner="player",
                        face_down=True,
                        set_turn=1,
                    ),
                )
                put(state, "player", "deck", new_card("player-draw", "spell"))
                state["_pending_ai_turn"] = {
                    "stage": "battle",
                    "used_copy_effect_sources": [],
                }

                self.actions._resume_ai_main_phase(state)

                found_trap = find_card(state, trap["instance_id"])
                self.assertIsNotNone(found_trap)
                self.assertEqual(found_trap[1], "spell_trap_zone")
                self.assertFalse(found_trap[3]["face_down"])
                self.assertEqual(
                    found_trap[3].get("target_instance_id"),
                    attacker["instance_id"],
                )
                self.assertEqual(
                    find_card(state, defender["instance_id"])[1],
                    "monster_zone",
                )
                self.assertEqual(state["players"]["player"]["lp"], 8000)
                self.assertEqual(
                    current_stats(state, attacker["instance_id"])["atk"],
                    expected_atk,
                )
                self.assertFalse(
                    can_declare_attack(state, "ai", attacker["instance_id"])
                )

    def test_face_down_three_humped_lacooda_negates_attack_and_draws_three_cards(self):
        state = new_state()
        state.update({"turn": 1, "turn_player": "player", "phase": "main1"})
        lacooda = put(
            state,
            "player",
            "hand",
            new_card("m-3-hump-lacooda", owner="player", atk=500, **{"def": 1500}),
        )
        for index in range(5):
            put(
                state,
                "player",
                "deck",
                new_card(f"lacooda-draw-{index}", owner="player"),
            )
        attacker_1 = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker-1", owner="ai", atk=2500, **{"def": 2000}),
        )
        attacker_2 = put(
            state,
            "ai",
            "monster_zone",
            new_card("ai-attacker-2", owner="ai", atk=2400, **{"def": 2000}),
        )

        after_set = self.actions.apply(
            state,
            player="player",
            action={
                "type": "set_card",
                "instance_id": lacooda["instance_id"],
                "zone_index": 0,
            },
        )
        after_set["turn"] = 2
        after_set["turn_player"] = "ai"
        after_set["phase"] = "battle"

        self.actions._attack(
            after_set,
            "ai",
            {
                "attacker_instance_id": attacker_1["instance_id"],
                "defender_instance_id": lacooda["instance_id"],
            },
        )
        self.actions._prepare_pending_battle(after_set)

        found_lacooda = find_card(after_set, lacooda["instance_id"])
        self.assertIsNotNone(found_lacooda)
        self.assertEqual(found_lacooda[1], "monster_zone")
        self.assertFalse(found_lacooda[3]["face_down"])
        self.assertEqual(after_set["players"]["player"]["lp"], 8000)
        self.assertEqual(len(after_set["players"]["player"]["hand"]), 3)
        self.assertEqual(len(after_set["players"]["player"]["deck"]), 2)

        # Second attack in the same turn resolves normally (once-per-turn guard).
        self.actions._attack(
            after_set,
            "ai",
            {
                "attacker_instance_id": attacker_2["instance_id"],
                "defender_instance_id": lacooda["instance_id"],
            },
        )
        self.actions._prepare_pending_battle(after_set)

        self.assertEqual(find_card(after_set, lacooda["instance_id"])[1], "graveyard")
        self.assertEqual(len(after_set["players"]["player"]["hand"]), 3)


if __name__ == "__main__":
    unittest.main()
