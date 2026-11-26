"""Validated player actions and turn progression for the server-side duel."""

from __future__ import annotations

import random
from copy import deepcopy
from itertools import combinations
from typing import Any, Mapping

from .duel_ai import (
    CHAOS_EMPEROR_ID,
    CHAOS_LEVIANEER_ID,
    GOD_CARD_IDS,
    HORAKHTY_ID,
    MAIN_PHASES,
    VALKYRION_ID,
    VALKYRION_MATERIAL_IDS,
    DuelAIMixin,
)
from .duel_effects import (
    CLONING_TRAP_ID,
    CLONE_DRAGON_ID,
    CRUSH_CARD_VIRUS_ID,
    EQUIP_SPELL_IDS,
    QUICK_SPELL_IDS,
    SPELL_RECOVERY_RULES,
    _can_be_special_summoned,
    _maiden_blue_eyes_candidates,
    _queue_maiden_summon_selection,
    _special_summon,
    apply_draw_triggers,
    can_change_battle_position,
    can_declare_attack,
    check_win_by_exodia,
    complete_pending_card_selection,
    complete_pending_discard,
    is_battle_protected,
    resolve_attack_trap,
    resolve_end_phase_effects,
    resolve_monster_summon_effects,
    resolve_flip_effects,
    resolve_standby_effects,
)
from .duel_engine import (
    CRUSH_CARD_VIRUS_GY_LOCK,
    DuelEffectEngine,
    DuelRuleError,
    add_stat_modifier,
    apply_slifer_thunderforce,
    change_life_points,
    current_stats,
    destroy_card,
    draw_cards,
    expire_effects,
    find_card,
    move_card,
    monster_effects_are_negated,
    opponent_of,
    trap_effect_is_negated,
)


PHASES = ("draw", "standby", "main1", "battle", "main2", "end")
MAX_HAND_SIZE = 6


