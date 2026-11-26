"""Heuristic AI turn policy for server-side duels."""

from __future__ import annotations

from copy import deepcopy
from itertools import combinations
from typing import Any, Mapping

from .duel_effects import (
    EQUIP_SPELL_IDS,
    SPELL_RECOVERY_RULES,
    _can_be_special_summoned,
    _special_summon,
    apply_draw_triggers,
    can_declare_attack,
    complete_pending_discard,
    monster_effects_are_negated,
    resolve_end_phase_effects,
    resolve_standby_effects,
)
from .duel_engine import (
    CRUSH_CARD_VIRUS_GY_LOCK,
    DuelRuleError,
    current_stats,
    draw_cards,
    expire_effects,
    find_card,
    move_card,
    opponent_of,
)

MAIN_PHASES = frozenset({"main1", "main2"})
GOD_CARD_IDS = frozenset(
    {
        "m-slifer-the-sky-dragon",
        "m-obelisk-the-tormentor",
        "m-the-winged-dragon-of-ra",
    }
)
HORAKHTY_ID = "m-the-creator-god-of-light-horakhty"
VALKYRION_ID = "m-valkyrion-the-magna-warrior"
CHAOS_EMPEROR_ID = "m-chaos-emperor-dragon-envoy-of-the-end"
CHAOS_LEVIANEER_ID = "m-chaos-dragon-levianeer"
VALKYRION_MATERIAL_IDS = (
    "m-alpha-the-magnet-warrior",
    "m-beta-the-magnet-warrior",
    "m-gamma-the-magnet-warrior",
)


