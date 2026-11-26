from copy import deepcopy
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from duel.duel_actions import DuelActionEngine
from duel.duel_engine import (
    DuelEffectEngine,
    DuelRuleError,
    EffectDefinition,
    EffectRegistry,
    add_stat_modifier,
    change_life_points,
    create_duel_state,
    current_stats,
    destroy_card,
    draw_cards,
    expire_effects,
    move_card,
)


def card(card_id, category="monster", atk=1000, defense=800):
    return {
        "id": card_id,
        "name": card_id,
        "category": category,
        "atk": atk,
        "def": defense,
    }


def deterministic_shuffle(cards):
    cards.reverse()


def opened_state():
    deck = [card(f"m-{index}") for index in range(40)]
    return create_duel_state(deck, deck, shuffle=deterministic_shuffle)


class DuelStateTests(unittest.TestCase):
    def test_create_duel_state_deals_five_cards_and_keeps_server_zones(self):
        state = opened_state()

        self.assertEqual(state["turn_player"], "player")
        self.assertEqual(state["phase"], "draw")
        self.assertEqual(len(state["players"]["player"]["hand"]), 5)
        self.assertEqual(len(state["players"]["ai"]["deck"]), 35)
        self.assertEqual(len(state["players"]["player"]["monster_zone"]), 5)
        self.assertEqual(state["players"]["player"]["banished"], [])
        instance_ids = [
            item["instance_id"]
            for side in state["players"].values()
            for item in side["deck"] + side["hand"]
        ]
        self.assertEqual(len(instance_ids), len(set(instance_ids)))

    def test_opening_hand_can_win_by_exodia(self):
        pieces = [
            "m-exodia-the-forbidden-one",
            "m-right-arm-of-the-forbidden-one",
            "m-left-arm-of-the-forbidden-one",
            "m-right-leg-of-the-forbidden-one",
            "m-left-leg-of-the-forbidden-one",
        ]
        deck = [card(card_id) for card_id in pieces]
        deck.extend(card(f"filler-{index}") for index in range(35))
        state = create_duel_state(
            deck,
            [card(f"ai-{index}") for index in range(40)],
            shuffle=deterministic_shuffle,
        )

        self.assertTrue(state["over"])
        self.assertEqual(state["winner"], "player")

    def test_main_deck_rejects_fusion_and_invalid_sizes(self):
        with self.assertRaises(DuelRuleError):
            create_duel_state([card("fusion", "fusion")] * 40, [card("m")] * 40)
        with self.assertRaises(DuelRuleError):
            create_duel_state([card("m")] * 39, [card("m")] * 40)

    def test_deck_rejects_exceeding_catalog_copy_limit(self):
        limited = card("limited")
        limited["maxCopies"] = 1
        deck = [limited] * 4 + [card(f"m-{index}") for index in range(36)]

        with self.assertRaises(DuelRuleError):
            create_duel_state(deck, [card(f"ai-{index}") for index in range(40)])

    def test_lp_loss_sets_winner_and_rejects_changes_after_duel_end(self):
        state = opened_state()
        change_life_points(state, "player", -8000)

        self.assertEqual(state["players"]["player"]["lp"], 0)
        self.assertTrue(state["over"])
        self.assertEqual(state["winner"], "ai")
        with self.assertRaises(DuelRuleError):
            change_life_points(state, "player", 100)

    def test_modifier_keeps_base_stats_and_expires_at_own_turn_end(self):
        state = opened_state()
        player = state["players"]["player"]
        target = player["hand"].pop(0)
        source = player["hand"].pop(0)
        player["monster_zone"][0] = target
        player["monster_zone"][1] = source

        modified = add_stat_modifier(
            state,
            target_instance_id=target["instance_id"],
            source_instance_id=source["instance_id"],
            source_card_id=source["card_id"],
            owner="player",
            stat="atk",
            operation="increase",
            value=500,
            duration={"type": "turn_end"},
        )

        self.assertEqual(target["base_atk"], 1000)
        self.assertEqual(current_stats(modified, target["instance_id"])["atk"], 1500)
        expired = expire_effects(
            modified, "turn_end", player="player", turn=modified["turn"]
        )
        self.assertEqual(current_stats(expired, target["instance_id"])["atk"], 1000)

    def test_divide_stat_modifier_rejects_zero_divisor(self):
        state = opened_state()
        player = state["players"]["player"]
        target = player["hand"].pop(0)
        source = player["hand"].pop(0)
        player["monster_zone"][0] = target
        player["monster_zone"][1] = source

        with self.assertRaises(DuelRuleError):
            add_stat_modifier(
                state,
                target_instance_id=target["instance_id"],
                source_instance_id=source["instance_id"],
                source_card_id=source["card_id"],
                owner="player",
                stat="atk",
                operation="divide",
                value=0,
                duration={"type": "turn_end"},
            )

    def test_slifer_stats_track_its_controllers_hand_size(self):
        state = opened_state()
        player = state["players"]["player"]
        slifer = player["hand"].pop()
        slifer["card_id"] = "m-slifer-the-sky-dragon"
        slifer["base_atk"] = 0
        slifer["base_def"] = 0
        player["monster_zone"][0] = slifer

        self.assertEqual(
            current_stats(state, slifer["instance_id"]),
            {"atk": 4000, "def": 4000},
        )

        player["hand"].append(player["deck"].pop())

        self.assertEqual(
            current_stats(state, slifer["instance_id"]),
            {"atk": 5000, "def": 5000},
        )

    def test_buster_blader_tracks_opponent_dragons_on_field_and_in_graveyard(self):
        state = opened_state()
        player = state["players"]["player"]
        opponent = state["players"]["ai"]
        blader = player["hand"].pop()
        blader["card_id"] = "m-buster-blader"
        blader["base_atk"] = 2600
        blader["base_def"] = 2300
        player["monster_zone"][0] = blader

        field_dragon = opponent["hand"].pop()
        field_dragon["race"] = "Rồng"
        opponent["monster_zone"][0] = field_dragon
        graveyard_dragon = opponent["hand"].pop()
        graveyard_dragon["race"] = "Rồng"
        opponent["graveyard"].append(graveyard_dragon)
        player_dragon = player["hand"].pop()
        player_dragon["race"] = "Rồng"
        player["monster_zone"][1] = player_dragon

        self.assertEqual(current_stats(state, blader["instance_id"])["atk"], 3600)

        opponent["graveyard"].clear()
        self.assertEqual(current_stats(state, blader["instance_id"])["atk"], 3100)

    def test_buster_blader_bonus_is_inactive_when_not_face_up_on_field(self):
        state = opened_state()
        player = state["players"]["player"]
        opponent = state["players"]["ai"]
        blader = player["hand"].pop()
        blader["card_id"] = "m-buster-blader"
        blader["base_atk"] = 2600
        blader["base_def"] = 2300
        blader["face_down"] = True
        player["monster_zone"][0] = blader
        dragon = opponent["hand"].pop()
        dragon["race"] = "Rồng"
        opponent["monster_zone"][0] = dragon

        self.assertEqual(current_stats(state, blader["instance_id"])["atk"], 2600)

        blader["face_down"] = False
        player["monster_zone"][0] = None
        player["hand"].append(blader)
        self.assertEqual(current_stats(state, blader["instance_id"])["atk"], 2600)

    def test_blade_knight_gets_400_atk_with_one_or_fewer_cards_in_hand(self):
        state = opened_state()
        player = state["players"]["player"]
        blade_knight = player["hand"].pop()
        blade_knight["card_id"] = "m-blade-knight"
        blade_knight["base_atk"] = 1600
        blade_knight["base_def"] = 1000
        player["monster_zone"][0] = blade_knight
        player["hand"] = player["hand"][:1]

        self.assertEqual(current_stats(state, blade_knight["instance_id"])["atk"], 2000)

        player["hand"].append(player["deck"].pop())
        self.assertEqual(current_stats(state, blade_knight["instance_id"])["atk"], 1600)

        blade_knight["face_down"] = True
        player["hand"].pop()
        self.assertEqual(current_stats(state, blade_knight["instance_id"])["atk"], 1600)

    def test_dark_magician_girl_counts_dark_magicians_in_both_graveyards(self):
        state = opened_state()
        player = state["players"]["player"]
        opponent = state["players"]["ai"]
        girl = player["hand"].pop()
        girl["card_id"] = "m-dark-magician-girl"
        girl["base_atk"] = 2000
        girl["base_def"] = 1700
        player["monster_zone"][0] = girl

        dark_magician = player["hand"].pop()
        dark_magician["card_id"] = "m-dark-magician"
        player["graveyard"].append(dark_magician)
        opponent_dark_magician = opponent["hand"].pop()
        opponent_dark_magician["card_id"] = "m-dark-magician"
        opponent["graveyard"].append(opponent_dark_magician)

        self.assertEqual(current_stats(state, girl["instance_id"])["atk"], 2600)

        player["graveyard"].clear()
        self.assertEqual(current_stats(state, girl["instance_id"])["atk"], 2300)

        opponent_dark_magician["card_id"] = "m-magician-of-black-chaos"
        self.assertEqual(current_stats(state, girl["instance_id"])["atk"], 2000)

        girl["face_down"] = True
        self.assertEqual(current_stats(state, girl["instance_id"])["atk"], 2000)

    def test_opponent_turn_modifier_expires_at_that_later_turn(self):
        state = opened_state()
        player = state["players"]["player"]
        target = player["hand"].pop(0)
        source = player["hand"].pop(0)
        player["monster_zone"][0] = target
        player["monster_zone"][1] = source
        modified = add_stat_modifier(
            state,
            target_instance_id=target["instance_id"],
            source_instance_id=source["instance_id"],
            source_card_id=source["card_id"],
            owner="player",
            stat="atk",
            operation="increase",
            value=500,
            duration={"type": "opponent_turn_end"},
        )

        before_opponent_end = expire_effects(
            modified, "turn_end", player="ai", turn=1
        )
        self.assertEqual(
            current_stats(before_opponent_end, target["instance_id"])["atk"], 1500
        )
        at_opponent_end = expire_effects(
            modified, "turn_end", player="ai", turn=2
        )
        self.assertEqual(
            current_stats(at_opponent_end, target["instance_id"])["atk"], 1000
        )

    def test_draw_deck_out_and_destroy_update_the_authoritative_zones(self):
        state = opened_state()
        player = state["players"]["player"]
        target = player["hand"].pop(0)
        player["monster_zone"][0] = target
        destroyed = destroy_card(state, target["instance_id"])
        self.assertIsNone(player["monster_zone"][0])
        self.assertEqual(player["graveyard"], [destroyed])

        state["players"]["player"]["deck"] = []
        next_state, drawn = draw_cards(state, "player", 1)
        self.assertEqual(drawn, [])
        self.assertTrue(next_state["over"])
        self.assertEqual(next_state["winner"], "ai")
        self.assertFalse(state["over"])

    def test_card_cannot_be_fusion_summoned_while_fusion_is_deferred(self):
        main = [card(f"m-{index}") for index in range(40)]
        state = create_duel_state(
            main,
            main,
            player_extra_deck=[card("f-paladin", "fusion")],
            shuffle=deterministic_shuffle,
        )
        fusion = state["players"]["player"]["extra_deck"][0]

        with self.assertRaises(DuelRuleError):
            move_card(
                state,
                fusion["instance_id"],
                "player",
                "monster_zone",
                destination_index=0,
            )

    def test_continuous_modifier_stops_when_its_source_leaves_the_field(self):
        state = opened_state()
        monsters = state["players"]["player"]["monster_zone"]
        monsters[0] = state["players"]["player"]["hand"].pop(0)
        monsters[1] = state["players"]["player"]["hand"].pop(0)
        target, source = monsters[:2]
        modified = add_stat_modifier(
            state,
            target_instance_id=target["instance_id"],
            source_instance_id=source["instance_id"],
            source_card_id=source["card_id"],
            owner="player",
            stat="def",
            operation="increase",
            value=300,
            duration={"type": "continuous"},
        )
        self.assertEqual(current_stats(modified, target["instance_id"])["def"], 1100)

        modified["players"]["player"]["monster_zone"][1] = None
        self.assertEqual(current_stats(modified, target["instance_id"])["def"], 800)

    def test_soul_absorption_gains_lp_for_cards_sent_to_grave_or_banished(self):
        state = opened_state()
        player = state["players"]["player"]
        ai = state["players"]["ai"]
        player_absorption = player["hand"].pop()
        player_absorption.update(
            {
                "card_id": "s-soul-absorption",
                "category": "spell",
                "effect_active": True,
            }
        )
        player["spell_trap_zone"][0] = player_absorption
        ai_absorption = ai["hand"].pop()
        ai_absorption.update(
            {
                "card_id": "s-soul-absorption",
                "category": "spell",
                "effect_active": True,
            }
        )
        ai["spell_trap_zone"][0] = ai_absorption

        sent_to_grave = player["hand"][-1]
        sent_to_banished = ai["hand"][-1]
        move_card(state, sent_to_grave["instance_id"], "player", "graveyard")
        move_card(state, sent_to_banished["instance_id"], "ai", "banished")

        self.assertEqual(player["lp"], 9000)
        self.assertEqual(ai["lp"], 9000)

    def test_face_down_soul_absorption_does_not_trigger(self):
        state = opened_state()
        player = state["players"]["player"]
        absorption = player["hand"].pop()
        absorption.update(
            {
                "card_id": "s-soul-absorption",
                "category": "spell",
                "face_down": True,
            }
        )
        player["spell_trap_zone"][0] = absorption
        sent_to_grave = player["hand"][-1]

        move_card(state, sent_to_grave["instance_id"], "player", "graveyard")

        self.assertEqual(player["lp"], 8000)