class DuelActionEngine(DuelAIMixin):
    """Apply authenticated-player actions to a copied, authoritative state."""

    def __init__(self, effect_engine: DuelEffectEngine) -> None:
        self.effect_engine = effect_engine

    def apply(
        self,
        state: Mapping[str, Any],
        *,
        player: str,
        action: Mapping[str, Any],
    ) -> dict[str, Any]:
        if player not in {"player", "ai"}:
            raise DuelRuleError("Người chơi không hợp lệ.")
        if not isinstance(action, Mapping):
            raise DuelRuleError("Hành động Duel không hợp lệ.")
        if state.get("over"):
            raise DuelRuleError("Duel đã kết thúc.")

        action_type = action.get("type")
        if not isinstance(action_type, str):
            raise DuelRuleError("Thiếu loại hành động Duel.")
        if state.get("pending_decision") and action_type not in {
            "complete_discard",
            "complete_card_selection",
            "skip_burning_dragon_effect",
            "maiden_attack_effect",
            "skip_maiden_attack_effect",
            "activate_cloning",
            "skip_cloning",
            "complete_ordeal_traveler_guess",
        }:
            raise DuelRuleError("Hãy hoàn tất lựa chọn đang chờ.")
        pending_battle = state.get("pending_battle")
        if pending_battle and pending_battle.get("awaiting_resolution"):
            if action_type != "resolve_battle":
                raise DuelRuleError("Hãy xác nhận kết quả chiến đấu đang chờ.")
        elif action_type == "resolve_battle":
            raise DuelRuleError("Không có kết quả chiến đấu nào đang chờ.")
        if state.get("chain", {}).get("status") == "resolving":
            raise DuelRuleError("Không thể thao tác khi Chain đang giải quyết.")
        if state.get("chain", {}).get("status") == "open" and action_type not in {
            "activate_effect",
            "pass_chain",
        }:
            raise DuelRuleError("Hãy giải quyết Chain trước.")

        next_state = deepcopy(dict(state))
        pending_battle_before = next_state.get("pending_battle")
        pending_ai_battle = (
            deepcopy(pending_battle_before)
            if next_state.get("_pending_ai_turn")
            and isinstance(pending_battle_before, Mapping)
            and pending_battle_before.get("attacker_player") == "ai"
            else None
        )
        if next_state.get("_pending_ai_turn"):
            next_state["_ai_turn_stages"] = []
        if action_type == "draw":
            self._draw(next_state, player)
        elif action_type == "advance_phase":
            self._advance_phase(next_state, player)
        elif action_type == "summon":
            self._summon(next_state, player, action)
        elif action_type == "begin_tricky_summon":
            self._begin_tricky_summon(next_state, player, action)
        elif action_type == "begin_spell_recovery":
            self._begin_spell_recovery(next_state, player, action)
        elif action_type == "special_summon_kaiser_vorse":
            self._special_summon_kaiser_vorse(next_state, player, action)
        elif action_type == "special_summon_lava_golem":
            self._special_summon_lava_golem(next_state, player, action)
        elif action_type == "special_summon_blue_eyes_alternative":
            self._special_summon_blue_eyes_alternative(next_state, player, action)
        elif action_type == "special_summon_black_luster_soldier":
            self._special_summon_black_luster_soldier(next_state, player, action)
        elif action_type == "special_summon_chaos_emperor":
            self._special_summon_chaos_emperor(next_state, player, action)
        elif action_type == "special_summon_levianeer":
            self._special_summon_levianeer(next_state, player, action)
        elif action_type == "union_effect":
            self._use_union_monster_effect(next_state, player, action)
        elif action_type == "special_summon_valkyrion":
            self._special_summon_valkyrion(next_state, player, action)
        elif action_type == "split_valkyrion":
            self._split_valkyrion(next_state, player, action)
        elif action_type == "set_card":
            self._set_card(next_state, player, action)
        elif action_type == "flip_summon":
            self._flip_summon(next_state, player, action)
        elif action_type == "change_position":
            self._change_position(next_state, player, action)
        elif action_type == "attack":
            self._attack(next_state, player, action)
        elif action_type == "resolve_battle":
            pending = next_state.get("pending_battle")
            if not pending or pending.get("attacker_player") != player:
                raise DuelRuleError("Người chơi không thể xác nhận trận chiến này.")
            self._require_turn(next_state, player)
            self._resolve_pending_battle(next_state)
        elif action_type == "maiden_attack_effect":
            self._activate_maiden_attack_effect(next_state, player)
        elif action_type == "skip_maiden_attack_effect":
            pending = next_state.get("pending_decision")
            if (
                not pending
                or pending.get("type") != "maiden_attack"
                or pending.get("player") != player
            ):
                raise DuelRuleError("Không có hiệu ứng tấn công của Thiếu Nữ Mắt Xanh đang chờ.")
            next_state["pending_decision"] = None
        elif action_type == "activate_cloning":
            next_state = self._activate_cloning(next_state, player)
        elif action_type == "skip_cloning":
            pending = next_state.get("pending_decision")
            if (
                not pending
                or pending.get("type") != "cloning_offer"
                or pending.get("player") != player
            ):
                raise DuelRuleError("Không có thông báo Nhân Bản Quái Thú đang chờ.")
            next_state["pending_decision"] = None
        elif action_type == "complete_ordeal_traveler_guess":
            self._complete_ordeal_traveler_guess(next_state, player, action)
        elif action_type == "activate_effect":
            next_state = self._activate_effect(next_state, player, action)
        elif action_type == "pass_chain":
            next_state = self._pass_chain(next_state, player)
        elif action_type == "complete_discard":
            instance_ids = action.get("instance_ids")
            pending = next_state.get("pending_decision")
            if pending and pending.get("type") == "spell_recovery_discard":
                source_id = pending.get("source_instance_id")
                eligible_target_ids = pending.get("eligible_target_instance_ids")
                complete_pending_discard(next_state, player, instance_ids)
                next_state["_paid_spell_recovery"] = {
                    "player": player,
                    "source_instance_id": source_id,
                    "eligible_target_instance_ids": eligible_target_ids,
                }
                next_state = self.effect_engine.activate(
                    next_state,
                    player=player,
                    source_instance_id=source_id,
                    effect_id="activate",
                    payload={
                        "eligible_target_instance_ids": eligible_target_ids,
                    },
                )
                next_state.pop("_paid_spell_recovery", None)
                next_state = self._finish_player_activation(next_state, player)
            else:
                complete_pending_discard(next_state, player, instance_ids)
        elif action_type == "skip_burning_dragon_effect":
            pending = next_state.get("pending_decision")
            if (
                not pending
                or pending.get("type") != "burning_dragon_discard"
                or pending.get("player") != player
            ):
                raise DuelRuleError("Không có hiệu ứng Rồng Hỏa Diệm đang chờ bỏ qua.")
            next_state["pending_decision"] = None
        elif action_type == "complete_card_selection":
            instance_ids = action.get("instance_ids")
            pending = next_state.get("pending_decision")
            if pending and pending.get("effect_card_id") == CLONE_DRAGON_ID:
                self._complete_clone_dragon_selection(
                    next_state,
                    player,
                    instance_ids,
                )
            else:
                complete_pending_card_selection(next_state, player, instance_ids)
        elif action_type == "discard":
            self._discard(next_state, player, action)
        else:
            raise DuelRuleError("Hành động Duel chưa được hỗ trợ.")
        self._resolve_pending_card_triggers(next_state)
        if (
            next_state.get("pending_battle")
            and next_state.get("chain", {}).get("status") == "closed"
            and not next_state.get("pending_decision")
            and not next_state["pending_battle"].get("awaiting_resolution")
        ):
            self._prepare_pending_battle(next_state)
            self._resolve_pending_card_triggers(next_state)
        if pending_ai_battle and not next_state.get("pending_battle"):
            self._record_ai_turn_stage(
                next_state,
                "attack_result",
                attacker_instance_id=pending_ai_battle["attacker_instance_id"],
                defender_instance_id=pending_ai_battle.get("defender_instance_id"),
            )
        if (
            next_state.get("_pending_ai_turn")
            and next_state.get("chain", {}).get("status") == "closed"
            and not next_state.get("pending_decision")
            and not next_state.get("over")
        ):
            self._resume_ai_main_phase(next_state)
        return next_state

    def _use_union_monster_effect(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        union_card_id = source[3].get("card_id") if source else None
        union_rules = {
            "m-y-dragon-head": {
                "targets": {"m-x-head-cannon"},
                "bonus": 400,
                "name": "Rồng Chữ Y",
            },
            "m-z-metal-tank": {
                "targets": {"m-x-head-cannon", "m-y-dragon-head"},
                "bonus": 600,
                "name": "Xe Tăng Bọc Thép Z",
            },
        }
        rule = union_rules.get(union_card_id)
        if (
            not source
            or source[0] != player
            or not rule
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Quái thú Hợp Thể không còn được bạn điều khiển.")

        usage_key = f"{source_id}:{union_card_id}:union"
        if state.get("effect_uses", {}).get(usage_key) == state["turn"]:
            raise DuelRuleError(f"{rule['name']} chỉ có thể sử dụng hiệu ứng này một lần mỗi lượt.")

        mode = action.get("mode")
        if mode == "equip":
            if source[1] not in {"hand", "monster_zone"} or (
                source[1] == "monster_zone"
                and (
                    source[3].get("face_down", False)
                    or monster_effects_are_negated(state, source_id)
                )
            ):
                raise DuelRuleError("Chỉ có thể trang bị Rồng Chữ Y từ tay hoặc sân ngửa.")
            target_id = action.get("target_instance_id")
            target = find_card(state, target_id) if isinstance(target_id, str) else None
            if (
                not target
                or target[0] != player
                or target[1] != "monster_zone"
                or target[3].get("category") not in {"monster", "fusion"}
                or target[3].get("card_id") not in rule["targets"]
                or target[3].get("face_down", False)
            ):
                raise DuelRuleError(
                    f"{rule['name']} chỉ có thể trang bị cho quái thú hợp lệ đang ngửa của bạn."
                )
            spell_trap_index = next(
                (
                    index
                    for index, card in enumerate(state["players"][player]["spell_trap_zone"])
                    if card is None
                ),
                None,
            )
            if spell_trap_index is None:
                raise DuelRuleError(f"Không còn ô Phép/Bẫy trống để trang bị {rule['name']}.")

            source[3]["union_equipped"] = True
            equipped = move_card(
                state,
                source_id,
                player,
                "spell_trap_zone",
                destination_index=spell_trap_index,
            )
            equipped["target_instance_id"] = target_id
            for stat in ("atk", "def"):
                updated = add_stat_modifier(
                    state,
                    target_instance_id=target_id,
                    source_instance_id=source_id,
                    source_card_id=union_card_id,
                    owner=player,
                    stat=stat,
                    operation="increase",
                    value=rule["bonus"],
                    duration={
                        "type": "source_leaves_field",
                        "source_instance_id": source_id,
                    },
                )
                state.clear()
                state.update(updated)
        elif mode == "detach":
            if (
                source[1] != "spell_trap_zone"
                or source[3].get("face_down", False)
                or not source[3].get("union_equipped")
            ):
                raise DuelRuleError(f"{rule['name']} chưa được trang bị.")
            target = find_card(state, source[3].get("target_instance_id"))
            if not target or target[0] != player or target[1] != "monster_zone":
                raise DuelRuleError("Quái thú được trang bị không còn là quái thú trên sân của bạn.")
            monster_zone_index = next(
                (
                    index
                    for index, card in enumerate(state["players"][player]["monster_zone"])
                    if card is None
                ),
                None,
            )
            if monster_zone_index is None:
                raise DuelRuleError(f"Không còn ô Quái thú trống để Triệu hồi Đặc biệt {rule['name']}.")

            state["stat_modifiers"] = [
                modifier
                for modifier in state.get("stat_modifiers", [])
                if modifier.get("source_instance_id") != source_id
            ]
            summoned = move_card(
                state,
                source_id,
                player,
                "monster_zone",
                destination_index=monster_zone_index,
            )
            summoned.pop("target_instance_id", None)
            summoned.pop("union_equipped", None)
            summoned["face_down"] = False
            summoned["position"] = "attack"
            summoned["summon_method"] = "special"
            summoned["summoned_turn"] = state["turn"]
            resolve_monster_summon_effects(
                state, player, source_id, "special"
            )
        else:
            raise DuelRuleError(f"Hành động hiệu ứng {rule['name']} không hợp lệ.")

        state.setdefault("effect_uses", {})[usage_key] = state["turn"]

    @staticmethod
    def _require_turn(state: Mapping[str, Any], player: str) -> None:
        if state.get("turn_player") != player:
            raise DuelRuleError("Chưa đến lượt của người chơi.")

    def _resolve_pending_card_triggers(self, state: dict[str, Any]) -> None:
        if (
            state.get("over")
            or state.get("pending_decision")
            or state.get("chain", {}).get("status") != "closed"
        ):
            return
        pending_triggers = state.setdefault("pending_card_triggers", [])
        while pending_triggers:
            trigger = pending_triggers.pop(0)
            card_id = trigger.get("card_id")
            if card_id == CLONE_DRAGON_ID:
                player = trigger.get("player")
                if player not in {"player", "ai"}:
                    continue
                source = find_card(state, trigger.get("source_instance_id"))
                if trigger.get("event") == "destroyed":
                    if (
                        source
                        and source[0] == player
                        and source[1] == "graveyard"
                        and source[3].get("card_id") == CLONE_DRAGON_ID
                    ):
                        change_life_points(state, player, 1000)
                    continue
                if (
                    trigger.get("event") != "summon"
                    or not source
                    or source[0] != player
                    or source[1] != "hand"
                    or source[3].get("card_id") != CLONE_DRAGON_ID
                    or not any(
                        card is None
                        for card in state["players"][player]["monster_zone"]
                    )
                ):
                    continue
                target_ids = self.effect_engine.clone_dragon_target_ids(state)
                if not target_ids:
                    continue
                if player == "ai":
                    target_id = max(
                        target_ids,
                        key=lambda instance_id: current_stats(state, instance_id)[
                            "atk"
                        ],
                    )
                    self._summon_clone_dragon(state, player, source[3]["instance_id"], target_id)
                    continue
                state["pending_decision"] = {
                    "type": "select_field_cards",
                    "player": player,
                    "source_instance_id": source[3]["instance_id"],
                    "effect_card_id": CLONE_DRAGON_ID,
                    "summoned_instance_id": trigger.get("summoned_instance_id"),
                    "target_mode": "clone-dragon-field-monster",
                    "eligible_target_instance_ids": target_ids,
                    "min_count": 0,
                    "max_count": 1,
                }
                return
            if card_id == CRUSH_CARD_VIRUS_ID:
                player = trigger.get("player")
                source = find_card(state, trigger.get("source_instance_id"))
                target_id = trigger.get("target_instance_id")
                if (
                    player not in {"player", "ai"}
                    or not source
                    or source[0] != player
                    or source[1] != "graveyard"
                    or source[3].get("card_id") != CRUSH_CARD_VIRUS_ID
                    or not source[3].get("crush_card_virus_armed")
                    or source[3].get("crush_card_virus_target_instance_id")
                    != target_id
                ):
                    continue

                source[3]["crush_card_virus_armed"] = False
                source[3].pop("crush_card_virus_target_instance_id", None)
                opponent = opponent_of(player)
                affected_ids = []
                for zone in ("hand", "deck", "monster_zone"):
                    for card in state["players"][opponent][zone]:
                        if not card or card.get("category") not in {"monster", "fusion"}:
                            continue
                        atk = (
                            current_stats(state, card["instance_id"])["atk"]
                            if zone == "monster_zone"
                            else int(card.get("base_atk", card.get("atk", 0)) or 0)
                        )
                        if atk >= 1500:
                            affected_ids.append(card["instance_id"])

                for instance_id in affected_ids:
                    found = find_card(state, instance_id)
                    if (
                        not found
                        or found[0] != opponent
                        or found[1] not in {"hand", "deck", "monster_zone"}
                        or found[3].get("category") not in {"monster", "fusion"}
                    ):
                        continue
                    move_card(state, instance_id, opponent, "graveyard")[
                        CRUSH_CARD_VIRUS_GY_LOCK
                    ] = True
                continue
            if card_id == CLONING_TRAP_ID:
                player = trigger.get("player")
                if player not in {"player", "ai"}:
                    continue
                source = find_card(state, trigger.get("source_instance_id"))
                target_id = trigger.get("summoned_instance_id")
                target = find_card(state, target_id) if isinstance(target_id, str) else None
                if (
                    not source
                    or source[0] != player
                    or source[1] != "spell_trap_zone"
                    or source[3].get("card_id") != CLONING_TRAP_ID
                    or not source[3].get("face_down", False)
                    or source[3].get("set_turn", 0) >= state["turn"]
                    or not target
                    or target[0] != opponent_of(player)
                    or target[1] != "monster_zone"
                    or target[3].get("category") not in {"monster", "fusion"}
                    or target[3].get("face_down", False)
                    or target[3].get("summon_method")
                    not in {"normal", "tribute", "special"}
                    or target[3].get("summoned_turn") != state["turn"]
                    or self.effect_engine.spell_trap_activation_forbidden(
                        state,
                        player=player,
                        source_instance_id=source[3]["instance_id"],
                    )
                    or trap_effect_is_negated(state, player)
                ):
                    continue
                if not any(
                    card is None
                    for card in state["players"][player]["monster_zone"]
                ):
                    continue
                if player == "ai":
                    state["_cloning_activation"] = {
                        "player": player,
                        "source_instance_id": source[3]["instance_id"],
                        "summoned_instance_id": target_id,
                    }
                    updated = self.effect_engine.activate(
                        state,
                        player=player,
                        source_instance_id=source[3]["instance_id"],
                        effect_id="activate",
                        target_instance_ids=[target_id],
                        payload={"summoned_instance_id": target_id},
                    )
                    updated.pop("_cloning_activation", None)
                    state.clear()
                    state.update(updated)
                    return
                state["pending_decision"] = {
                    "type": "cloning_offer",
                    "player": player,
                    "source_instance_id": source[3]["instance_id"],
                    "summoned_instance_id": target_id,
                    "target_name": target[3].get(
                        "name", target[3].get("card_id", "quái thú")
                    ),
                }
                return
            if (
                card_id == "m-night-assailant"
                and trigger.get("player") in {"player", "ai"}
            ):
                player = trigger["player"]
                source = find_card(state, trigger.get("source_instance_id"))
                if (
                    not source
                    or source[0] != player
                    or source[1] != "graveyard"
                    or source[3].get("card_id") != card_id
                ):
                    continue
                eligible_targets = [
                    card
                    for card in state["players"][player]["graveyard"]
                    if card["instance_id"] != source[3]["instance_id"]
                ]
                if not eligible_targets:
                    continue
                if player == "ai":
                    move_card(
                        state,
                        eligible_targets[0]["instance_id"],
                        player,
                        "hand",
                    )
                    check_win_by_exodia(state, player)
                    continue
                state["pending_decision"] = {
                    "type": "select_graveyard_card",
                    "player": player,
                    "source_instance_id": source[3]["instance_id"],
                    "effect_card_id": card_id,
                    "count": 1,
                    "target_mode": "grave-own-any",
                    "eligible_target_instance_ids": [
                        card["instance_id"] for card in eligible_targets
                    ],
                }
                return
            if card_id == CHAOS_LEVIANEER_ID:
                if trigger.get("player") in {"player", "ai"}:
                    self._resolve_levianeer_trigger(state, trigger)
                continue
            if (
                card_id == "m-the-white-stone-of-ancients"
                and trigger.get("player") in {"player", "ai"}
            ):
                source = find_card(state, trigger.get("source_instance_id"))
                player = trigger["player"]
                usage_key = f"{player}:m-the-white-stone-of-ancients"
                if (
                    not source
                    or source[0] != player
                    or source[1] != "graveyard"
                    or source[3].get("card_id") != card_id
                    or state.get("effect_uses", {}).get(usage_key) == state["turn"]
                    or not any(
                        card is None
                        for card in state["players"][player]["monster_zone"]
                    )
                ):
                    continue
                eligible_targets = [
                    card
                    for zone in ("deck", "hand")
                    for card in state["players"][player][zone]
                    if card.get("card_id") == "m-blue-eyes-white-dragon"
                    and _can_be_special_summoned(card)
                ]
                if not eligible_targets:
                    continue
                if player == "ai":
                    target = eligible_targets[0]
                    target_zone = find_card(state, target["instance_id"])[1]
                    state.setdefault("effect_uses", {})[usage_key] = state["turn"]
                    _special_summon(state, player, target["instance_id"])
                    if target_zone == "deck":
                        random.shuffle(state["players"][player]["deck"])
                    continue
                state["pending_decision"] = {
                    "type": "select_deck_card",
                    "player": player,
                    "source_instance_id": source[3]["instance_id"],
                    "effect_card_id": card_id,
                    "min_count": 0,
                    "max_count": 1,
                    "target_mode": "deck-or-hand-blue-eyes-summon",
                    "eligible_target_instance_ids": [
                        card["instance_id"] for card in eligible_targets
                    ],
                    "eligible_cards": [
                        {
                            "instance_id": card["instance_id"],
                            "card_id": card["card_id"],
                            "name": card.get("name", card["card_id"]),
                            "zone": next(
                                zone
                                for zone in ("deck", "hand")
                                if card in state["players"][player][zone]
                            ),
                        }
                        for card in eligible_targets
                    ],
                }
                return
            if card_id == "m-palladium-oracle-mana":
                player = trigger.get("player")
                if player not in {"player", "ai"}:
                    continue
                source = find_card(state, trigger.get("source_instance_id"))
                if (
                    not source
                    or source[0] != player
                    or source[1] not in {"graveyard", "banished"}
                    or source[3].get("card_id") != card_id
                    or not any(
                        card is None
                        for card in state["players"][player]["monster_zone"]
                    )
                ):
                    continue
                eligible_targets = [
                    (zone, card)
                    for zone in ("hand", "deck", "graveyard")
                    for card in state["players"][player][zone]
                    if card.get("card_id") == "m-dark-magician-girl"
                    and card.get("category") == "monster"
                    and _can_be_special_summoned(card)
                ]
                if not eligible_targets:
                    continue
                if player == "ai":
                    target_zone, target = eligible_targets[0]
                    if _special_summon(state, player, target["instance_id"]):
                        summoned = find_card(state, target["instance_id"])
                        if summoned:
                            summoned[3]["cannot_be_destroyed_by_battle"] = True
                        if target_zone == "deck":
                            random.shuffle(state["players"][player]["deck"])
                    continue
                state["pending_decision"] = {
                    "type": "select_deck_card",
                    "player": player,
                    "source_instance_id": source[3]["instance_id"],
                    "effect_card_id": card_id,
                    "min_count": 0,
                    "max_count": 1,
                    "target_mode": "mana-dark-magician-girl-summon",
                    "eligible_target_instance_ids": [
                        target["instance_id"] for _, target in eligible_targets
                    ],
                    "eligible_cards": [
                        {
                            "instance_id": target["instance_id"],
                            "card_id": target["card_id"],
                            "name": target.get("name", target["card_id"]),
                            "zone": zone,
                        }
                        for zone, target in eligible_targets
                    ],
                }
                return
            if (
                card_id not in {"m-magicat", "m-archfiend-of-gilfer"}
                or trigger.get("player") not in {"player", "ai"}
            ):
                continue
            source = find_card(state, trigger.get("source_instance_id"))
            if (
                not source
                or source[0] != trigger["player"]
                or source[1] != "graveyard"
                or source[3].get("card_id") != card_id
            ):
                continue
            if card_id == "m-magicat":
                eligible_spells = [
                    card
                    for card in reversed(state["players"][trigger["player"]]["deck"])
                    if card.get("category") == "spell"
                ]
                if not eligible_spells:
                    continue
                if trigger["player"] == "ai":
                    move_card(
                        state,
                        eligible_spells[0]["instance_id"],
                        trigger["player"],
                        "hand",
                    )
                    continue
                state["pending_decision"] = {
                    "type": "select_deck_card",
                    "player": trigger["player"],
                    "source_instance_id": source[3]["instance_id"],
                    "effect_card_id": card_id,
                    "min_count": 0,
                    "max_count": 1,
                    "target_mode": "deck-own-spell",
                    "eligible_target_instance_ids": [
                        card["instance_id"] for card in eligible_spells
                    ],
                    "eligible_cards": [
                        {
                            "instance_id": card["instance_id"],
                            "card_id": card["card_id"],
                            "name": card.get("name", card["card_id"]),
                        }
                        for card in eligible_spells
                    ],
                }
                return

            eligible_targets = [
                card
                for card in state["players"][opponent_of(trigger["player"])]["monster_zone"]
                if card
                and card.get("category") in {"monster", "fusion"}
                and not card.get("face_down", False)
            ]
            if not eligible_targets:
                continue
            target = random.choice(eligible_targets)
            updated = add_stat_modifier(
                state,
                target_instance_id=target["instance_id"],
                source_instance_id=source[3]["instance_id"],
                source_card_id=card_id,
                owner=trigger["player"],
                stat="atk",
                operation="decrease",
                value=500,
                duration={"type": "target_leaves_field"},
            )
            state["stat_modifiers"] = updated["stat_modifiers"]

    def _resolve_levianeer_trigger(
        self, state: dict[str, Any], trigger: Mapping[str, Any]
    ) -> None:
        player = trigger["player"]
        attributes = trigger.get("attributes")
        if (
            not isinstance(attributes, list)
            or len(attributes) != 2
            or any(attribute not in {"LIGHT", "DARK"} for attribute in attributes)
        ):
            return
        selected_attributes = set(attributes)
        if selected_attributes == {"LIGHT"}:
            eligible_targets = [
                card
                for card in state["players"][player]["graveyard"]
                if card.get("category") in {"monster", "fusion"}
                and _can_be_special_summoned(card)
            ]
            if not eligible_targets or not any(
                field_card is None
                for field_card in state["players"][player]["monster_zone"]
            ):
                return
            if player == "ai":
                _special_summon(
                    state,
                    player,
                    eligible_targets[0]["instance_id"],
                    position="defense",
                    allow_fusion=True,
                )
                return
            state["pending_decision"] = {
                "type": "select_graveyard_card",
                "player": player,
                "source_instance_id": trigger.get("source_instance_id"),
                "effect_card_id": CHAOS_LEVIANEER_ID,
                "count": 1,
                "target_mode": "grave-monster",
                "eligible_target_instance_ids": [
                    card["instance_id"] for card in eligible_targets
                ],
            }
            return

        if selected_attributes == {"DARK"}:
            opponent = opponent_of(player)
            opponent_hand = state["players"][opponent]["hand"]
            if opponent_hand:
                target = random.choice(opponent_hand)
                move_card(state, target["instance_id"], opponent, "deck")
                random.shuffle(state["players"][opponent]["deck"])
            return

        field_cards = [
            card
            for side in ("player", "ai")
            for zone in ("monster_zone", "spell_trap_zone")
            for card in state["players"][side][zone]
            if card
        ]
        if not field_cards:
            return
        if player == "ai":
            opponent = opponent_of(player)
            targets = [
                card["instance_id"]
                for side in (opponent, player)
                for zone in ("monster_zone", "spell_trap_zone")
                for card in state["players"][side][zone]
                if card
            ][:2]
            for target_id in targets:
                destroy_card(state, target_id, by_player=player)
            return
        state["pending_decision"] = {
            "type": "select_field_cards",
            "player": player,
            "source_instance_id": trigger.get("source_instance_id"),
            "effect_card_id": CHAOS_LEVIANEER_ID,
            "min_count": 0,
            "max_count": 2,
            "target_mode": "field-card-any",
            "eligible_target_instance_ids": [
                card["instance_id"] for card in field_cards
            ],
        }

    def _draw(self, state: dict[str, Any], player: str) -> None:
        self._require_turn(state, player)
        if state.get("phase") != "draw":
            raise DuelRuleError("Chỉ được rút bài trong Draw Phase.")
        if state.get("drawn_this_turn"):
            raise DuelRuleError("Người chơi đã rút bài trong lượt này.")
        if state["turn"] == 1 and state["first_player"] == player:
            raise DuelRuleError("Người đi trước không rút bài ở lượt đầu tiên.")
        next_state, drawn = draw_cards(state, player, 1)
        state.clear()
        state.update(next_state)
        state["drawn_this_turn"] = True
        apply_draw_triggers(state, player, len(drawn))

    def _advance_phase(self, state: dict[str, Any], player: str) -> None:
        self._require_turn(state, player)
        if state.get("chain", {}).get("status") != "closed":
            raise DuelRuleError("Không thể chuyển Phase khi Chain chưa đóng.")
        phase = state["phase"]
        if phase == "draw":
            if not (state["turn"] == 1 and state["first_player"] == player):
                if not state.get("drawn_this_turn"):
                    self._draw(state, player)
                    if state.get("over"):
                        return
            state["phase"] = "standby"
            resolve_standby_effects(state, player)
            return
        if phase == "end":
            if len(state["players"][player]["hand"]) > MAX_HAND_SIZE:
                raise DuelRuleError("Bỏ bài để kết thúc lượt với tối đa 6 lá trên tay.")
            self._end_turn(state, player)
            return
        if (
            phase == "main1"
            and state["turn"] == 1
            and state["first_player"] == player
        ):
            state["phase"] = "main2"
            return
        try:
            state["phase"] = PHASES[PHASES.index(phase) + 1]
        except (ValueError, IndexError) as error:
            raise DuelRuleError("Không thể chuyển Phase hiện tại.") from error

    def _end_turn(self, state: dict[str, Any], player: str) -> None:
        ending_turn = state["turn"]
        state["_ai_turn_stages"] = []
        before_end_phase = self._ai_stage_snapshot(state)
        resolve_end_phase_effects(state, player)
        state["stat_modifiers"] = expire_effects(
            state,
            "phase_end",
            player=player,
            turn=ending_turn,
            phase="end",
        )["stat_modifiers"]
        state["stat_modifiers"] = expire_effects(
            state,
            "turn_end",
            player=player,
            turn=ending_turn,
        )["stat_modifiers"]
        if self._ai_stage_state_changed(before_end_phase, state):
            self._record_ai_turn_stage(state, "end")
        self._run_ai_turn(state)
















    @staticmethod
    def _draw_player_turn_card(state: dict[str, Any]) -> None:
        next_state, drawn = draw_cards(state, "player", 1)
        state.clear()
        state.update(next_state)
        state["drawn_this_turn"] = True
        apply_draw_triggers(state, "player", len(drawn))







    def _begin_tricky_summon(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != "m-the-tricky"
        ):
            raise DuelRuleError("Chỉ có thể kích hoạt hiệu ứng của Tricky trên tay.")
        if not any(
            card is None for card in state["players"][player]["monster_zone"]
        ):
            raise DuelRuleError("Không còn ô Quái thú trống để Triệu hồi Tricky.")
        if len(state["players"][player]["hand"]) < 2:
            raise DuelRuleError("Cần một lá bài khác trên tay để bỏ làm chi phí.")

        # Tricky: chọn bỏ một lá khác trên tay trước khi Triệu hồi Đặc biệt.
        state["pending_decision"] = {
            "type": "tricky_discard",
            "player": player,
            "count": 1,
            "source_instance_id": source_id,
        }

    def _begin_spell_recovery(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("category") != "spell"
            or source[3].get("card_id") not in SPELL_RECOVERY_RULES
        ):
            raise DuelRuleError("Chỉ có thể kích hoạt hiệu ứng thu hồi từ tay.")
        effect_card_id = source[3]["card_id"]
        rule = SPELL_RECOVERY_RULES[effect_card_id]
        cost_cards = [
            card
            for card in state["players"][player]["hand"]
            if card["instance_id"] != source_id
            and (
                not rule["discard_category"]
                or card.get("category") == rule["discard_category"]
            )
        ]
        if len(cost_cards) < 2:
            if effect_card_id == "s-spell-reproduction":
                raise DuelRuleError("Cần 2 Lá Phép khác trên tay để kích hoạt Sao Chép Ma Thuật.")
            raise DuelRuleError("Cần 2 lá bài khác trên tay để kích hoạt Đá Ma Thuật Phát Sáng.")

        eligible_target_ids = [
            card["instance_id"]
            for card in state["players"][player]["graveyard"]
            if not rule["target_category"]
            or card.get("category") == rule["target_category"]
        ]
        if not eligible_target_ids:
            if effect_card_id == "s-spell-reproduction":
                raise DuelRuleError("Cần có sẵn một Lá Phép hợp lệ trong Mộ trước khi kích hoạt.")
            raise DuelRuleError("Cần có sẵn một lá bài trong Mộ trước khi kích hoạt.")

        state["pending_decision"] = {
            "type": "spell_recovery_discard",
            "player": player,
            "count": 2,
            "source_instance_id": source_id,
            "effect_card_id": effect_card_id,
            "discard_category": rule["discard_category"],
            "eligible_target_instance_ids": eligible_target_ids,
        }

    # Hoàng Đế Raider: tự Triệu hồi Đặc biệt từ tay khi bạn không điều khiển quái thú.
    def _special_summon_kaiser_vorse(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("category") != "monster"
            or source[3].get("card_id") != "m-kaiser-vorse-raider"
        ):
            raise DuelRuleError("Hoàng Đế Raider phải ở trên tay để tự Triệu hồi Đặc biệt.")
        if any(state["players"][player]["monster_zone"]):
            raise DuelRuleError("Chỉ được tự Triệu hồi Hoàng Đế Raider khi bạn không điều khiển quái thú.")
        if not _special_summon(state, player, source_id):
            raise DuelRuleError("Không thể Triệu hồi Đặc biệt Hoàng Đế Raider lúc này.")

    # Người Đá Dung Nham: Hiến tế hai quái thú đối thủ để Triệu hồi lên sân họ.
    def _special_summon_lava_golem(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        tribute_ids = action.get("tribute_instance_ids")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != "m-lava-golem"
        ):
            raise DuelRuleError("Người Đá Dung Nham phải ở trên tay để Triệu hồi Đặc biệt.")
        if (
            not isinstance(tribute_ids, list)
            or len(tribute_ids) != 2
            or any(not isinstance(instance_id, str) or not instance_id for instance_id in tribute_ids)
            or len(set(tribute_ids)) != 2
        ):
            raise DuelRuleError("Người Đá Dung Nham cần chọn đúng hai quái thú đối thủ để Hiến tế.")

        opponent = opponent_of(player)
        tributes = [find_card(state, instance_id) for instance_id in tribute_ids]
        if any(
            not tribute
            or tribute[0] != opponent
            or tribute[1] != "monster_zone"
            or tribute[3].get("category") not in {"monster", "fusion"}
            for tribute in tributes
        ):
            raise DuelRuleError("Chỉ được Hiến tế hai quái thú đang do đối thủ điều khiển.")

        for tribute in sorted(tributes, key=lambda item: item[2], reverse=True):
            move_card(state, tribute[3]["instance_id"], opponent, "graveyard")
        destination_index = next(
            index
            for index, card in enumerate(state["players"][opponent]["monster_zone"])
            if card is None
        )
        summoned = move_card(
            state,
            source_id,
            opponent,
            "monster_zone",
            destination_index=destination_index,
        )
        summoned["face_down"] = False
        summoned["position"] = self._summon_position(state, summoned, "attack")
        summoned["summon_method"] = "special"
        summoned["summoned_turn"] = state["turn"]
        state["normal_summon_used"][player] = True
        self._apply_slifer_summon_effect(state, opponent, summoned)
        if find_card(state, source_id):
            resolve_monster_summon_effects(state, opponent, source_id, "special")

    # Rồng Trắng Mắt Xanh Thay Thế: tiết lộ Rồng Trắng Mắt Xanh trên tay để tự Triệu hồi.
    def _special_summon_blue_eyes_alternative(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        usage_key = f"{player}:m-blue-eyes-alternative-white-dragon:summon"
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != "m-blue-eyes-alternative-white-dragon"
        ):
            raise DuelRuleError("Rồng Trắng Mắt Xanh Thay Thế phải ở trên tay.")
        if state.get("effect_uses", {}).get(usage_key) == state["turn"]:
            raise DuelRuleError("Đã dùng cách Triệu hồi này trong lượt hiện tại.")
        if not any(
            card.get("card_id") == "m-blue-eyes-white-dragon"
            for card in state["players"][player]["hand"]
            if card["instance_id"] != source_id
        ):
            raise DuelRuleError("Cần tiết lộ Rồng Trắng Mắt Xanh khác trên tay.")
        if not _special_summon(state, player, source_id):
            raise DuelRuleError("Không thể Triệu hồi Đặc biệt lá bài này lúc này.")
        state.setdefault("effect_uses", {})[usage_key] = state["turn"]

    def _special_summon_black_luster_soldier(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        tribute_ids = action.get("tribute_instance_ids")
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != "m-black-luster-soldier-envoy-of-the-beginning"
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Chiến Binh Giáp Đen phải ở trên tay.")
        if not isinstance(tribute_ids, list) or len(tribute_ids) != 2:
            raise DuelRuleError("Cần loại bỏ đúng 1 quái thú ÁNH SÁNG và 1 quái thú BÓNG TỐI.")
        if len(set(tribute_ids)) != 2:
            raise DuelRuleError("Không thể loại bỏ trùng một quái thú làm chi phí.")

        materials = []
        attributes = []
        graveyard = state["players"][player]["graveyard"]
        for instance_id in tribute_ids:
            if not isinstance(instance_id, str):
                raise DuelRuleError("Mục tiêu chi phí không hợp lệ.")
            found = next(
                (
                    card
                    for card in graveyard
                    if card.get("instance_id") == instance_id
                    and card.get("category") in {"monster", "fusion"}
                ),
                None,
            )
            if not found:
                raise DuelRuleError("Chi phí phải là quái thú trong Mộ của bạn.")
            materials.append(found)
            attributes.append(str(found.get("attribute") or "").upper())

        if set(attributes) != {"LIGHT", "DARK"}:
            raise DuelRuleError("Cần loại bỏ đúng 1 quái thú LIGHT và 1 quái thú DARK.")
        if not any(
            card is None for card in state["players"][player]["monster_zone"]
        ):
            raise DuelRuleError("Không còn ô Quái thú trống để Triệu hồi Chiến Binh Giáp Đen.")

        was_properly_summoned = source[3].get("properly_summoned")
        for material in materials:
            move_card(state, material["instance_id"], player, "banished")
        source[3]["properly_summoned"] = True
        if not _special_summon(state, player, source_id):
            if was_properly_summoned is None:
                source[3].pop("properly_summoned", None)
            else:
                source[3]["properly_summoned"] = was_properly_summoned
            raise DuelRuleError("Không thể Triệu hồi Đặc biệt Chiến Binh Giáp Đen lúc này.")
        if find_card(state, source_id):
            resolve_monster_summon_effects(state, player, source_id, "special")

    def _special_summon_chaos_emperor(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != CHAOS_EMPEROR_ID
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Chúa Rồng Hùng Mạnh phải ở trên tay.")
        materials = self._validate_chaos_emperor_materials(
            state,
            player,
            action.get("tribute_instance_ids"),
        )
        if not any(
            card is None for card in state["players"][player]["monster_zone"]
        ):
            raise DuelRuleError("Không còn ô Quái thú trống để Triệu hồi Chúa Rồng Hùng Mạnh.")
        was_properly_summoned = source[3].get("properly_summoned")
        for material in materials:
            move_card(state, material[3]["instance_id"], player, "banished")
        source[3]["properly_summoned"] = True
        if not _special_summon(state, player, source_id):
            if was_properly_summoned is None:
                source[3].pop("properly_summoned", None)
            else:
                source[3]["properly_summoned"] = was_properly_summoned
            raise DuelRuleError("Không thể Triệu hồi Đặc biệt Chúa Rồng Hùng Mạnh lúc này.")
        if find_card(state, source_id):
            resolve_monster_summon_effects(state, player, source_id, "special")

    def _special_summon_levianeer(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != CHAOS_LEVIANEER_ID
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Rồng Hỗn Mang Levianeer phải ở trên tay.")
        materials = self._validate_levianeer_materials(
            state,
            player,
            action.get("tribute_instance_ids"),
        )
        zone_index = next(
            (
                index
                for index, card in enumerate(state["players"][player]["monster_zone"])
                if card is None
            ),
            None,
        )
        if zone_index is None:
            raise DuelRuleError("Không còn ô Quái thú trống để Triệu hồi Levianeer.")
        attributes = [
            str(material[3].get("attribute") or "").upper()
            for material in materials
        ]
        was_properly_summoned = source[3].get("properly_summoned")
        for material in materials:
            move_card(state, material[3]["instance_id"], player, "banished")
        source[3]["properly_summoned"] = True
        source[3]["levianeer_summon_attributes"] = attributes
        if not _special_summon(state, player, source_id):
            if was_properly_summoned is None:
                source[3].pop("properly_summoned", None)
            else:
                source[3]["properly_summoned"] = was_properly_summoned
            source[3].pop("levianeer_summon_attributes", None)
            raise DuelRuleError("Không thể Triệu hồi Đặc biệt Levianeer lúc này.")

    @staticmethod
    def _validate_levianeer_materials(
        state: Mapping[str, Any],
        player: str,
        instance_ids: Any,
    ) -> list[tuple[str, str, int, dict[str, Any]]]:
        if (
            not isinstance(instance_ids, list)
            or len(instance_ids) != 2
            or any(not isinstance(instance_id, str) or not instance_id for instance_id in instance_ids)
            or len(set(instance_ids)) != 2
        ):
            raise DuelRuleError("Cần chọn đúng hai quái thú ÁNH SÁNG và/hoặc BÓNG TỐI trong Mộ.")
        materials = [find_card(state, instance_id) for instance_id in instance_ids]
        if any(
            not material
            or material[0] != player
            or material[1] != "graveyard"
            or material[3].get("category") not in {"monster", "fusion"}
            or str(material[3].get("attribute") or "").upper() not in {"LIGHT", "DARK"}
            for material in materials
        ):
            raise DuelRuleError("Chỉ được loại bỏ quái thú ÁNH SÁNG hoặc BÓNG TỐI trong Mộ của bạn.")
        return materials

    @staticmethod
    def _validate_chaos_emperor_materials(
        state: Mapping[str, Any],
        player: str,
        instance_ids: Any,
    ) -> list[tuple[str, str, int, dict[str, Any]]]:
        if (
            not isinstance(instance_ids, list)
            or len(instance_ids) != 2
            or any(not isinstance(instance_id, str) or not instance_id for instance_id in instance_ids)
            or len(set(instance_ids)) != 2
        ):
            raise DuelRuleError("Cần chọn đúng một quái thú ÁNH SÁNG và một quái thú BÓNG TỐI trong Mộ.")
        materials = [find_card(state, instance_id) for instance_id in instance_ids]
        attributes = {
            str(material[3].get("attribute") or "").upper()
            for material in materials
            if material
        }
        if (
            any(
                not material
                or material[0] != player
                or material[1] != "graveyard"
                or material[3].get("category") not in {"monster", "fusion"}
                for material in materials
            )
            or attributes != {"LIGHT", "DARK"}
        ):
            raise DuelRuleError("Chỉ được loại bỏ một quái thú ÁNH SÁNG và một quái thú BÓNG TỐI trong Mộ của bạn.")
        return materials

    def _special_summon_valkyrion(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != VALKYRION_ID
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Chiến Binh Kim Loại phải ở trên tay để Triệu hồi Đặc biệt.")

        materials = self._validate_valkyrion_materials(
            state,
            player,
            action.get("tribute_instance_ids"),
            frozenset({"hand", "monster_zone"}),
        )
        field_tributes = {
            material[2] for material in materials if material[1] == "monster_zone"
        }
        zone_index = next(
            (
                index
                for index, card in enumerate(state["players"][player]["monster_zone"])
                if card is None or index in field_tributes
            ),
            None,
        )
        if zone_index is None:
            raise DuelRuleError("Không còn chỗ để Triệu hồi Chiến Binh Kim Loại.")

        for material in materials:
            move_card(state, material[3]["instance_id"], player, "graveyard")
        summoned = move_card(
            state,
            source_id,
            player,
            "monster_zone",
            destination_index=zone_index,
        )
        summoned["face_down"] = False
        summoned["position"] = self._summon_position(state, summoned, "attack")
        summoned["summon_method"] = "special"
        summoned["summoned_turn"] = state["turn"]
        summoned["properly_summoned"] = True
        self._apply_slifer_summon_effect(state, player, summoned)
        if find_card(state, source_id):
            resolve_monster_summon_effects(state, player, source_id, "special")

    def _split_valkyrion(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        source_id = action.get("source_instance_id")
        source = find_card(state, source_id) if isinstance(source_id, str) else None
        if (
            not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != VALKYRION_ID
            or source[3].get("category") != "monster"
            or source[3].get("face_down", False)
        ):
            raise DuelRuleError("Chiến Binh Kim Loại phải ngửa trên sân để tách hợp thể.")

        materials = self._validate_valkyrion_materials(
            state,
            player,
            action.get("material_instance_ids"),
            frozenset({"graveyard"}),
        )
        free_zones = sum(
            1
            for card in state["players"][player]["monster_zone"]
            if card is None
        )
        if free_zones + 1 < len(VALKYRION_MATERIAL_IDS):
            raise DuelRuleError("Cần ba ô quái thú trống sau khi Hiến tế Chiến Binh Kim Loại.")

        move_card(state, source_id, player, "graveyard")
        for material_id in VALKYRION_MATERIAL_IDS:
            material = next(
                item for item in materials if item[3].get("card_id") == material_id
            )
            zone_index = next(
                index
                for index, card in enumerate(state["players"][player]["monster_zone"])
                if card is None
            )
            summoned = move_card(
                state,
                material[3]["instance_id"],
                player,
                "monster_zone",
                destination_index=zone_index,
            )
            summoned["face_down"] = False
            summoned["position"] = self._summon_position(state, summoned, "attack")
            summoned["summon_method"] = "special"
            summoned["summoned_turn"] = state["turn"]
            self._apply_slifer_summon_effect(state, player, summoned)
            if find_card(state, material[3]["instance_id"]):
                resolve_monster_summon_effects(
                    state,
                    player,
                    material[3]["instance_id"],
                    "special",
                )

    @staticmethod
    def _validate_valkyrion_materials(
        state: Mapping[str, Any],
        player: str,
        instance_ids: Any,
        zones: frozenset[str],
    ) -> list[tuple[str, str, int, dict[str, Any]]]:
        if (
            not isinstance(instance_ids, list)
            or len(instance_ids) != len(VALKYRION_MATERIAL_IDS)
            or any(not isinstance(instance_id, str) or not instance_id for instance_id in instance_ids)
            or len(set(instance_ids)) != len(VALKYRION_MATERIAL_IDS)
        ):
            raise DuelRuleError("Cần chọn đúng một Alpha, một Beta và một Gamma.")

        materials = [find_card(state, instance_id) for instance_id in instance_ids]
        if any(
            not material
            or material[0] != player
            or material[1] not in zones
            or material[3].get("category") != "monster"
            or (
                material[1] == "monster_zone"
                and material[3].get("face_down", False)
            )
            for material in materials
        ) or {
            material[3].get("card_id") for material in materials if material
        } != set(VALKYRION_MATERIAL_IDS):
            raise DuelRuleError("Vật Hiến tế phải là Alpha, Beta và Gamma ở đúng khu vực.")
        return materials

    def _summon(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        instance_id = action.get("instance_id")
        zone_index = action.get("zone_index")
        position = action.get("position", "attack")
        tribute_ids = action.get("tribute_instance_ids", [])
        if (
            not isinstance(instance_id, str)
            or not isinstance(zone_index, int)
            or isinstance(zone_index, bool)
            or not 0 <= zone_index < 5
            or not isinstance(position, str)
            or position not in {"attack", "defense"}
            or not isinstance(tribute_ids, list)
            or any(not isinstance(item, str) or not item for item in tribute_ids)
            or len(set(tribute_ids)) != len(tribute_ids)
        ):
            raise DuelRuleError("Dữ liệu Triệu hồi không hợp lệ.")
        source = find_card(state, instance_id)
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("category") != "monster"
        ):
            raise DuelRuleError("Chỉ có thể Triệu hồi quái thú trên tay của mình.")
        monster = source[3]
        card_id = monster.get("card_id")
        if monster.get("category") == "fusion":
            raise DuelRuleError("Triệu hồi Dung Hợp hiện chưa được hỗ trợ.")
        if card_id == VALKYRION_ID:
            raise DuelRuleError("Chiến Binh Kim Loại không thể được Triệu hồi Thường.")
        if card_id == "m-blue-eyes-alternative-white-dragon":
            raise DuelRuleError("Lá bài này không thể được Triệu hồi Thường hoặc Úp.")
        if card_id == CHAOS_EMPEROR_ID:
            raise DuelRuleError("Chúa Rồng Hùng Mạnh không thể được Triệu hồi Thường.")
        if card_id == CHAOS_LEVIANEER_ID:
            raise DuelRuleError("Rồng Hỗn Mang Levianeer không thể được Triệu hồi Thường.")
        is_horakhty = card_id == HORAKHTY_ID
        if is_horakhty and position != "attack":
            raise DuelRuleError("Horakhty phải được Triệu hồi ngửa.")
        if not is_horakhty and state["normal_summon_used"][player]:
            raise DuelRuleError("Đã Normal Summon hoặc Tribute Summon trong lượt này.")

        tributes = self._validate_tributes(state, player, tribute_ids)
        required = self._required_tributes(monster)
        if is_horakhty:
            tribute_card_ids = {item[3]["card_id"] for item in tributes}
            if (
                len(tributes) != 3
                or tribute_card_ids != GOD_CARD_IDS
                or any(item[3].get("face_down", False) for item in tributes)
            ):
                raise DuelRuleError("Horakhty cần hiến tế ngửa đúng Slifer, Obelisk và Ra.")
        elif sum(
            self._tribute_value(tribute[3], monster, required)
            for tribute in tributes
        ) != required:
            raise DuelRuleError(
                f"Quái thú này cần đúng {required} vật hiến tế."
            )
        if not is_horakhty and len(tributes) == 0 and required:
            raise DuelRuleError("Thiếu quái thú làm vật hiến tế.")
        if not is_horakhty and not required and tributes:
            raise DuelRuleError("Quái thú này không cần vật hiến tế.")
        occupied_zone_indexes = {
            tribute[2] for tribute in tributes
        }
        if (
            state["players"][player]["monster_zone"][zone_index] is not None
            and zone_index not in occupied_zone_indexes
        ):
            raise DuelRuleError("Ô Monster Zone đã có bài.")

        ra_stats = (
            {
                stat: sum(
                    current_stats(state, tribute[3]["instance_id"])[stat]
                    for tribute in tributes
                )
                for stat in ("atk", "def")
            }
            if card_id == "m-the-winged-dragon-of-ra"
            else None
        )
        for tribute in sorted(tributes, key=lambda item: item[2], reverse=True):
            move_card(
                state,
                tribute[3]["instance_id"],
                tribute[0],
                "graveyard",
            )
        summoned = move_card(
            state,
            instance_id,
            player,
            "monster_zone",
            destination_index=zone_index,
        )
        summoned["face_down"] = False
        summoned["position"] = self._summon_position(state, summoned, position)
        summoned["summon_method"] = "special" if is_horakhty else (
            "tribute" if tributes else "normal"
        )
        summoned["summoned_turn"] = state["turn"]
        if ra_stats:
            summoned["base_atk"] = ra_stats["atk"]
            summoned["base_def"] = ra_stats["def"]
            summoned["atk"] = ra_stats["atk"]
            summoned["def"] = ra_stats["def"]

        if is_horakhty:
            state["over"] = True
            state["winner"] = player
            return
        state["normal_summon_used"][player] = True
        self._apply_slifer_summon_effect(state, player, summoned)
        if find_card(state, instance_id):
            resolve_monster_summon_effects(
                state,
                player,
                instance_id,
                summoned["summon_method"],
            )

    def _set_card(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        instance_id = action.get("instance_id")
        zone_index = action.get("zone_index")
        if (
            not isinstance(instance_id, str)
            or not isinstance(zone_index, int)
            or isinstance(zone_index, bool)
            or not 0 <= zone_index < 5
        ):
            raise DuelRuleError("Dữ liệu đặt bài không hợp lệ.")
        source = find_card(state, instance_id)
        if not source or source[0] != player or source[1] != "hand":
            raise DuelRuleError("Chỉ có thể đặt bài từ trên tay của mình.")
        card = source[3]
        if card.get("category") == "monster":
            if card.get("card_id") == VALKYRION_ID:
                raise DuelRuleError("Chiến Binh Kim Loại không thể được Úp Thường.")
            if card.get("card_id") == "m-blue-eyes-alternative-white-dragon":
                raise DuelRuleError("Lá bài này không thể được Triệu hồi Thường hoặc Úp.")
            if card.get("card_id") == CHAOS_EMPEROR_ID:
                raise DuelRuleError("Chúa Rồng Hùng Mạnh không thể được Triệu hồi Thường hoặc Úp.")
            if card.get("card_id") == CHAOS_LEVIANEER_ID:
                raise DuelRuleError("Rồng Hỗn Mang Levianeer không thể được Triệu hồi Thường hoặc Úp.")
            if state["normal_summon_used"][player]:
                raise DuelRuleError("Đã Normal Summon hoặc Tribute Summon trong lượt này.")
            if card.get("card_id") in GOD_CARD_IDS | {HORAKHTY_ID}:
                raise DuelRuleError("Các lá Thần không thể được Úp Thường.")
            tribute_ids = action.get("tribute_instance_ids", [])
            if (
                not isinstance(tribute_ids, list)
                or any(not isinstance(item, str) or not item for item in tribute_ids)
                or len(set(tribute_ids)) != len(tribute_ids)
            ):
                raise DuelRuleError("Danh sách vật hiến tế không hợp lệ.")
            tributes = self._validate_tributes(state, player, tribute_ids)
            required = self._required_tributes(card)
            if len(tributes) != required:
                raise DuelRuleError(f"Quái thú này cần đúng {required} vật hiến tế.")
            occupied_zone_indexes = {tribute[2] for tribute in tributes}
            if (
                state["players"][player]["monster_zone"][zone_index] is not None
                and zone_index not in occupied_zone_indexes
            ):
                raise DuelRuleError("Ô Monster Zone đã có bài.")
            for tribute in sorted(tributes, key=lambda item: item[2], reverse=True):
                move_card(state, tribute[3]["instance_id"], player, "graveyard")
            moved = move_card(
                state,
                instance_id,
                player,
                "monster_zone",
                destination_index=zone_index,
            )
            swords_active = any(
                spell
                and spell.get("card_id") == "s-swords-of-revealing-light"
                and not spell.get("face_down", False)
                for spell in state["players"][opponent_of(player)][
                    "spell_trap_zone"
                ]
            )
            moved["face_down"] = not swords_active
            moved["position"] = "defense"
            moved["set_turn"] = state["turn"]
            moved["summon_method"] = "tribute" if tributes else "normal"
            state["normal_summon_used"][player] = True
            return
        is_quick_spell = (
            card.get("category") == "spell"
            and (
                card.get("card_id") in QUICK_SPELL_IDS
                or card.get("spellType") == "Tức Thời"
                or card.get("spell_type") == "Tức Thời"
            )
        )
        if card.get("category") != "trap" and not is_quick_spell:
            raise DuelRuleError("Chỉ có thể Úp Bẫy hoặc Phép Tức Thời từ trên tay.")
        if state["players"][player]["spell_trap_zone"][zone_index] is not None:
            raise DuelRuleError("Ô Spell/Trap Zone đã có bài.")
        moved = move_card(
            state,
            instance_id,
            player,
            "spell_trap_zone",
            destination_index=zone_index,
        )
        moved["face_down"] = True
        moved["set_turn"] = state["turn"]

    def _flip_summon(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        instance_id = action.get("instance_id")
        found = find_card(state, instance_id) if isinstance(instance_id, str) else None
        if (
            not found
            or found[0] != player
            or found[1] != "monster_zone"
            or not found[3].get("face_down", False)
            or found[3].get("set_turn") == state["turn"]
        ):
            raise DuelRuleError("Quái thú này chưa thể Flip Summon.")
        monster = found[3]
        monster["face_down"] = False
        monster["position"] = self._summon_position(state, monster, "attack")
        monster["flip_summoned_turn"] = state["turn"]
        self._apply_slifer_summon_effect(state, player, monster)
        if find_card(state, instance_id):
            resolve_monster_summon_effects(state, player, instance_id, "flip")

    def _change_position(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_main_phase(state, player)
        instance_id = action.get("instance_id")
        found = find_card(state, instance_id) if isinstance(instance_id, str) else None
        if (
            not found
            or found[0] != player
            or found[1] != "monster_zone"
            or found[3].get("face_down", False)
            or (
                found[3].get("summoned_turn") == state["turn"]
                and not found[3].get("allow_position_change_on_summon_turn", False)
            )
            or found[3].get("flip_summoned_turn") == state["turn"]
            or found[3].get("position_changed_turn") == state["turn"]
            or instance_id in state.get("attacked", {}).get(player, [])
            or not can_change_battle_position(state, player, instance_id)
        ):
            raise DuelRuleError("Quái thú này hiện không thể đổi tư thế.")
        monster = found[3]
        monster["position"] = (
            "defense" if found[3].get("position") == "attack" else "attack"
        )
        monster["position_changed_turn"] = state["turn"]

    @staticmethod
    def _apply_slifer_summon_effect(
        state: dict[str, Any], summoned_player: str, monster: Mapping[str, Any]
    ) -> None:
        if monster.get("face_down", False):
            return
        instance_id = monster.get("instance_id")
        if isinstance(instance_id, str) and instance_id:
            apply_slifer_thunderforce(state, summoned_player, instance_id)

    @staticmethod
    def _summon_position(
        state: Mapping[str, Any], monster: Mapping[str, Any], requested: str
    ) -> str:
        race = str(monster.get("race") or monster.get("monsterType") or "").lower()
        is_dragon = "dragon" in race or "rồng" in race
        jar_active = any(
            card
            and card.get("card_id") == "t-dragon-capture-jar"
            and not card.get("face_down", False)
            and not trap_effect_is_negated(state, owner)
            for owner in ("player", "ai")
            for card in state["players"][owner]["spell_trap_zone"]
        )
        return "defense" if is_dragon and jar_active else requested

    def _activate_effect(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> dict[str, Any]:
        if state.get("chain", {}).get("status") == "closed":
            self._require_turn(state, player)
        source_instance_id = action.get("source_instance_id")
        source = find_card(state, source_instance_id) if isinstance(source_instance_id, str) else None
        if (
            source
            and source[0] == player
            and source[1] in {"hand", "spell_trap_zone"}
            and source[3].get("card_id") == "s-twin-twisters"
        ):
            if source[1] == "hand" and state.get("turn_player") != player:
                raise DuelRuleError("Chỉ có thể kích hoạt Bài Phép từ trên tay trong lượt của bạn.")
            if source[1] == "spell_trap_zone":
                if not source[3].get("face_down", False):
                    raise DuelRuleError("Lá bài này đã được kích hoạt.")
                if source[3].get("set_turn") == state.get("turn"):
                    raise DuelRuleError("Lá Phép Tức Thời vừa úp chưa thể kích hoạt ngay trong lượt này.")
            if action.get("target_instance_ids"):
                raise DuelRuleError(
                    "Song Bão phải bỏ 1 lá bài làm chi phí trước khi chọn mục tiêu."
                )
            opponent = opponent_of(player)
            if not any(state["players"][opponent]["spell_trap_zone"]):
                raise DuelRuleError(
                    "Song Bão chỉ có thể kích hoạt khi đối thủ có Lá Phép/Bẫy trên sân."
                )
            required_hand_count = 2 if source[1] == "hand" else 1
            if len(state["players"][player]["hand"]) < required_hand_count:
                raise DuelRuleError("Song Bão cần 1 lá bài trên tay để bỏ làm chi phí.")
            state["pending_decision"] = {
                "type": "twin_twisters_discard",
                "player": player,
                "count": 1,
                "source_instance_id": source_instance_id,
                "effect_card_id": "s-twin-twisters",
            }
            return state
        effect_id = action.get("effect_id", "activate")
        target_ids = action.get("target_instance_ids", [])
        payload = action.get("payload", {})
        raw_zone_index = action.get("zone_index")
        destination_index = (
            raw_zone_index
            if isinstance(raw_zone_index, int)
            and not isinstance(raw_zone_index, bool)
            and 0 <= raw_zone_index < 5
            and state["players"][player]["spell_trap_zone"][raw_zone_index] is None
            else None
        )
        if not isinstance(target_ids, list) or not isinstance(payload, Mapping):
            raise DuelRuleError("Dữ liệu kích hoạt hiệu ứng không hợp lệ.")
        updated = self.effect_engine.activate(
            state,
            player=player,
            source_instance_id=source_instance_id,
            effect_id=effect_id,
            target_instance_ids=target_ids,
            payload=payload,
            destination_index=destination_index,
        )
        return self._finish_player_activation(updated, player)

    def _finish_player_activation(
        self, state: dict[str, Any], player: str
    ) -> dict[str, Any]:
        if (
            state.get("chain", {}).get("status") == "open"
            and state["chain"].get("priority_player") == opponent_of(player)
        ):
            return self._pass_ai_priority(state)
        return state

    def _pass_chain(
        self, state: dict[str, Any], player: str
    ) -> dict[str, Any]:
        updated = self.effect_engine.pass_priority(state, player=player)
        return self._pass_ai_priority(updated)


    def chain_response_options(
        self, state: Mapping[str, Any], player: str
    ) -> list[dict[str, Any]]:
        return self.effect_engine.chain_response_options(state, player)

    def _simulate_chain_resolution(self, state: Mapping[str, Any]) -> dict[str, Any]:
        simulated = deepcopy(dict(state))
        battle_prepared = False
        for _ in range(16):
            chain = simulated.get("chain", {})
            if chain.get("status") == "open":
                simulated = self.effect_engine.pass_priority(
                    simulated,
                    player=chain["priority_player"],
                )
                continue
            if simulated.get("pending_decision"):
                break

            self._resolve_pending_card_triggers(simulated)
            if simulated.get("chain", {}).get("status") == "open":
                continue
            if (
                not battle_prepared
                and simulated.get("pending_battle")
                and not simulated["pending_battle"].get("awaiting_resolution")
            ):
                battle_prepared = True
                self._prepare_pending_battle(simulated)
                continue
            break
        return simulated


    def _attack(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_turn(state, player)
        if state.get("phase") != "battle":
            raise DuelRuleError("Chỉ được tấn công trong Battle Phase.")
        if state["turn"] == 1 and state["first_player"] == player:
            raise DuelRuleError("Người đi trước không được tấn công trong lượt đầu tiên.")
        attacker_id = action.get("attacker_instance_id")
        defender_id = action.get("defender_instance_id")
        if (
            not isinstance(attacker_id, str)
            or not attacker_id
            or (defender_id is not None and not isinstance(defender_id, str))
        ):
            raise DuelRuleError("Mục tiêu tấn công không hợp lệ.")
        attacker = find_card(state, attacker_id)
        second_attack_available = bool(
            attacker
            and attacker[1] == "monster_zone"
            and attacker[3].get("card_id")
            == "m-black-luster-soldier-envoy-of-the-beginning"
            and attacker[3].get("black_luster_second_attack") == state["turn"]
        )
        if (
            not attacker
            or attacker[0] != player
            or attacker[1] != "monster_zone"
            or (
                attacker_id in state["attacked"][player]
                and not second_attack_available
            )
            or not can_declare_attack(state, player, attacker_id)
        ):
            raise DuelRuleError("Quái thú này hiện không được phép tấn công.")
        if second_attack_available:
            attacker[3].pop("black_luster_second_attack", None)
        opponent = opponent_of(player)
        opposing_monsters = state["players"][opponent]["monster_zone"]
        if defender_id is None:
            if any(opposing_monsters):
                raise DuelRuleError("Không thể tấn công trực tiếp khi đối thủ còn quái thú.")
        else:
            defender = find_card(state, defender_id)
            if not defender or defender[0] != opponent or defender[1] != "monster_zone":
                raise DuelRuleError("Quái thú phòng thủ không còn hợp lệ.")

        state["pending_battle"] = {
            "attacker_player": player,
            "attacker_instance_id": attacker_id,
            "defender_instance_id": defender_id,
        }
        state["battle"] = {}
        updated = resolve_attack_trap(
            self.effect_engine,
            state,
            attacker_player=player,
            attacker_instance_id=attacker_id,
        )
        state.clear()
        state.update(updated)
        if state.get("chain", {}).get("status") == "open":
            updated = self._pass_ai_priority(state)
            if updated is not state:
                state.clear()
                state.update(updated)

    def _prepare_pending_battle(self, state: dict[str, Any]) -> None:
        pending = state.get("pending_battle")
        if (
            not pending
            or state.get("battle", {}).get("attack_cancelled")
            or not can_declare_attack(
                state,
                pending["attacker_player"],
                pending["attacker_instance_id"],
            )
        ):
            self._resolve_pending_battle(state)
            return

        defender_id = pending.get("defender_instance_id")
        defender = find_card(state, defender_id) if defender_id else None
        if not defender or defender[1] != "monster_zone":
            self._resolve_pending_battle(state)
            return

        defending_card = defender[3]
        defender_player = defender[0]
        if (
            defending_card.get("card_id") == "m-maiden-with-eyes-of-blue"
            and not pending.get("maiden_attack_prompted")
        ):
            pending["maiden_attack_prompted"] = True
            pending["defender_was_face_down"] = bool(
                defending_card.get("face_down", False)
            )
            defending_card["face_down"] = False
            usage_key = f"{defender_player}:m-maiden-with-eyes-of-blue"
            if (
                state.get("effect_uses", {}).get(usage_key) != state["turn"]
                and not monster_effects_are_negated(
                    state, defending_card["instance_id"]
                )
                and _maiden_blue_eyes_candidates(state, defender_player)
                and any(
                    card is None
                    for card in state["players"][defender_player]["monster_zone"]
                )
            ):
                if defender_player == "ai":
                    state["pending_decision"] = {
                        "type": "maiden_attack",
                        "player": defender_player,
                        "source_instance_id": defending_card["instance_id"],
                    }
                    self._activate_maiden_attack_effect(state, defender_player)
                    if state.get("battle", {}).get("attack_cancelled"):
                        self._resolve_pending_battle(state)
                        return
                else:
                    state["pending_decision"] = {
                        "type": "maiden_attack",
                        "player": defender_player,
                        "source_instance_id": defending_card["instance_id"],
                    }
                    return
        if (
            defending_card.get("card_id") == "m-night-assailant"
            and not pending.get("night_assailant_prompted")
        ):
            pending["night_assailant_prompted"] = True
            pending["defender_was_face_down"] = False
            defending_card["face_down"] = False
            resolve_flip_effects(
                state,
                defender_player,
                "m-night-assailant",
                defending_card["instance_id"],
            )
            if state.get("pending_decision"):
                return
        pending["defender_was_face_down"] = bool(defending_card.get("face_down"))
        if pending["defender_was_face_down"]:
            defending_card["face_down"] = False
            pending["revealed_face_down"] = True
            if pending["attacker_player"] == "player":
                pending["awaiting_resolution"] = True
                return
            if isinstance(state.get("_ai_turn_stages"), list):
                self._record_ai_turn_stage(
                    state,
                    "attack_reveal",
                    attacker_instance_id=pending.get("attacker_instance_id"),
                    defender_instance_id=defender_id,
                )

        self._resolve_pending_battle(state)

    def _activate_cloning(self, state: dict[str, Any], player: str) -> dict[str, Any]:
        pending = state.get("pending_decision")
        source_id = pending.get("source_instance_id") if pending else None
        target_id = pending.get("summoned_instance_id") if pending else None
        if (
            not pending
            or pending.get("type") != "cloning_offer"
            or pending.get("player") != player
            or not isinstance(source_id, str)
            or not isinstance(target_id, str)
        ):
            raise DuelRuleError("Không có hiệu ứng Nhân Bản Quái Thú đang chờ kích hoạt.")

        state["pending_decision"] = None
        state["_cloning_activation"] = {
            "player": player,
            "source_instance_id": source_id,
            "summoned_instance_id": target_id,
        }
        updated = self.effect_engine.activate(
            state,
            player=player,
            source_instance_id=source_id,
            effect_id="activate",
            target_instance_ids=[target_id],
            payload={"summoned_instance_id": target_id},
        )
        updated.pop("_cloning_activation", None)
        return self._finish_player_activation(updated, player)

    @staticmethod
    def _complete_ordeal_traveler_guess(
        state: dict[str, Any],
        player: str,
        action: Mapping[str, Any],
    ) -> None:
        pending = state.get("pending_decision")
        secret = state.get("_ordeal_traveler_pending")
        guess = action.get("guess")
        if (
            not pending
            or pending.get("type") != "ordeal_traveler_guess"
            or pending.get("player") != player
            or player != "player"
            or not isinstance(secret, Mapping)
            or not isinstance(guess, str)
            or guess not in {"monster", "spell", "trap"}
            or not state.get("pending_battle")
            or state["pending_battle"].get("attacker_instance_id")
            != secret.get("attacker_instance_id")
        ):
            raise DuelRuleError("Không có dự đoán Thử Thách Kẻ Du Hành hợp lệ đang chờ.")

        attacker = find_card(state, secret["attacker_instance_id"])
        if not attacker or attacker[1] != "monster_zone":
            raise DuelRuleError("Quái thú tấn công không còn hợp lệ.")

        state["pending_decision"] = None
        state.pop("_ordeal_traveler_pending", None)
        if guess != secret.get("selected_type"):
            move_card(
                state,
                attacker[3]["instance_id"],
                attacker[3].get("owner", attacker[0]),
                "hand",
            )
            state.setdefault("battle", {})["attack_cancelled"] = True

    def _complete_clone_dragon_selection(
        self,
        state: dict[str, Any],
        player: str,
        instance_ids: Any,
    ) -> None:
        pending = state.get("pending_decision")
        eligible_ids = (
            pending.get("eligible_target_instance_ids") if pending else None
        )
        source_id = pending.get("source_instance_id") if pending else None
        if (
            not pending
            or pending.get("type") != "select_field_cards"
            or pending.get("effect_card_id") != CLONE_DRAGON_ID
            or pending.get("target_mode") != "clone-dragon-field-monster"
            or pending.get("player") != player
            or pending.get("min_count") != 0
            or pending.get("max_count") != 1
            or not isinstance(source_id, str)
            or not isinstance(eligible_ids, list)
            or len(set(eligible_ids)) != len(eligible_ids)
            or not isinstance(instance_ids, list)
            or len(instance_ids) > 1
            or any(not isinstance(instance_id, str) for instance_id in instance_ids)
            or len(set(instance_ids)) != len(instance_ids)
        ):
            raise DuelRuleError("Lựa chọn mục tiêu cho Rồng Vô Tính không hợp lệ.")

        source = find_card(state, source_id)
        if (
            not source
            or source[0] != player
            or source[1] != "hand"
            or source[3].get("card_id") != CLONE_DRAGON_ID
        ):
            raise DuelRuleError("Rồng Vô Tính không còn trên tay để kích hoạt.")

        state["pending_decision"] = None
        if not instance_ids:
            return
        target_id = instance_ids[0]
        if (
            target_id not in eligible_ids
            or target_id not in self.effect_engine.clone_dragon_target_ids(state)
            or not any(
                card is None for card in state["players"][player]["monster_zone"]
            )
        ):
            raise DuelRuleError("Mục tiêu không hợp lệ để Rồng Vô Tính sao chép.")
        self._summon_clone_dragon(state, player, source_id, target_id)

    def _summon_clone_dragon(
        self,
        state: dict[str, Any],
        player: str,
        source_instance_id: str,
        target_instance_id: str,
    ) -> None:
        zone_index = next(
            (
                index
                for index, card in enumerate(state["players"][player]["monster_zone"])
                if card is None
            ),
            None,
        )
        if zone_index is None:
            raise DuelRuleError("Không còn ô Quái thú trống cho Rồng Vô Tính.")
        summoned = move_card(
            state,
            source_instance_id,
            player,
            "monster_zone",
            destination_index=zone_index,
        )
        summoned["face_down"] = False
        summoned["position"] = "attack"
        summoned["summon_method"] = "special"
        summoned["summoned_turn"] = state["turn"]
        resolve_monster_summon_effects(
            state, player, source_instance_id, "special"
        )
        updated = self.effect_engine.apply_clone_dragon_copy(
            state,
            source_instance_id=source_instance_id,
            target_instance_id=target_instance_id,
        )
        state.clear()
        state.update(updated)

    def _activate_maiden_attack_effect(
        self, state: dict[str, Any], player: str
    ) -> None:
        pending_decision = state.get("pending_decision")
        pending_battle = state.get("pending_battle")
        if (
            not pending_battle
            or not pending_decision
            or pending_decision.get("type") != "maiden_attack"
            or pending_decision.get("player") != player
            or pending_battle.get("defender_instance_id")
            != pending_decision.get("source_instance_id")
        ):
            raise DuelRuleError("Hiệu ứng tấn công của Thiếu Nữ Mắt Xanh không còn hợp lệ.")
        source = find_card(state, pending_decision["source_instance_id"])
        usage_key = f"{player}:m-maiden-with-eyes-of-blue"
        if (
            not source
            or source[0] != player
            or source[1] != "monster_zone"
            or source[3].get("card_id") != "m-maiden-with-eyes-of-blue"
            or source[3].get("face_down", False)
            or monster_effects_are_negated(state, source[3]["instance_id"])
            or state.get("effect_uses", {}).get(usage_key) == state["turn"]
            or not _maiden_blue_eyes_candidates(state, player)
            or not any(
                card is None for card in state["players"][player]["monster_zone"]
            )
        ):
            raise DuelRuleError("Thiếu Nữ Mắt Xanh không thể kích hoạt hiệu ứng ngăn đòn tấn công.")

        state["pending_decision"] = None
        state.setdefault("effect_uses", {})[usage_key] = state["turn"]
        state.setdefault("battle", {})["attack_cancelled"] = True
        source[3]["position"] = "defense"
        if player == "ai":
            candidates = _maiden_blue_eyes_candidates(state, player)
            if candidates and any(
                card is None for card in state["players"][player]["monster_zone"]
            ):
                zone, target = candidates[0]
                if _special_summon(state, player, target["instance_id"]):
                    if zone == "deck":
                        random.shuffle(state["players"][player]["deck"])
            return
        _queue_maiden_summon_selection(
            state,
            player,
            source[3]["instance_id"],
            "attack_summon",
            min_count=1,
        )

    def _resolve_pending_battle(self, state: dict[str, Any]) -> None:
        pending = state.pop("pending_battle")
        battle_state = state.get("battle", {})
        attacker_player = pending["attacker_player"]
        attacker_id = pending["attacker_instance_id"]
        opponent = opponent_of(attacker_player)
        if battle_state.get("attack_cancelled"):
            self._record_attack(state, attacker_player, attacker_id)
            if battle_state.get("phase_ended") and state.get("phase") == "battle":
                state["phase"] = "main2"
            state["battle"] = {}
            return

        attacker = find_card(state, attacker_id)
        if (
            not attacker
            or attacker[1] != "monster_zone"
            or not can_declare_attack(state, attacker_player, attacker_id)
        ):
            self._record_attack(state, attacker_player, attacker_id)
            state["battle"] = {}
            return
        defender_id = pending["defender_instance_id"]
        defender = find_card(state, defender_id) if defender_id else None
        if defender_id and (
            not defender or defender[0] != opponent or defender[1] != "monster_zone"
        ):
            defender = None
        if not defender and any(state["players"][opponent]["monster_zone"]):
            self._record_attack(state, attacker_player, attacker_id)
            state["battle"] = {}
            return
        if defender:
            self._resolve_monster_battle(
                state,
                attacker,
                defender,
                defender_was_face_down=bool(
                    pending.get("defender_was_face_down")
                ),
            )
        else:
            if not is_battle_protected(state, opponent):
                damage = current_stats(state, attacker_id)["atk"]
                if damage:
                    change_life_points(state, opponent, -damage)
                    if not state.get("over"):
                        self._resolve_robbin_goblin(state, attacker_player)
        self._record_attack(state, attacker_player, attacker_id)
        state["battle"] = {}

    @staticmethod
    def _record_attack(state: dict[str, Any], player: str, attacker_id: str) -> None:
        if attacker_id not in state["attacked"][player]:
            state["attacked"][player].append(attacker_id)

    def _resolve_monster_battle(
        self,
        state: dict[str, Any],
        attacker: tuple[str, str, int, dict[str, Any]],
        defender: tuple[str, str, int, dict[str, Any]],
        *,
        defender_was_face_down: bool,
    ) -> None:
        attacker_player, _attacker_zone, _attacker_index, attacking_card = attacker
        defender_player, _defender_zone, _defender_index, defending_card = defender
        attacker_id = attacking_card["instance_id"]
        defender_id = defending_card["instance_id"]
        defender_card_id = defending_card.get("card_id")
        attacker_atk = current_stats(state, attacker_id)["atk"]
        if defending_card.get("face_down", False):
            defending_card["face_down"] = False
        defense_position = (
            defender_was_face_down
            or defending_card.get("position") == "defense"
        )
        defender_stats = current_stats(state, defender_id)
        defender_value = defender_stats["def"] if defense_position else defender_stats["atk"]
        attacker_destroyed = False
        defender_destroyed = False
        attacker_damage = 0
        defender_damage = 0

        if defense_position:
            if attacker_atk > defender_value:
                defender_destroyed = not self._battle_immune(
                    defending_card, attacker_atk
                )
                if (
                    attacking_card.get("card_id") == "m-lancer-lindwurm"
                    and not attacking_card.get("monster_effects_negated", False)
                ):
                    defender_damage = attacker_atk - defender_value
            elif attacker_atk < defender_value:
                attacker_damage = defender_value - attacker_atk
        elif attacker_atk > defender_value:
            defender_destroyed = not self._battle_immune(
                defending_card, attacker_atk
            )
            defender_damage = attacker_atk - defender_value
        elif attacker_atk < defender_value:
            attacker_destroyed = not self._battle_immune(
                attacking_card, defender_value
            )
            attacker_damage = defender_value - attacker_atk
        else:
            attacker_destroyed = not self._battle_immune(
                attacking_card, defender_value
            )
            defender_destroyed = not self._battle_immune(
                defending_card, attacker_atk
            )

        attacker_protected = is_battle_protected(
            state, attacker_player, attacker_id
        )
        defender_protected = is_battle_protected(
            state, defender_player, defender_id
        )
        lacooda_card = next(
            (
                card
                for card in state["players"][defender_player]["monster_zone"]
                if card
                and card.get("card_id") == "m-3-hump-lacooda"
                and not card.get("face_down", False)
                and not monster_effects_are_negated(state, card["instance_id"])
                and f"{card['instance_id']}:lacooda:{state['turn']}"
                not in state.setdefault("effect_uses", {})
            ),
            None,
        )
        if lacooda_card:
            lacooda_instance = lacooda_card["instance_id"]
            state.setdefault("lacooda", {})[defender_player] = lacooda_instance
            state["effect_uses"][f"{lacooda_instance}:lacooda:{state['turn']}"] = state["turn"]
            attacker_damage = 0
            defender_damage = 0
            attacker_destroyed = False
            defender_destroyed = False
            next_state, drawn = draw_cards(state, defender_player, 3)
            state.clear()
            state.update(next_state)
            apply_draw_triggers(state, defender_player, len(drawn))
        if attacker_protected:
            attacker_destroyed = False
        if defender_protected:
            defender_destroyed = False
            defender_damage = 0

        destroyed_attacker = (
            destroy_card(
                state, attacker_id, by_player=defender_player, by_battle=True
            )
            if attacker_destroyed
            else None
        )
        destroyed_defender = (
            destroy_card(
                state, defender_id, by_player=attacker_player, by_battle=True
            )
            if defender_destroyed
            else None
        )
        destroyed_defender_location = (
            find_card(state, defender_id) if destroyed_defender else None
        )
        if (
            destroyed_defender
            and attacking_card.get("card_id")
            == "m-black-luster-soldier-envoy-of-the-beginning"
            and not attacking_card.get("monster_effects_negated", False)
        ):
            choice_key = (
                f"{attacker_player}:{attacker_id}:black-luster-choice"
            )
            if state.get("effect_uses", {}).get(choice_key) != state["turn"]:
                state.setdefault("effect_uses", {})[choice_key] = state["turn"]
                attacking_card["black_luster_second_attack"] = state["turn"]
        if attacker_damage and not state.get("over"):
            damage_negation = state.get("battle", {}).get("damage_negated_player")
            if damage_negation != attacker_player:
                change_life_points(state, attacker_player, -attacker_damage)
        if defender_damage and not state.get("over"):
            damage_negation = state.get("battle", {}).get("damage_negated_player")
            if damage_negation != defender_player:
                change_life_points(state, defender_player, -defender_damage)
            if not state.get("over"):
                self._resolve_robbin_goblin(state, attacker_player)

        if defender_was_face_down:
            blade_knight = find_card(state, attacker_id)
            blade_knight_alone = (
                destroyed_defender
                and attacking_card.get("card_id") == "m-blade-knight"
                and not attacking_card.get("monster_effects_negated", False)
                and blade_knight
                and blade_knight[1] == "monster_zone"
                and not blade_knight[3].get("face_down", False)
                and not any(
                    monster
                    and monster.get("instance_id") != attacker_id
                    for monster in state["players"][attacker_player]["monster_zone"]
                )
            )
            if not blade_knight_alone:
                resolve_flip_effects(
                    state,
                    defender_player,
                    defender_card_id,
                    defender_id,
                )

        if defender_was_face_down and find_card(state, defender_id):
            current_defender = find_card(state, defender_id)
            current_defender[3]["face_down"] = False
        if (
            defending_card.get("card_id") == "m-marshmallon"
            and not defending_card.get("monster_effects_negated", False)
            and defender_was_face_down
            and find_card(state, defender_id)
        ):
            current_defender = find_card(state, defender_id)
            current_defender[3]["face_down"] = False
            if not state.get("over"):
                change_life_points(state, attacker_player, -1000)

        if (
            destroyed_attacker
            and defending_card.get("card_id") == "m-divine-knight-ishzark"
            and not defending_card.get("monster_effects_negated", False)
            and not defender_was_face_down
        ):
            self._banish_battle_destroyed_card(state, attacker_id)
        defender_banished = bool(
            destroyed_defender
            and attacking_card.get("card_id") == "m-divine-knight-ishzark"
            and not attacking_card.get("face_down")
            and not attacking_card.get("monster_effects_negated", False)
            and self._banish_battle_destroyed_card(state, defender_id)
        )
        if (
            destroyed_defender
            and destroyed_defender_location
            and destroyed_defender_location[1] == "graveyard"
            and not defender_banished
            and defending_card.get("card_id") == "m-giant-germ"
            and not defending_card.get("monster_effects_negated", False)
        ):
            self._resolve_giant_germ(state, defender_player, attacker_player)
        if (
            destroyed_defender
            and destroyed_defender_location
            and destroyed_defender_location[1] == "graveyard"
            and not defender_banished
            and defending_card.get("card_id") == "m-revival-jam"
            and not defending_card.get("monster_effects_negated", False)
        ):
            self._resolve_revival_jam(state, defender_player, defender_id)
        if (
            defending_card.get("card_id") == "m-wall-of-illusion"
            and not defending_card.get("monster_effects_negated", False)
            and find_card(state, attacker_id)
        ):
            move_card(state, attacker_id, attacker_player, "hand")

        # Hoàng Đế Raider: tăng ATK khi thắng và giảm ATK của quái thú đã phá hủy nó.
        kaiser_id = "m-kaiser-vorse-raider"
        if (
            destroyed_defender
            and attacking_card.get("card_id") == kaiser_id
            and not attacking_card.get("monster_effects_negated", False)
        ):
            self._apply_kaiser_vorse_atk_change(
                state,
                target_instance_id=attacker_id,
                source_instance_id=attacker_id,
                owner=attacker_player,
                operation="increase",
            )
        if (
            destroyed_attacker
            and defending_card.get("card_id") == kaiser_id
            and not defending_card.get("monster_effects_negated", False)
        ):
            self._apply_kaiser_vorse_atk_change(
                state,
                target_instance_id=defender_id,
                source_instance_id=defender_id,
                owner=defender_player,
                operation="increase",
            )
        if (
            destroyed_attacker
            and attacking_card.get("card_id") == kaiser_id
            and not attacking_card.get("monster_effects_negated", False)
        ):
            self._apply_kaiser_vorse_atk_change(
                state,
                target_instance_id=defender_id,
                source_instance_id=attacker_id,
                owner=attacker_player,
                operation="decrease",
            )
        if (
            destroyed_defender
            and defending_card.get("card_id") == kaiser_id
            and not defending_card.get("monster_effects_negated", False)
        ):
            self._apply_kaiser_vorse_atk_change(
                state,
                target_instance_id=attacker_id,
                source_instance_id=defender_id,
                owner=defender_player,
                operation="decrease",
            )
        if (
            defense_position
            and defending_card.get("card_id") == "m-big-shield-gardna"
            and not defending_card.get("monster_effects_negated", False)
        ):
            current_defender = find_card(state, defender_id)
            if current_defender and current_defender[1] == "monster_zone":
                current_defender[3]["position"] = "attack"
        for destroyed_card in (destroyed_attacker, destroyed_defender):
            if not destroyed_card or destroyed_card.get("card_id") != "m-the-white-stone-of-ancients":
                continue
            current_card = find_card(state, destroyed_card["instance_id"])
            if current_card and current_card[1] == "graveyard":
                state.setdefault("pending_card_triggers", []).append(
                    {
                        "card_id": "m-the-white-stone-of-ancients",
                        "source_instance_id": destroyed_card["instance_id"],
                        "player": current_card[0],
                    }
                )

    @staticmethod
    def _apply_kaiser_vorse_atk_change(
        state: dict[str, Any],
        *,
        target_instance_id: str,
        source_instance_id: str,
        owner: str,
        operation: str,
    ) -> None:
        target = find_card(state, target_instance_id)
        if not target or target[1] != "monster_zone":
            return
        updated = add_stat_modifier(
            state,
            target_instance_id=target_instance_id,
            source_instance_id=source_instance_id,
            source_card_id="m-kaiser-vorse-raider",
            owner=owner,
            stat="atk",
            operation=operation,
            value=500,
            duration={"type": "permanent"},
        )
        state.clear()
        state.update(updated)

    @staticmethod
    def _resolve_robbin_goblin(state: dict[str, Any], damaging_player: str) -> None:
        # Tên Trộm Yêu Tinh: mỗi lần quái thú gây sát thương chiến đấu, đối thủ bỏ ngẫu nhiên 1 lá.
        damaged_player = opponent_of(damaging_player)
        active_traps = sum(
            1
            for trap in state["players"][damaging_player]["spell_trap_zone"]
            if trap
            and trap.get("card_id") == "t-robbin-goblin"
            and not trap.get("face_down", False)
            and not trap_effect_is_negated(state, damaging_player)
        )
        for _ in range(active_traps):
            hand = state["players"][damaged_player]["hand"]
            if not hand or state.get("over"):
                return
            discarded = random.choice(hand)
            move_card(
                state,
                discarded["instance_id"],
                damaged_player,
                "graveyard",
            )

    @staticmethod
    def _banish_battle_destroyed_card(
        state: dict[str, Any], instance_id: str
    ) -> bool:
        found = find_card(state, instance_id)
        if not found or found[1] != "graveyard":
            return False
        move_card(state, instance_id, found[3]["owner"], "banished")
        return True

    @staticmethod
    def _battle_immune(monster: Mapping[str, Any], opposing_atk: int) -> bool:
        return bool(
            monster.get("cannot_be_destroyed_by_battle", False)
            or (
                not monster.get("monster_effects_negated", False)
                and (
                    monster.get("card_id") == "m-marshmallon"
                    or (
                        monster.get("card_id") == "m-celtic-guardian"
                        and opposing_atk >= 1900
                    )
                )
            )
        )

    def _resolve_giant_germ(
        self, state: dict[str, Any], controller: str, damaged_player: str
    ) -> None:
        if not state.get("over"):
            change_life_points(state, damaged_player, -500)
        while True:
            zone_index = next(
                (
                    index
                    for index, card in enumerate(
                        state["players"][controller]["monster_zone"]
                    )
                    if card is None
                ),
                None,
            )
            germ = next(
                (
                    card
                    for card in state["players"][controller]["deck"]
                    if card.get("card_id") == "m-giant-germ"
                ),
                None,
            )
            if zone_index is None or germ is None:
                return
            summoned = move_card(
                state,
                germ["instance_id"],
                controller,
                "monster_zone",
                destination_index=zone_index,
            )
            summoned["face_down"] = False
            summoned["position"] = self._summon_position(
                state, summoned, "defense"
            )
            summoned["summon_method"] = "special"
            summoned["summoned_turn"] = state["turn"]
            self._apply_slifer_summon_effect(state, controller, summoned)
            resolve_monster_summon_effects(
                state, controller, summoned["instance_id"], "special"
            )

    def _resolve_revival_jam(
        self, state: dict[str, Any], controller: str, instance_id: str
    ) -> None:
        if not find_card(state, instance_id):
            return
        zone_index = next(
            (
                index
                for index, card in enumerate(
                    state["players"][controller]["monster_zone"]
                )
                if card is None
            ),
            None,
        )
        found = find_card(state, instance_id)
        if zone_index is None or not found or found[1] != "graveyard":
            return
        revived = move_card(
            state,
            instance_id,
            controller,
            "monster_zone",
            destination_index=zone_index,
        )
        revived["face_down"] = False
        revived["position"] = self._summon_position(
            state, revived, "defense"
        )
        revived["summon_method"] = "special"
        revived["summoned_turn"] = state["turn"]
        revived["revival_count"] = int(revived.get("revival_count", 0)) + 1
        self._apply_slifer_summon_effect(state, controller, revived)
        resolve_monster_summon_effects(
            state, controller, revived["instance_id"], "special"
        )

    def _discard(
        self, state: dict[str, Any], player: str, action: Mapping[str, Any]
    ) -> None:
        self._require_turn(state, player)
        instance_id = action.get("instance_id")
        found = find_card(state, instance_id) if isinstance(instance_id, str) else None
        if (
            state.get("phase") != "end"
            or len(state["players"][player]["hand"]) <= MAX_HAND_SIZE
            or not found
            or found[0] != player
            or found[1] != "hand"
        ):
            raise DuelRuleError("Không thể bỏ lá bài này trong trạng thái hiện tại.")
        move_card(state, instance_id, player, "graveyard")

    @staticmethod
    def _require_main_phase(state: Mapping[str, Any], player: str) -> None:
        DuelActionEngine._require_turn(state, player)
        if state.get("phase") not in MAIN_PHASES:
            raise DuelRuleError("Hành động này chỉ hợp lệ trong Main Phase.")

    @staticmethod
    def _required_tributes(monster: Mapping[str, Any]) -> int:
        card_id = monster.get("card_id")
        if card_id in GOD_CARD_IDS:
            return 3
        try:
            level = int(monster.get("level", monster.get("lv", 0)))
        except (TypeError, ValueError):
            level = 0
        if level <= 4:
            return 0
        if level <= 6:
            return 1
        return 2 if level <= 9 else 3

    @staticmethod
    def _tribute_value(
        tribute: Mapping[str, Any],
        summon_target: Mapping[str, Any],
        required: int,
    ) -> int:
        if tribute.get("category") == "fusion":
            return 2
        if required < 2:
            return 1
        attribute = str(summon_target.get("attribute") or "").upper()
        # Hoàng Đế Hải Mã: tính là 2 vật tế cho quái thú LIGHT.
        if (
            tribute.get("card_id") == "m-kaiser-seahorse"
            and not tribute.get("monster_effects_negated", False)
            and attribute == "LIGHT"
        ):
            return 2
        # Thây Ma Song Sinh: tính là 2 vật tế cho quái thú DARK.
        if (
            tribute.get("card_id") == "m-double-coston"
            and not tribute.get("monster_effects_negated", False)
            and attribute == "DARK"
        ):
            return 2
        return 1

    @staticmethod
    def _validate_tributes(
        state: Mapping[str, Any], player: str, instance_ids: list[str]
    ) -> list[tuple[str, str, int, dict[str, Any]]]:
        found_tributes = []
        for instance_id in instance_ids:
            found = find_card(state, instance_id)
            if (
                not found
                or found[1] != "monster_zone"
                or (
                    found[0] != player
                    and (
                        found[3].get("soul_exchange_owner") != player
                        or found[3].get("soul_exchange_turn") != state["turn"]
                    )
                )
            ):
                raise DuelRuleError("Vật hiến tế phải là quái thú trên sân của mình.")
            found_tributes.append(found)
        return found_tributes


def _replace_state(state: dict[str, Any], replacement: Mapping[str, Any]) -> None:
    state.clear()
    state.update(replacement)