class DuelAIMixin:
    """AI policy methods mixed into the duel action engine."""

    # Bắt đầu lượt AI: rút bài, xử lý Standby và khởi động Main Phase.
    def _run_ai_turn(self, state: dict[str, Any]) -> None:
        state.setdefault("_ai_turn_stages", [])
        state["turn"] += 1
        state["turn_player"] = "ai"
        state["phase"] = "draw"
        state["drawn_this_turn"] = False
        state["normal_summon_used"]["ai"] = False
        state["attacked"]["ai"] = []
        if not state.get("over"):
            self._draw_ai_turn_card(state)
            self._record_ai_turn_stage(state, "draw")
        if not state.get("over"):
            state["phase"] = "standby"
            before_standby = self._ai_stage_snapshot(state)
            resolve_standby_effects(state, "ai")
            if self._ai_stage_state_changed(before_standby, state):
                self._record_ai_turn_stage(state, "effect")
        if not state.get("over"):
            state["phase"] = "main1"
            state["_pending_ai_turn"] = {
                "stage": "main",
                "used_copy_effect_sources": [],
            }
            self._resume_ai_main_phase(state)

    # Tiếp tục lượt đang tạm dừng sau khi Chain hoặc lựa chọn được xử lý.
    def _resume_ai_main_phase(self, state: dict[str, Any]) -> None:
        if state.get("over"):
            state.pop("_pending_ai_turn", None)
            return
        if (
            state.get("pending_decision")
            or state.get("chain", {}).get("status") != "closed"
        ):
            return
        pending_turn = state.get("_pending_ai_turn")
        if not isinstance(pending_turn, dict):
            return
        if pending_turn.get("stage", "main") == "main":
            state["phase"] = "main1"
            for _ in range(32):
                if state.get("over") or state.get("pending_decision"):
                    break
                if state.get("chain", {}).get("status") != "closed":
                    return
                if self._ai_use_copied_monster_effects(state):
                    self._record_ai_turn_stage(state, "effect")
                    return
                if state.get("pending_decision") or state.get("chain", {}).get("status") != "closed":
                    return
                if self._ai_activate_best_main_spell(state):
                    self._record_ai_turn_stage(state, "spell")
                    if state.get("pending_decision") or state.get("chain", {}).get("status") != "closed":
                        return
                    continue
                before_union_effect = self._ai_stage_snapshot(state)
                self._ai_use_union_monsters(state)
                if self._ai_stage_state_changed(before_union_effect, state):
                    self._resolve_pending_card_triggers(state)
                    self._record_ai_turn_stage(state, "effect")
                    if state.get("pending_decision") or state.get("chain", {}).get("status") != "closed":
                        return
                    continue
                if self._ai_summon_tricky(state):
                    self._resolve_pending_card_triggers(state)
                    self._record_ai_turn_stage(state, "summon")
                    if state.get("pending_decision") or state.get("chain", {}).get("status") != "closed":
                        return
                    continue
                before_card_action = self._ai_stage_snapshot(state)
                self._set_ai_card(state)
                if self._ai_stage_state_changed(before_card_action, state):
                    self._resolve_pending_card_triggers(state)
                    self._record_ai_turn_stage(
                        state,
                        self._ai_card_action_stage_type(before_card_action, state),
                    )
                    if state.get("pending_decision") or state.get("chain", {}).get("status") != "closed":
                        return
                    continue
                break

            pending_turn = state.get("_pending_ai_turn")
            if not isinstance(pending_turn, dict):
                return
            pending_turn["stage"] = "battle"

        if pending_turn.get("stage") == "battle":
            state["phase"] = "battle"
            self._ai_battle_phase(state)
            if (
                state.get("pending_decision")
                or state.get("chain", {}).get("status") != "closed"
                or state.get("pending_battle")
            ):
                return
        self._finish_ai_turn(state)

    @staticmethod
    # Tạo bản sao trạng thái để lưu bước đi, bỏ qua danh sách bước đã lưu.
    def _ai_stage_snapshot(state: Mapping[str, Any]) -> dict[str, Any]:
        return {
            key: deepcopy(value)
            for key, value in state.items()
            if key != "_ai_turn_stages"
        }

    @staticmethod
    # Kiểm tra trạng thái trận có thay đổi, không tính thay đổi danh sách bước.
    def _ai_stage_state_changed(before: Mapping[str, Any], after: Mapping[str, Any]) -> bool:
        return before != {
            key: value
            for key, value in after.items()
            if key != "_ai_turn_stages"
        }

    @staticmethod
    # Phân loại hành động AI vừa làm để giao diện hiển thị đúng animation.
    def _ai_card_action_stage_type(
        before: Mapping[str, Any],
        after: Mapping[str, Any],
    ) -> str:
        before_players = before["players"]["ai"]
        after_players = after["players"]["ai"]
        before_monsters = {
            card["instance_id"]
            for card in before_players["monster_zone"]
            if card
        }
        if any(
            card and card["instance_id"] not in before_monsters
            for card in after_players["monster_zone"]
        ):
            return "summon"
        before_backrow = {
            card["instance_id"]
            for card in before_players["spell_trap_zone"]
            if card
        }
        if any(
            card and card["instance_id"] not in before_backrow
            for card in after_players["spell_trap_zone"]
        ):
            return "set"
        return "effect"

    @classmethod
    # Lưu loại hành động cùng trạng thái tương ứng để giao diện phát lại.
    def _record_ai_turn_stage(
        cls,
        state: dict[str, Any],
        stage_type: str,
        **metadata: Any,
    ) -> None:
        stages = state.setdefault("_ai_turn_stages", [])
        stages.append(
            {
                "type": stage_type,
                "state": cls._ai_stage_snapshot(state),
                **metadata,
            }
        )

    # Thử các Phép hợp lệ, mô phỏng Chain rồi chọn nước đi có lợi nhất.
    def _ai_activate_best_main_spell(self, state: dict[str, Any]) -> bool:
        opponent = opponent_of("ai")
        target_ids = []
        for owner in ("ai", opponent):
            for zone in ("hand", "monster_zone", "spell_trap_zone", "graveyard", "banished"):
                if owner == opponent and zone == "hand":
                    continue
                for card in state["players"][owner][zone]:
                    if not card:
                        continue
                    if owner == opponent and card.get("face_down", False):
                        continue
                    instance_id = card.get("instance_id")
                    if isinstance(instance_id, str):
                        target_ids.append(instance_id)

        baseline_score = self._ai_state_advantage(state)
        best_option = None
        best_score = baseline_score
        for source in list(state["players"]["ai"]["hand"]):
            if source.get("category") != "spell":
                continue
            card_id = source.get("card_id")
            if not isinstance(card_id, str) or card_id in SPELL_RECOVERY_RULES or card_id == "s-twin-twisters":
                continue
            payload_options = (
                (
                    {"mode": "destroy_attack_monsters"},
                    {"mode": "destroy_spell_traps"},
                )
                if card_id == "s-lightning-storm"
                else ({},)
            )
            for effect in self.effect_engine.registry.for_card(card_id):
                if (
                    "hand" not in effect.source_zones
                    or effect.effect_type == "trigger"
                    or state.get("phase") not in effect.phases
                ):
                    continue
                target_sets = (
                    [(target_id,) for target_id in target_ids]
                    if effect.requires_target
                    else [()]
                )
                for target_instance_ids in target_sets:
                    for payload in payload_options:
                        try:
                            activated = self.effect_engine.activate(
                                state,
                                player="ai",
                                source_instance_id=source["instance_id"],
                                effect_id=effect.effect_id,
                                target_instance_ids=target_instance_ids,
                                payload=payload,
                            )
                            resolved = self._simulate_chain_resolution(activated)
                        except DuelRuleError:
                            continue
                        if (
                            resolved.get("pending_decision")
                            or resolved.get("chain", {}).get("status") != "closed"
                        ):
                            continue
                        score = self._ai_state_advantage(resolved)
                        if card_id in EQUIP_SPELL_IDS:
                            # Equip cards stay active, offsetting their hand-to-field value loss.
                            score += 8
                            if card_id == "s-mask-of-the-accursed":
                                target_id = target_instance_ids[0]
                                target = find_card(resolved, target_id)
                                if target and target[0] == opponent:
                                    score += 16 + current_stats(
                                        resolved, target_id
                                    )["atk"] / 100
                                else:
                                    score -= 16
                        if score > best_score:
                            best_score = score
                            best_option = (
                                source["instance_id"],
                                effect.effect_id,
                                target_instance_ids,
                                payload,
                            )

        if not best_option:
            return False

        source_id, effect_id, target_instance_ids, payload = best_option
        activated = self.effect_engine.activate(
            state,
            player="ai",
            source_instance_id=source_id,
            effect_id=effect_id,
            target_instance_ids=target_instance_ids,
            payload=payload,
        )
        state.clear()
        state.update(activated)
        self._advance_ai_chain_to_player_response(state)
        return True

    # Thực hiện các đòn tấn công hợp lệ và dừng khi cần chờ người chơi xử lý.
    def _ai_battle_phase(self, state: dict[str, Any]) -> None:
        for _ in range(10):
            if state.get("over") or state.get("pending_decision"):
                return
            if state.get("chain", {}).get("status") != "closed":
                if self._advance_ai_chain_to_player_response(state):
                    return
                if state.get("chain", {}).get("status") != "closed":
                    return
            attack = self._ai_choose_attack(state)
            if not attack:
                return
            attack_metadata = {
                "attacker_instance_id": attack[0],
                "defender_instance_id": attack[1],
            }
            self._attack(
                state,
                "ai",
                attack_metadata,
            )
            if state.get("chain", {}).get("status") == "open":
                if self._advance_ai_chain_to_player_response(state):
                    self._record_ai_turn_stage(
                        state,
                        "attack",
                        **attack_metadata,
                    )
                    return
            if (
                state.get("pending_battle")
                and state.get("chain", {}).get("status") == "closed"
                and not state.get("pending_decision")
                and not state["pending_battle"].get("awaiting_resolution")
            ):
                self._prepare_pending_battle(state)
                self._resolve_pending_card_triggers(state)
            self._record_ai_turn_stage(
                state,
                "attack",
                **attack_metadata,
            )
            if (
                state.get("pending_decision")
                or state.get("chain", {}).get("status") != "closed"
                or state.get("pending_battle")
            ):
                return

    @classmethod
    # Chọn đòn tấn công có điểm heuristic cao nhất trong các lựa chọn hợp lệ.
    def _ai_choose_attack(
        cls,
        state: Mapping[str, Any],
    ) -> tuple[str, str | None] | None:
        attack_options = []
        for attacker in state["players"]["ai"]["monster_zone"]:
            attack_options.extend(
                cls._ai_attack_options_for_monster(state, attacker)
            )
        if not attack_options:
            return None
        _score, attacker_id, defender_id = max(
            attack_options,
            key=lambda option: option[0],
        )
        return attacker_id, defender_id

    @staticmethod
    # Liệt kê các mục tiêu tấn công hợp lệ và chấm điểm từng lựa chọn.
    def _ai_attack_options_for_monster(
        state: Mapping[str, Any],
        attacker: Mapping[str, Any] | None,
    ) -> list[tuple[int, str, str | None]]:
        if not attacker or not can_declare_attack(
            state,
            "ai",
            attacker["instance_id"],
        ):
            return []
        second_attack_available = (
            attacker.get("card_id") == "m-black-luster-soldier-envoy-of-the-beginning"
            and attacker.get("black_luster_second_attack") == state["turn"]
        )
        if (
            attacker["instance_id"] in state["attacked"]["ai"]
            and not second_attack_available
        ):
            return []
        opponent_monsters = [
            monster
            for monster in state["players"]["player"]["monster_zone"]
            if monster
        ]
        attack_value = current_stats(state, attacker["instance_id"])["atk"]
        if not opponent_monsters:
            return [(attack_value, attacker["instance_id"], None)]
        attack_options = []
        for defender in opponent_monsters:
            if defender.get("face_down", False):
                attack_options.append(
                    (
                        50 + max(0, attack_value) // 100,
                        attacker["instance_id"],
                        defender["instance_id"],
                    )
                )
                continue
            defender_stats = current_stats(state, defender["instance_id"])
            defense_position = defender.get("position") == "defense"
            opposing_value = (
                defender_stats["def"] if defense_position else defender_stats["atk"]
            )
            if attack_value < opposing_value or (
                defense_position and attack_value == opposing_value
            ):
                continue
            destroy_value = defender_stats["atk"] // 20
            damage = 0 if defense_position else attack_value - opposing_value
            attack_options.append(
                (
                    100 + destroy_value + damage,
                    attacker["instance_id"],
                    defender["instance_id"],
                )
            )
        return attack_options

    @classmethod
    # Trả về điểm tấn công tốt nhất của một quái thú AI.
    def _ai_best_attack_score(
        cls,
        state: Mapping[str, Any],
        attacker: Mapping[str, Any],
    ) -> int:
        return max(
            (
                option[0]
                for option in cls._ai_attack_options_for_monster(
                    state,
                    attacker,
                )
            ),
            default=0,
        )

    # Mô phỏng hiệu ứng quái thú được sao chép và dùng nếu có lợi.
    def _ai_use_copied_monster_effects(self, state: dict[str, Any]) -> bool:
        pending_turn = state.get("_pending_ai_turn")
        if not isinstance(pending_turn, dict):
            return False
        used_sources = set(pending_turn.get("used_copy_effect_sources", []))
        for clone in list(state["players"]["ai"]["monster_zone"]):
            if (
                state.get("over")
                or not clone
                or clone.get("face_down", False)
                or clone.get("monster_effects_negated", False)
                or clone["instance_id"] in used_sources
            ):
                continue
            options = self.effect_engine.copied_monster_effect_options(
                state,
                player="ai",
                source_instance_id=clone["instance_id"],
            )
            if not options:
                continue

            baseline_score = self._ai_state_advantage(state)
            best_option = None
            best_score = baseline_score
            for option in options:
                try:
                    activated = self.effect_engine.activate(
                        state,
                        player="ai",
                        source_instance_id=option["source_instance_id"],
                        effect_id=option["effect_id"],
                        target_instance_ids=option["target_instance_ids"],
                    )
                except DuelRuleError:
                    continue
                resolved = self._simulate_chain_resolution(activated)
                score = self._ai_state_advantage(resolved)
                if score > best_score:
                    best_score = score
                    best_option = option

            if not best_option:
                continue
            activated = self.effect_engine.activate(
                state,
                player="ai",
                source_instance_id=best_option["source_instance_id"],
                effect_id=best_option["effect_id"],
                target_instance_ids=best_option["target_instance_ids"],
            )
            state.clear()
            state.update(activated)
            pending_turn = state.get("_pending_ai_turn")
            if not isinstance(pending_turn, dict):
                return False
            used_sources = set(pending_turn.get("used_copy_effect_sources", []))
            used_sources.add(clone["instance_id"])
            pending_turn["used_copy_effect_sources"] = list(used_sources)
            if self._advance_ai_chain_to_player_response(state):
                return True
        return False

    # Giải quyết lượt ưu tiên của AI cho đến khi cần người chơi phản hồi.
    def _advance_ai_chain_to_player_response(self, state: dict[str, Any]) -> bool:
        for _ in range(16):
            chain = state.get("chain", {})
            if chain.get("status") == "closed":
                self._resolve_pending_card_triggers(state)
                if state.get("pending_decision"):
                    return True
                if state.get("chain", {}).get("status") == "closed":
                    return False
                continue
            if chain.get("priority_player") == "player":
                links = chain.get("links") or []
                if links and links[-1].get("player") == "player":
                    updated = self.effect_engine.pass_priority(state, player="player")
                else:
                    options = self.effect_engine.chain_response_options(state, "player")
                    if len(options) == 1:
                        auto_option = options[0]
                        auto_source = find_card(state, auto_option["source_instance_id"])
                        if auto_source and auto_source[3].get("category") != "spell":
                            updated = self.effect_engine.activate(
                                state,
                                player="player",
                                source_instance_id=auto_option["source_instance_id"],
                                effect_id=auto_option["effect_id"],
                                target_instance_ids=auto_option["target_instance_ids"],
                            )
                            state.clear()
                            state.update(updated)
                            if updated.get("pending_decision"):
                                return True
                        else:
                            return True
                    elif options:
                        return True
                    else:
                        updated = self.effect_engine.pass_priority(state, player="player")
            elif chain.get("priority_player") == "ai":
                updated = self._pass_ai_priority(state)
            else:
                return True
            state.clear()
            state.update(updated)
        return state.get("chain", {}).get("status") != "closed"

    # Kết thúc lượt AI, xử lý End Phase và chuyển lượt về cho người chơi.
    def _finish_ai_turn(self, state: dict[str, Any]) -> None:
        state.pop("_pending_ai_turn", None)
        if not state.get("over"):
            state["phase"] = "end"
            resolve_end_phase_effects(state, "ai")
            ending_turn = state["turn"]
            state["stat_modifiers"] = expire_effects(
                state,
                "phase_end",
                player="ai",
                turn=ending_turn,
                phase="end",
            )["stat_modifiers"]
            state["stat_modifiers"] = expire_effects(
                state,
                "turn_end",
                player="ai",
                turn=ending_turn,
            )["stat_modifiers"]
        if state.get("over"):
            return
        self._record_ai_turn_stage(state, "end")
        state["turn"] += 1
        state["turn_player"] = "player"
        state["phase"] = "draw"
        state["drawn_this_turn"] = False
        state["normal_summon_used"]["player"] = False
        state["attacked"]["player"] = []
        self._draw_player_turn_card(state)

    @staticmethod
    # Rút một lá cho AI và xử lý các hiệu ứng được kích hoạt khi rút bài.
    def _draw_ai_turn_card(state: dict[str, Any]) -> None:
        next_state, drawn = draw_cards(state, "ai", 1)
        state.clear()
        state.update(next_state)
        state["drawn_this_turn"] = True
        apply_draw_triggers(state, "ai", len(drawn))

    # Chọn bài để Triệu hồi/đặt xuống, gồm các lượt Triệu hồi Đặc biệt hỗ trợ.
    def _set_ai_card(self, state: dict[str, Any]) -> None:
        hand = state["players"]["ai"]["hand"]
        if not hand:
            return
        card = self._ai_special_summon_candidate(state)
        summon_plan = None
        if card is None and not state["normal_summon_used"]["ai"]:
            summonable_monsters = []
            for candidate in hand:
                if (
                    candidate.get("category") != "monster"
                    or candidate.get("card_id")
                    in {
                        VALKYRION_ID,
                        CHAOS_EMPEROR_ID,
                        CHAOS_LEVIANEER_ID,
                        "m-black-luster-soldier-envoy-of-the-beginning",
                        "m-blue-eyes-alternative-white-dragon",
                        HORAKHTY_ID,
                    }
                ):
                    continue
                plan = self._ai_summon_plan(state, candidate)
                if plan:
                    summonable_monsters.append((candidate, plan))
            if summonable_monsters:
                card, summon_plan = max(
                    summonable_monsters,
                    key=lambda option: int(
                        option[0].get("atk") or option[0].get("base_atk") or 0
                    ),
                )
        if card is None:
            settable_cards = [
                candidate
                for candidate in hand
                if candidate.get("category") in {"spell", "trap"}
            ]
            if settable_cards and any(
                field_card is None
                for field_card in state["players"]["ai"]["spell_trap_zone"]
            ):
                card = next(
                    (
                        candidate
                        for candidate in settable_cards
                        if candidate.get("category") == "trap"
                    ),
                    settable_cards[-1],
                )
        if card is None:
            return
        if card.get("card_id") == "m-black-luster-soldier-envoy-of-the-beginning":
            grave = state["players"]["ai"]["graveyard"]
            light = next(
                (
                    candidate
                    for candidate in grave
                    if candidate.get("category") in {"monster", "fusion"}
                    and str(candidate.get("attribute") or "").upper() == "LIGHT"
                ),
                None,
            )
            dark = next(
                (
                    candidate
                    for candidate in grave
                    if candidate.get("category") in {"monster", "fusion"}
                    and str(candidate.get("attribute") or "").upper() == "DARK"
                ),
                None,
            )
            if (
                light
                and dark
                and card.get("category") == "monster"
                and any(
                    field_card is None
                    for field_card in state["players"]["ai"]["monster_zone"]
                )
            ):
                move_card(state, light["instance_id"], "ai", "banished")
                move_card(state, dark["instance_id"], "ai", "banished")
                was_properly_summoned = card.get("properly_summoned")
                card["properly_summoned"] = True
                if not _special_summon(
                    state,
                    "ai",
                    card["instance_id"],
                    position=self._ai_summon_position(state, card),
                ):
                    if was_properly_summoned is None:
                        card.pop("properly_summoned", None)
                    else:
                        card["properly_summoned"] = was_properly_summoned
            return
        if card.get("card_id") == CHAOS_EMPEROR_ID:
            light = next(
                (
                    candidate
                    for candidate in state["players"]["ai"]["graveyard"]
                    if candidate.get("category") in {"monster", "fusion"}
                    and str(candidate.get("attribute") or "").upper() == "LIGHT"
                ),
                None,
            )
            dark = next(
                (
                    candidate
                    for candidate in state["players"]["ai"]["graveyard"]
                    if candidate.get("category") in {"monster", "fusion"}
                    and str(candidate.get("attribute") or "").upper() == "DARK"
                ),
                None,
            )
            if (
                light
                and dark
                and card.get("category") == "monster"
                and any(
                    field_card is None
                    for field_card in state["players"]["ai"]["monster_zone"]
                )
            ):
                move_card(state, light["instance_id"], "ai", "banished")
                move_card(state, dark["instance_id"], "ai", "banished")
                was_properly_summoned = card.get("properly_summoned")
                card["properly_summoned"] = True
                if not _special_summon(
                    state,
                    "ai",
                    card["instance_id"],
                    position=self._ai_summon_position(state, card),
                ):
                    if was_properly_summoned is None:
                        card.pop("properly_summoned", None)
                    else:
                        card["properly_summoned"] = was_properly_summoned
            return
        if card.get("card_id") == CHAOS_LEVIANEER_ID:
            grave = state["players"]["ai"]["graveyard"]
            light = [
                candidate
                for candidate in grave
                if candidate.get("category") in {"monster", "fusion"}
                and str(candidate.get("attribute") or "").upper() == "LIGHT"
            ]
            dark = [
                candidate
                for candidate in grave
                if candidate.get("category") in {"monster", "fusion"}
                and str(candidate.get("attribute") or "").upper() == "DARK"
            ]
            if card.get("category") != "monster":
                return
            materials = []
            free_slots = sum(
                field_card is None
                for field_card in state["players"]["ai"]["monster_zone"]
            )
            light_material_ids = {material["instance_id"] for material in light[:2]}
            if (
                len(light) >= 2
                and free_slots >= 2
                and any(
                    candidate.get("category") in {"monster", "fusion"}
                    and candidate["instance_id"] not in light_material_ids
                    and _can_be_special_summoned(candidate)
                    for candidate in grave
                )
            ):
                materials = light[:2]
            elif len(dark) >= 2 and state["players"]["player"]["hand"]:
                materials = dark[:2]
            elif light and dark:
                materials = [light[0], dark[0]]
            else:
                materials = (light + dark)[:2]
            if len(materials) == 2 and any(
                field_card is None
                for field_card in state["players"]["ai"]["monster_zone"]
            ):
                attributes = [str(material.get("attribute") or "").upper() for material in materials]
                was_properly_summoned = card.get("properly_summoned")
                card["properly_summoned"] = True
                card["levianeer_summon_attributes"] = attributes
                for material in materials:
                    move_card(state, material["instance_id"], "ai", "banished")
                if not _special_summon(
                    state,
                    "ai",
                    card["instance_id"],
                    position=self._ai_summon_position(state, card),
                ):
                    if was_properly_summoned is None:
                        card.pop("properly_summoned", None)
                    else:
                        card["properly_summoned"] = was_properly_summoned
                    card.pop("levianeer_summon_attributes", None)
            return
        if card.get("category") == "monster":
            if not summon_plan:
                summon_plan = self._ai_summon_plan(state, card)
            if not summon_plan:
                return
            free_index, tribute_ids = summon_plan
            position = self._ai_summon_position(state, card)
            if position == "defense" and card.get("card_id") not in GOD_CARD_IDS:
                self._set_card(
                    state,
                    "ai",
                    {
                        "instance_id": card["instance_id"],
                        "zone_index": free_index,
                        "tribute_instance_ids": tribute_ids,
                    },
                )
            else:
                self._summon(
                    state,
                    "ai",
                    {
                        "instance_id": card["instance_id"],
                        "zone_index": free_index,
                        "position": "attack",
                        "tribute_instance_ids": tribute_ids,
                    },
                )
            return
        if card.get("category") not in {"spell", "trap"}:
            return
        zone = state["players"]["ai"]["spell_trap_zone"]
        free_index = next(
            (index for index, field_card in enumerate(zone) if field_card is None),
            None,
        )
        if free_index is None:
            return
        moved = move_card(
            state,
            card["instance_id"],
            "ai",
            "spell_trap_zone",
            destination_index=free_index,
        )
        moved["face_down"] = True
        moved["set_turn"] = state["turn"]

    @staticmethod
    # Chọn thế công hay thủ dựa trên khả năng thắng các quái thú đang lộ mặt.
    def _ai_summon_position(
        state: Mapping[str, Any],
        monster: Mapping[str, Any],
    ) -> str:
        attack = int(monster.get("atk") or monster.get("base_atk") or 0)
        opposing_monsters = [
            card for card in state["players"]["player"]["monster_zone"] if card
        ]
        if not opposing_monsters:
            return "attack"
        for defender in opposing_monsters:
            if defender.get("face_down", False):
                continue
            stats = current_stats(state, defender["instance_id"])
            opposing_value = (
                stats["def"]
                if defender.get("position") == "defense"
                else stats["atk"]
            )
            if attack > opposing_value:
                return "attack"
        return "defense"

    @staticmethod
    # Tìm quái thú Chaos trên tay đủ điều kiện Triệu hồi Đặc biệt.
    def _ai_special_summon_candidate(
        state: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        hand = state["players"]["ai"]["hand"]
        if not any(card is None for card in state["players"]["ai"]["monster_zone"]):
            return None
        eligible_materials = [
            card
            for card in state["players"]["ai"]["graveyard"]
            if card.get("category") in {"monster", "fusion"}
            and str(card.get("attribute") or "").upper() in {"LIGHT", "DARK"}
        ]
        light = any(
            str(card.get("attribute") or "").upper() == "LIGHT"
            for card in eligible_materials
        )
        dark = any(
            str(card.get("attribute") or "").upper() == "DARK"
            for card in eligible_materials
        )
        candidates = []
        for card in hand:
            if card.get("category") != "monster":
                continue
            card_id = card.get("card_id")
            can_summon = (
                card_id in {
                    "m-black-luster-soldier-envoy-of-the-beginning",
                    CHAOS_EMPEROR_ID,
                }
                and light
                and dark
            ) or (
                card_id == CHAOS_LEVIANEER_ID
                and len(eligible_materials) >= 2
            )
            if can_summon:
                candidates.append(card)
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda card: int(card.get("atk") or card.get("base_atk") or 0),
        )

    # Bỏ lá ít giá trị hơn làm chi phí rồi Triệu hồi Đặc biệt Tricky.
    def _ai_summon_tricky(self, state: dict[str, Any]) -> bool:
        hand = state["players"]["ai"]["hand"]
        if (
            state.get("pending_decision")
            or state.get("phase") not in MAIN_PHASES
            or not any(
                card is None for card in state["players"]["ai"]["monster_zone"]
            )
            or len(hand) < 2
        ):
            return False
        tricky = next(
            (card for card in hand if card.get("card_id") == "m-the-tricky"),
            None,
        )
        if not tricky or not _can_be_special_summoned(tricky):
            return False

        discard = min(
            (card for card in hand if card["instance_id"] != tricky["instance_id"]),
            key=lambda card: (
                0 if card.get("category") == "monster" else 1,
                int(card.get("atk") or card.get("base_atk") or 0),
                card["instance_id"],
            ),
        )
        self._begin_tricky_summon(
            state,
            "ai",
            {"source_instance_id": tricky["instance_id"]},
        )
        complete_pending_discard(
            state,
            "ai",
            [discard["instance_id"]],
            defer_tricky_summon=True,
        )
        self._record_ai_turn_stage(state, "discard")
        if not _special_summon(state, "ai", tricky["instance_id"]):
            tricky_location = find_card(state, tricky["instance_id"])
            if tricky_location and tricky_location[:2] == ("ai", "hand"):
                raise DuelRuleError("AI không thể Triệu hồi Tricky sau khi trả chi phí.")
        return True

    # Đánh giá việc trang bị hoặc tháo trang bị quái thú Union.
    def _ai_use_union_monsters(self, state: dict[str, Any]) -> None:
        if state.get("pending_decision") or state.get("phase") not in MAIN_PHASES:
            return
        free_monster_zone = any(
            card is None for card in state["players"]["ai"]["monster_zone"]
        )
        equipped_y_dragon = next(
            (
                card
                for card in state["players"]["ai"]["spell_trap_zone"]
                if card
                and card.get("card_id") == "m-y-dragon-head"
                and card.get("union_equipped")
                and not card.get("face_down", False)
                and state.get("effect_uses", {}).get(
                    f"{card['instance_id']}:m-y-dragon-head:union"
                ) != state["turn"]
            ),
            None,
        )
        if free_monster_zone and equipped_y_dragon:
            target = find_card(
                state,
                equipped_y_dragon.get("target_instance_id"),
            )
            if target and target[0] == "ai" and target[1] == "monster_zone":
                current_attack_score = self._ai_best_attack_score(state, target[3])
                projected_state = deepcopy(state)
                self._use_union_monster_effect(
                    projected_state,
                    "ai",
                    {
                        "mode": "detach",
                        "source_instance_id": equipped_y_dragon["instance_id"],
                    },
                )
                projected_target = find_card(
                    projected_state,
                    equipped_y_dragon.get("target_instance_id"),
                )
                projected_y_dragon = find_card(
                    projected_state,
                    equipped_y_dragon["instance_id"],
                )
                projected_attack_score = (
                    self._ai_best_attack_score(projected_state, projected_target[3])
                    + self._ai_best_attack_score(projected_state, projected_y_dragon[3])
                    if projected_target and projected_y_dragon
                    else 0
                )
                if projected_attack_score > current_attack_score:
                    self._use_union_monster_effect(
                        state,
                        "ai",
                        {
                            "mode": "detach",
                            "source_instance_id": equipped_y_dragon["instance_id"],
                        },
                    )
                    return
        targets = [
            card
            for card in state["players"]["ai"]["monster_zone"]
            if card
            and card.get("card_id") in {"m-x-head-cannon", "m-y-dragon-head"}
            and not card.get("face_down", False)
        ]
        if not targets or not any(
            card is None for card in state["players"]["ai"]["spell_trap_zone"]
        ):
            return
        union_card = next(
            (
                card
                for zone in ("hand", "monster_zone")
                for card in state["players"]["ai"][zone]
                if card
                and card.get("card_id") in {"m-y-dragon-head", "m-z-metal-tank"}
                and not card.get("union_equipped", False)
                and not card.get("face_down", False)
                and state.get("effect_uses", {}).get(
                    f"{card['instance_id']}:{card['card_id']}:union"
                ) != state["turn"]
                and (
                    zone != "monster_zone"
                    or not monster_effects_are_negated(state, card["instance_id"])
                )
            ),
            None,
        )
        if union_card:
            target_ids = (
                {"m-x-head-cannon"}
                if union_card.get("card_id") == "m-y-dragon-head"
                else {"m-x-head-cannon", "m-y-dragon-head"}
            )
            target = next(
                (card for card in targets if card.get("card_id") in target_ids),
                None,
            )
            if not target:
                return
            self._use_union_monster_effect(
                state,
                "ai",
                {
                    "mode": "equip",
                    "source_instance_id": union_card["instance_id"],
                    "target_instance_id": target["instance_id"],
                },
            )

    @classmethod
    # Tìm ô triệu hồi và nhóm Tribute hợp lệ cho quái thú trên tay.
    def _ai_summon_plan(
        cls, state: Mapping[str, Any], monster: Mapping[str, Any]
    ) -> tuple[int, list[str]] | None:
        if state["normal_summon_used"]["ai"]:
            return None
        zone = state["players"]["ai"]["monster_zone"]
        required = cls._required_tributes(monster)
        tribute_candidates = [card for card in zone if card is not None]
        tribute_ids: list[str] = []
        if required:
            for tribute_count in range(1, min(required, len(tribute_candidates)) + 1):
                for selection in combinations(tribute_candidates, tribute_count):
                    if sum(
                        cls._tribute_value(
                            tribute,
                            monster,
                            required,
                        )
                        for tribute in selection
                    ) == required:
                        tribute_ids = [
                            tribute["instance_id"] for tribute in selection
                        ]
                        break
                if tribute_ids:
                    break
            if not tribute_ids:
                return None
        tribute_indexes = {
            index
            for index, field_card in enumerate(zone)
            if field_card and field_card["instance_id"] in tribute_ids
        }
        zone_index = next(
            (
                index
                for index, field_card in enumerate(zone)
                if field_card is None or index in tribute_indexes
            ),
            None,
        )
        return (zone_index, tribute_ids) if zone_index is not None else None

    # Chọn phản hồi Chain nếu mô phỏng cho thấy có lợi; nếu không thì bỏ lượt.
    def _pass_ai_priority(self, state: dict[str, Any]) -> dict[str, Any]:
        chain = state.get("chain", {})
        if chain.get("status") == "open" and chain.get("priority_player") == "ai":
            baseline = self._simulate_chain_resolution(state)
            baseline_score = self._ai_state_advantage(baseline)
            best_option = None
            best_score = baseline_score

            for option in self.effect_engine.chain_response_options(state, "ai"):
                response_state = self.effect_engine.activate(
                    state,
                    player="ai",
                    source_instance_id=option["source_instance_id"],
                    effect_id=option["effect_id"],
                    target_instance_ids=option["target_instance_ids"],
                )
                resolved = self._simulate_chain_resolution(response_state)
                score = self._ai_state_advantage(resolved)
                if score > best_score:
                    best_score = score
                    best_option = option

            if best_option:
                return self.effect_engine.activate(
                    state,
                    player="ai",
                    source_instance_id=best_option["source_instance_id"],
                    effect_id=best_option["effect_id"],
                    target_instance_ids=best_option["target_instance_ids"],
                )
            return self.effect_engine.pass_priority(state, player="ai")
        return state

    @staticmethod
    # Ước lượng lợi thế hai bên để AI so sánh các trạng thái sau mô phỏng.
    def _ai_state_advantage(state: Mapping[str, Any]) -> float:
        def player_value(player: str) -> float:
            zones = state["players"][player]
            value = zones["lp"] / 100
            value += len(zones["hand"]) * 20
            value += len(zones["deck"]) * 1
            value += len(zones["extra_deck"]) * 1
            value += sum(bool(card) for card in zones["spell_trap_zone"]) * 12
            for card in zones["monster_zone"]:
                if card:
                    if player == "player" and card.get("face_down", False):
                        value += 40
                    else:
                        stats = current_stats(state, card["instance_id"])
                        value += 40 + max(0, stats["atk"]) / 100
            for card in zones["graveyard"]:
                if not card.get(CRUSH_CARD_VIRUS_GY_LOCK):
                    value += 2
            return value

        advantage = player_value("ai") - player_value("player")
        if state.get("winner") == "ai":
            advantage += 100000
        elif state.get("winner") == "player":
            advantage -= 100000
        return advantage