class ChainTests(unittest.TestCase):
    def setUp(self):
        self.state = opened_state()
        player_zone = self.state["players"]["player"]["monster_zone"]
        ai_zone = self.state["players"]["ai"]["monster_zone"]
        player_zone[0] = self.state["players"]["player"]["hand"].pop(0)
        ai_zone[0] = self.state["players"]["ai"]["hand"].pop(0)
        self.player_source = player_zone[0]
        self.ai_source = ai_zone[0]
        self.resolution_order = []
        registry = EffectRegistry()

        def resolver(effect_id):
            def resolve(state, context):
                self.resolution_order.append(effect_id)
                state["players"][context.player]["lp"] -= 100
            return resolve

        registry.register(
            EffectDefinition(
                card_id=self.player_source["card_id"],
                effect_id="first",
                effect_type="activated",
                speed=1,
                resolve=resolver("first"),
            )
        )
        registry.register(
            EffectDefinition(
                card_id=self.player_source["card_id"],
                effect_id="player_slow",
                effect_type="activated",
                speed=1,
                can_chain=True,
                resolve=resolver("player_slow"),
            )
        )
        registry.register(
            EffectDefinition(
                card_id=self.ai_source["card_id"],
                effect_id="response",
                effect_type="quick",
                speed=2,
                can_chain=True,
                resolve=resolver("response"),
            )
        )
        registry.register(
            EffectDefinition(
                card_id=self.ai_source["card_id"],
                effect_id="slow_response",
                effect_type="activated",
                speed=1,
                can_chain=True,
                resolve=resolver("slow_response"),
            )
        )
        self.engine = DuelEffectEngine(registry)

    def test_set_trap_auto_responds_when_ai_chain_gives_player_priority(self):
        registry = EffectRegistry()
        resolved = []

        def resolve(state, context):
            resolved.append(context.player)

        registry.register(
            EffectDefinition(
                card_id="t-auto-response",
                effect_id="activate",
                effect_type="quick",
                speed=2,
                can_chain=True,
                source_zones=frozenset({"spell_trap_zone"}),
                phases=frozenset({"battle", "main1", "main2"}),
                resolve=resolve,
            )
        )
        registry.register(
            EffectDefinition(
                card_id="m-chain-activation",
                effect_id="activate",
                effect_type="activated",
                speed=1,
                resolve=resolve,
            )
        )
        effect_engine = DuelEffectEngine(registry)
        action_engine = DuelActionEngine(effect_engine)
        state = opened_state()
        state["phase"] = "battle"
        set_trap = {
            "instance_id": "player-auto-trap",
            "card_id": "t-auto-response",
            "category": "trap",
            "face_down": True,
        }
        state["players"]["player"]["spell_trap_zone"][0] = set_trap
        state["chain"] = {
            "status": "open",
            "links": [{
                "player": "ai",
                "source_instance_id": "ai-chain-source",
                "card_id": "m-chain-activation",
                "effect_id": "activate",
                "target_instance_ids": [],
                "payload": {},
                "speed": 1,
                "negated": False,
            }],
            "priority_player": "player",
            "consecutive_passes": 0,
        }

        action_engine._advance_ai_chain_to_player_response(state)

        self.assertIn("player", resolved)
        self.assertEqual(state["chain"]["status"], "closed")

    def test_chain_resolves_in_reverse_activation_order_after_both_players_pass(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.player_source["instance_id"],
            effect_id="first",
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=self.ai_source["instance_id"],
            effect_id="response",
        )
        state = self.engine.pass_priority(state, player="player")
        self.assertEqual(state["chain"]["status"], "open")
        state = self.engine.pass_priority(state, player="ai")

        self.assertEqual(self.resolution_order, ["response", "first"])
        self.assertEqual(state["players"]["player"]["lp"], 7900)
        self.assertEqual(state["players"]["ai"]["lp"], 7900)
        self.assertEqual(state["chain"]["status"], "closed")

    def test_chain_rejects_invalid_speed_and_wrong_priority(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.player_source["instance_id"],
            effect_id="first",
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=self.player_source["instance_id"],
                effect_id="first",
            )

    def test_activation_rejects_finished_duel(self):
        change_life_points(self.state, "player", -8000)
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                self.state,
                player="player",
                source_instance_id=self.player_source["instance_id"],
                effect_id="first",
            )

    def test_lower_speed_cannot_respond_to_higher_speed(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.player_source["instance_id"],
            effect_id="first",
        )
        state = self.engine.activate(
            state,
            player="ai",
            source_instance_id=self.ai_source["instance_id"],
            effect_id="response",
        )
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=self.player_source["instance_id"],
                effect_id="player_slow",
            )

    def test_effect_not_marked_chainable_cannot_be_chained(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.player_source["instance_id"],
            effect_id="first",
        )
        state = self.engine.pass_priority(state, player="ai")
        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=self.player_source["instance_id"],
                effect_id="first",
            )

    def test_kycoo_cannot_be_targeted_by_ghost_monster_effects(self):
        state = deepcopy(self.state)
        target = state["players"]["player"]["monster_zone"][0]
        source = state["players"]["ai"]["monster_zone"][0]
        target.update(
            {
                "card_id": "m-kycoo-the-ghost-destroyer",
                "category": "monster",
                "face_down": False,
            }
        )
        source.update(
            {
                "name": "Quái Thú Bóng Ma",
                "category": "monster",
                "race": "Quỷ",
            }
        )
        registry = EffectRegistry()
        registry.register(
            EffectDefinition(
                card_id=source["card_id"],
                effect_id="targeted",
                effect_type="activated",
                speed=1,
                requires_target=True,
                resolve=lambda _state, _context: None,
            )
        )
        engine = DuelEffectEngine(registry)

        with self.assertRaises(DuelRuleError):
            engine.activate(
                state,
                player="ai",
                source_instance_id=source["instance_id"],
                effect_id="targeted",
                target_instance_ids=(target["instance_id"],),
            )

        source["name"] = "Quái Thú Thường"
        allowed = engine.activate(
            state,
            player="ai",
            source_instance_id=source["instance_id"],
            effect_id="targeted",
            target_instance_ids=(target["instance_id"],),
        )
        self.assertEqual(allowed["chain"]["status"], "open")

    def test_target_is_revalidated_when_chain_resolves(self):
        target = self.ai_source
        registry = EffectRegistry()
        resolved_targets = []

        def resolve_targeted(state, context):
            self.assertEqual(state["chain"]["status"], "resolving")
            resolved_targets.extend(context.target_instance_ids)

        registry.register(
            EffectDefinition(
                card_id=self.player_source["card_id"],
                effect_id="targeted",
                effect_type="activated",
                speed=1,
                requires_target=True,
                resolve=resolve_targeted,
            )
        )
        engine = DuelEffectEngine(registry)
        state = engine.activate(
            self.state,
            player="player",
            source_instance_id=self.player_source["instance_id"],
            effect_id="targeted",
            target_instance_ids=(target["instance_id"],),
        )
        state["players"]["ai"]["monster_zone"][0] = None
        state = engine.pass_priority(state, player="ai")
        state = engine.pass_priority(state, player="player")

        self.assertEqual(resolved_targets, [])
        self.assertEqual(state["chain"]["status"], "closed")


class NaturiaRosewhipTests(unittest.TestCase):
    def setUp(self):
        self.state = opened_state()
        player = self.state["players"]["player"]
        ai = self.state["players"]["ai"]

        rosewhip = ai["hand"].pop()
        rosewhip.update(
            {
                "card_id": "m-naturia-rosewhip",
                "category": "monster",
                "face_down": False,
            }
        )
        ai["monster_zone"][0] = rosewhip

        self.activations = []
        registry = EffectRegistry()
        for index in range(2):
            source = player["hand"].pop(0)
            is_trap = index == 1
            source.update(
                {
                    "card_id": "t-test-trap" if is_trap else "s-test-spell",
                    "category": "trap" if is_trap else "spell",
                }
            )
            source_zones = {"hand"}
            if is_trap:
                source.update({"face_down": True, "set_turn": 0})
                player["spell_trap_zone"][0] = source
                source_zones = {"spell_trap_zone"}
            else:
                player["hand"].append(source)
            self.activations.append(source)
            registry.register(
                EffectDefinition(
                    card_id=source["card_id"],
                    effect_id="activate",
                    effect_type="activated",
                    speed=1,
                    resolve=lambda _state, _context: None,
                    source_zones=frozenset(source_zones),
                    move_source_on_activation=not is_trap,
                )
            )
        self.engine = DuelEffectEngine(registry)

    def test_rosewhip_limits_opponents_to_one_spell_or_trap_per_turn(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.activations[0]["instance_id"],
            effect_id="activate",
        )
        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")

        with self.assertRaises(DuelRuleError):
            self.engine.activate(
                state,
                player="player",
                source_instance_id=self.activations[1]["instance_id"],
                effect_id="activate",
            )

    def test_rosewhip_limit_resets_for_the_next_turn(self):
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.activations[0]["instance_id"],
            effect_id="activate",
        )
        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")
        state["turn"] += 1

        next_state = self.engine.activate(
            state,
            player="player",
            source_instance_id=self.activations[1]["instance_id"],
            effect_id="activate",
        )

        self.assertEqual(next_state["chain"]["status"], "open")

    def test_face_down_rosewhip_does_not_limit_spell_or_trap_activations(self):
        rosewhip = self.state["players"]["ai"]["monster_zone"][0]
        rosewhip["face_down"] = True
        state = self.engine.activate(
            self.state,
            player="player",
            source_instance_id=self.activations[0]["instance_id"],
            effect_id="activate",
        )
        state = self.engine.pass_priority(state, player="ai")
        state = self.engine.pass_priority(state, player="player")

        next_state = self.engine.activate(
            state,
            player="player",
            source_instance_id=self.activations[1]["instance_id"],
            effect_id="activate",
        )

        self.assertEqual(next_state["chain"]["status"], "open")


if __name__ == "__main__":
    unittest.main()
