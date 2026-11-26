import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAiTurnStages,
  getMagicCylinderRedirect,
  getAiActivatedSpellTrap,
  getAiDiscardedCards,
  getAiDestroyedFieldCards,
  getMillCountsBetweenStages,
  hasNewlySummonedMonster,
  getTemporaryControlTransfers,
  getLightningStormDestroyedZones,
  getBattleDefenderState,
  getLacoodaBattleNegation,
  isMonsterAttackLockedBySpellTrap,
  mapDuelMatch,
  mergeDuelPlayerProfile,
  postDuelAction,
  didResolveCardDestruction,
  stageCardDestructionResolution,
  stageDiceStatModification,
  stageEquipSpellResolution,
  stageSpellTrapActivation,
  stageTemporaryControlTransfers,
  stagePotOfGreedResolution,
  stageFieldDestructionResolution,
  stageMonsterSummonResolution,
  stageAiReloadResolution,
  stageReloadActivation,
  stageReloadResolution,
  stageSliferPreTriggerResolution,
  applySliferTriggerStatReduction
} from './duelApi.js';
import { EQUIP_SPELL_CARD_IDS } from './duelTargetDrag.js';

function matchFixture(overrides = {}) {
  return {
    match_id: 'match-1',
    turn: 2,
    turn_player: 'player',
    first_player: 'player',
    phase: 'main1',
    players: {
      player: {
        lp: 8000,
        hand_count: 1,
        hand: [{
          instance_id: 'hand-1',
          card_id: 'm-test',
          category: 'monster',
          name: 'Test Monster',
          atk: 1500,
          def: 1000
        }],
        deck_count: 35,
        graveyard: [],
        banished: [],
        monster_zone: [{
          instance_id: 'field-1',
          card_id: 'm-field',
          category: 'monster',
          name: 'Field Monster',
          atk: 2000,
          current_atk: 2500,
          def: 1200,
          face_down: false
        }],
        spell_trap_zone: [null, null, null, null, null]
      },
      ai: {
        lp: 7000,
        hand_count: 4,
        hand: [],
        deck_count: 30,
        graveyard: [],
        banished: [],
        monster_zone: [{
          instance_id: 'hidden-1',
          face_down: true,
          position: 'defense'
        }, null, null, null, null],
        spell_trap_zone: [null, null, null, null, null]
      }
    },
    chain: { status: 'closed', links: [] },
    attacked: { player: [], ai: [] },
    normal_summon_used: { player: false, ai: true },
    drawn_this_turn: true,
    pending_decision: null,
    over: false,
    winner: null,
    ...overrides
  };
}

test('maps authoritative state into the existing duel board view model', () => {
  const fixture = matchFixture();
  fixture.players.player.player_name = 'Tên tài khoản thật';
  fixture.players.player.selected_character_id = 'kaiba-seto';
  fixture.players.ai.player_name = 'Đối thủ AI';
  const game = mapDuelMatch(fixture);

  assert.equal(game.authoritative, true);
  assert.equal(game.profile.me.name, 'Tên tài khoản thật');
  assert.equal(game.profile.me.selectedCharacterId, 'kaiba-seto');
  assert.equal(game.profile.opp.name, 'Đối thủ AI');
  assert.equal(game.phaseIndex, 2);
  assert.equal(game.turn, 'me');
  assert.equal(game.hand.me[0].instance_id, 'hand-1');
  assert.equal(game.field.me.mon[0].atk, 2500);
  assert.equal(game.field.opp.mon[0].id, undefined);
  assert.equal(game.hand.opp.length, 4);
  assert.equal(game.deck.me.length, 35);
  assert.equal(game.normalSummonUsed.opp, true);
});

test('animates every newly placed monster regardless of its summon method', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.monster_zone = Array(5).fill(null);
  const previousGame = mapDuelMatch(previousMatch);
  const nextMatch = JSON.parse(JSON.stringify(previousMatch));
  nextMatch.players.player.monster_zone = [
    { instance_id: 'normal-summon', card_id: 'm-normal', category: 'monster', summon_method: 'normal' },
    { instance_id: 'tribute-summon', card_id: 'm-tribute', category: 'monster', summon_method: 'tribute' },
    { instance_id: 'special-summon', card_id: 'm-special', category: 'monster', summon_method: 'special' },
    null,
    null
  ];

  const game = mapDuelMatch(nextMatch, previousGame);

  assert.ok(game.field.me.mon.slice(0, 3).every((card) =>
    card._motion.endsWith('-summon')
  ));
});

test('fills a missing duel profile from the authenticated session user', () => {
  const match = matchFixture();
  match.players.player.player_name = 'Tên cũ trong snapshot';
  match.players.player.selected_character_id = 'kaiba-seto';
  const mergedMatch = mergeDuelPlayerProfile(match, {
    username: 'account-login',
    player_name: 'Người Khổng Lồ',
    selected_character_id: 'muto-yugi'
  });
  const game = mapDuelMatch(mergedMatch);

  assert.equal(game.profile.me.name, 'Người Khổng Lồ');
  assert.equal(game.profile.me.selectedCharacterId, 'muto-yugi');
});

test('preserves profile identity when later duel snapshots omit profile fields', () => {
  const previousGame = mapDuelMatch(mergeDuelPlayerProfile(
    matchFixture(),
    {
      username: 'account-login',
      player_name: 'Người Khổng Lồ',
      selected_character_id: 'muto-yugi'
    }
  ));

  const nextGame = mapDuelMatch(matchFixture(), previousGame);

  assert.equal(nextGame.profile.me.name, 'Người Khổng Lồ');
  assert.equal(nextGame.profile.me.selectedCharacterId, 'muto-yugi');
});

test('redirects a resolved Magic Cylinder attack toward the attacker controller', () => {
  const previousGame = mapDuelMatch(matchFixture({
    pending_battle: {
      attacker_player: 'ai',
      attacker_instance_id: 'hidden-1',
      defender_instance_id: 'field-1'
    }
  }));
  previousGame.field.opp.mon[0] = {
    ...previousGame.field.opp.mon[0],
    faceDown: false,
    atk: 2400
  };
  previousGame.field.me.st[0] = {
    id: 't-magic-cylinder',
    instance_id: 'magic-cylinder-1'
  };

  const updatedGame = {
    ...previousGame,
    lp: { ...previousGame.lp, opp: 4600 },
    grave: {
      ...previousGame.grave,
      me: [previousGame.field.me.st[0]]
    }
  };

  assert.deepEqual(
    getMagicCylinderRedirect(previousGame, updatedGame, {
      type: 'activate_effect',
      source_instance_id: 'magic-cylinder-1'
    }),
    { attackerSide: 'opp', attackerInstanceId: 'hidden-1' }
  );
});

test('does not redirect a Magic Cylinder attack if its damage was negated', () => {
  const previousGame = mapDuelMatch(matchFixture({
    pending_battle: {
      attacker_player: 'ai',
      attacker_instance_id: 'hidden-1',
      defender_instance_id: 'field-1'
    }
  }));
  previousGame.field.opp.mon[0] = {
    ...previousGame.field.opp.mon[0],
    faceDown: false,
    atk: 2400
  };
  previousGame.field.me.st[0] = {
    id: 't-magic-cylinder',
    instance_id: 'magic-cylinder-1'
  };

  const updatedGame = {
    ...previousGame,
    grave: {
      ...previousGame.grave,
      me: [previousGame.field.me.st[0]]
    }
  };

  assert.equal(
    getMagicCylinderRedirect(previousGame, updatedGame, {
      type: 'activate_effect',
      source_instance_id: 'magic-cylinder-1'
    }),
    null
  );
});

test('stages an activated Spell from hand while it is face-up in the Spell/Trap Zone', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.hand = [{
    instance_id: 'spell-activation',
    card_id: 's-test-spell',
    category: 'spell',
    name: 'Test Spell'
  }];
  const previousGame = mapDuelMatch(previousMatch);
  const activationMatch = matchFixture();
  activationMatch.players.player.hand = [];
  activationMatch.players.player.hand_count = 0;
  activationMatch.players.player.spell_trap_zone[2] = {
    instance_id: 'spell-activation',
    card_id: 's-test-spell',
    category: 'spell',
    name: 'Test Spell',
    face_down: false
  };
  activationMatch.chain = { status: 'open', links: [{}] };

  const stagedGame = stageSpellTrapActivation(previousGame, activationMatch, {
    type: 'activate_effect',
    source_instance_id: 'spell-activation'
  });

  assert.equal(stagedGame.busy, true);
  assert.equal(stagedGame.field.me.st[2].instance_id, 'spell-activation');
  assert.equal(stagedGame.field.me.st[2].faceDown, false);
  assert.equal(stagedGame.hand.me.some((card) => card.instance_id === 'spell-activation'), false);
});

test('holds a new summon and destroyed monsters during Spell activation staging', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.hand = [{
    instance_id: 'spell-activation',
    card_id: 's-test-spell',
    category: 'spell',
    name: 'Test Spell'
  }];
  const previousGame = mapDuelMatch(previousMatch);
  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.hand = [];
  resolvedMatch.players.player.hand_count = 0;
  resolvedMatch.players.player.monster_zone[0] = {
    instance_id: 'summoned-monster',
    card_id: 'm-test',
    category: 'monster',
    name: 'Summoned Monster'
  };
  resolvedMatch.players.player.graveyard = [{
    instance_id: 'field-1',
    card_id: 'm-field',
    category: 'monster',
    name: 'Field Monster',
    atk: 2000,
    def: 1200
  }];

  const stagedGame = stageSpellTrapActivation(previousGame, resolvedMatch, {
    type: 'activate_effect',
    source_instance_id: 'spell-activation'
  });

  assert.equal(stagedGame.field.me.mon[0].instance_id, 'field-1');
  assert.equal(stagedGame.field.me.st[0].instance_id, 'spell-activation');
  assert.equal(
    stagedGame.grave.me.some((card) => card?.instance_id === 'field-1'),
    false
  );
  assert.equal(
    stagedGame.field.me.mon.some((card) => card?.instance_id === 'summoned-monster'),
    false
  );
});

test('stages Elma in the Spell/Trap Zone before applying its ATK increase', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.hand = [{
    instance_id: 'elma-player',
    card_id: 's-butterfly-dagger-elma',
    category: 'spell',
    name: 'Kiếm Bướm Elma'
  }];
  previousMatch.players.player.hand_count = 1;
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.hand = [];
  resolvedMatch.players.player.hand_count = 0;
  resolvedMatch.players.player.monster_zone[0].current_atk = 2800;
  resolvedMatch.players.player.spell_trap_zone[2] = {
    instance_id: 'elma-player',
    card_id: 's-butterfly-dagger-elma',
    category: 'spell',
    name: 'Kiếm Bướm Elma',
    face_down: false,
    target_instance_id: 'field-1'
  };
  const stagedGame = stageSpellTrapActivation(previousGame, resolvedMatch, {
    type: 'activate_effect',
    source_instance_id: 'elma-player',
    target_instance_ids: ['field-1']
  });

  assert.equal(stagedGame.field.me.st[2].id, 's-butterfly-dagger-elma');
  assert.equal(stagedGame.field.me.st[2].target_instance_id, 'field-1');
  assert.equal(stagedGame.field.me.mon[0].atk, 2500);
  assert.match(stagedGame.field.me.st[2]._motion, /-summon$/);
  assert.equal(mapDuelMatch(resolvedMatch, previousGame).field.me.mon[0].atk, 2800);
});

test('stages the same Elma-to-ATK sequence for an AI activation', () => {
  const previousMatch = matchFixture();
  previousMatch.players.ai.monster_zone[0] = {
    instance_id: 'ai-monster',
    card_id: 'm-ai',
    category: 'monster',
    name: 'AI Monster',
    atk: 1800,
    current_atk: 1800,
    def: 1200,
    face_down: false
  };
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.monster_zone[0].current_atk = 2800;
  resolvedMatch.players.ai.monster_zone[0] = {
    ...previousMatch.players.ai.monster_zone[0]
  };
  resolvedMatch.players.ai.spell_trap_zone[1] = {
    instance_id: 'elma-ai',
    card_id: 's-butterfly-dagger-elma',
    category: 'spell',
    name: 'Kiếm Bướm Elma',
    face_down: false,
    target_instance_id: 'field-1'
  };
  const resolvedGame = mapDuelMatch(resolvedMatch, previousGame);
  const stagedGame = stageEquipSpellResolution(
    previousGame,
    resolvedGame,
    'opp'
  );

  assert.equal(stagedGame.field.opp.st[1].id, 's-butterfly-dagger-elma');
  assert.equal(stagedGame.field.me.mon[0].atk, 2500);
  assert.equal(resolvedGame.field.me.mon[0].atk, 2800);
});

test('stages all Equip Spells before applying their target modifiers', () => {
  for (const [index, cardId] of [...EQUIP_SPELL_CARD_IDS].entries()) {
    const targetCardId = cardId === 's-magic-formula'
      ? 'm-dark-magician'
      : 'm-field';
    const previousMatch = matchFixture();
    previousMatch.players.player.monster_zone[0].card_id = targetCardId;
    const previousGame = mapDuelMatch(previousMatch);
    const resolvedMatch = matchFixture();
    resolvedMatch.players.player.monster_zone[0].card_id = targetCardId;
    resolvedMatch.players.player.monster_zone[0].current_atk = 2800;
    resolvedMatch.players.player.monster_zone[0].current_def = 1600;
    resolvedMatch.players.ai.spell_trap_zone[index] = {
      instance_id: `equip-${index}`,
      card_id: cardId,
      category: 'spell',
      name: cardId,
      face_down: false,
      target_instance_id: 'field-1'
    };
    const resolvedGame = mapDuelMatch(resolvedMatch, previousGame);
    const stagedGame = stageEquipSpellResolution(
      previousGame,
      resolvedGame,
      'opp'
    );

    assert.equal(stagedGame.field.opp.st[index].id, cardId);
    assert.equal(stagedGame.field.me.mon[0].atk, 2500);
    assert.equal(stagedGame.field.me.mon[0].def, 1200);
    assert.equal(resolvedGame.field.me.mon[0].atk, 2800);
    assert.equal(resolvedGame.field.me.mon[0].def, 1600);
  }
});

test('keeps a resolved hand Spell staged on the field until destruction animation finishes', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.hand = [{
    instance_id: 'tribute-equalizer',
    card_id: 's-counterbalance-card',
    category: 'spell',
    name: 'Ma Thuật Hiến Tế Công Bằng'
  }];
  const previousGame = mapDuelMatch(previousMatch);
  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.hand = [];
  resolvedMatch.players.player.hand_count = 0;
  resolvedMatch.players.player.graveyard = [{
    instance_id: 'tribute-equalizer',
    card_id: 's-counterbalance-card',
    category: 'spell',
    name: 'Ma Thuật Hiến Tế Công Bằng'
  }];

  const stagedGame = stageSpellTrapActivation(previousGame, resolvedMatch, {
    type: 'activate_effect',
    source_instance_id: 'tribute-equalizer'
  });

  assert.equal(stagedGame.busy, true);
  assert.equal(stagedGame.field.me.st[0].instance_id, 'tribute-equalizer');
  assert.equal(stagedGame.field.me.st[0].faceDown, false);
  assert.equal(stagedGame.hand.me.length, 0);
  assert.equal(
    stagedGame.grave.me.some((card) => card?.instance_id === 'tribute-equalizer'),
    false
  );
});

test('stages a flipped Trap and ignores activations whose card is no longer on the field', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.spell_trap_zone[1] = {
    instance_id: 'trap-activation',
    card_id: 't-test-trap',
    category: 'trap',
    name: 'Test Trap',
    face_down: true
  };
  const previousGame = mapDuelMatch(previousMatch);
  const activationMatch = matchFixture();
  activationMatch.players.player.spell_trap_zone[1] = {
    instance_id: 'trap-activation',
    card_id: 't-test-trap',
    category: 'trap',
    name: 'Test Trap',
    face_down: false
  };
  activationMatch.chain = { status: 'open', links: [{}] };

  const stagedGame = stageSpellTrapActivation(previousGame, activationMatch, {
    type: 'activate_effect',
    source_instance_id: 'trap-activation'
  });
  const resolvedMatch = matchFixture();

  assert.equal(stagedGame.field.me.st[1].faceDown, false);
  assert.equal(
    stageSpellTrapActivation(previousGame, resolvedMatch, {
      type: 'activate_effect',
      source_instance_id: 'trap-activation'
    }),
    null
  );
});

test('stages control spells on the field, then tracks monsters moving and returning', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.hand = [{
    instance_id: 'brain-control-1',
    card_id: 's-brain-control',
    category: 'spell',
    name: 'Tẩy Não'
  }];
  previousMatch.players.player.hand_count = 1;
  previousMatch.players.ai.monster_zone[0] = {
    instance_id: 'borrowed-monster',
    card_id: 'enemy-monster',
    category: 'monster',
    name: 'Quái thú đối thủ',
    face_down: false
  };
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.hand = [];
  resolvedMatch.players.player.hand_count = 0;
  resolvedMatch.players.player.graveyard = [{
    instance_id: 'brain-control-1',
    card_id: 's-brain-control',
    category: 'spell',
    name: 'Tẩy Não'
  }];
  resolvedMatch.players.player.monster_zone[1] = {
    instance_id: 'borrowed-monster',
    card_id: 'enemy-monster',
    category: 'monster',
    name: 'Quái thú đối thủ',
    face_down: false,
    temporary_control: { return_to: 'ai', zone_index: 0, turn: 2 }
  };
  resolvedMatch.players.ai.monster_zone[0] = null;
  const finalGame = mapDuelMatch(resolvedMatch, previousGame);
  assert.equal(finalGame.field.me.mon[1]._motion, undefined);
  assert.equal(hasNewlySummonedMonster(previousGame, finalGame), false);

  const activationStage = stageSpellTrapActivation(
    previousGame,
    resolvedMatch,
    { type: 'activate_effect', source_instance_id: 'brain-control-1' }
  );
  assert.equal(activationStage.field.me.st[0].id, 's-brain-control');
  assert.equal(activationStage.grave.me.some(
    (card) => card.instance_id === 'brain-control-1'
  ), false);
  assert.equal(activationStage.field.opp.mon[0].instance_id, 'borrowed-monster');
  assert.equal(activationStage.field.me.mon[1], null);

  const changeOfHeartPreviousMatch = matchFixture();
  changeOfHeartPreviousMatch.players.player.hand = [{
    instance_id: 'change-of-heart-1',
    card_id: 's-change-of-heart',
    category: 'spell',
    name: 'Trái Tim Hoán Đổi'
  }];
  changeOfHeartPreviousMatch.players.ai.monster_zone[0] = {
    instance_id: 'heart-target',
    card_id: 'enemy-monster',
    category: 'monster',
    name: 'Quái thú đối thủ',
    face_down: false
  };
  const changeOfHeartPrevious = mapDuelMatch(changeOfHeartPreviousMatch);
  const changeOfHeartResolved = matchFixture();
  changeOfHeartResolved.players.player.hand = [];
  changeOfHeartResolved.players.player.graveyard = [{
    instance_id: 'change-of-heart-1',
    card_id: 's-change-of-heart',
    category: 'spell',
    name: 'Trái Tim Hoán Đổi'
  }];
  changeOfHeartResolved.players.player.monster_zone[1] = {
    instance_id: 'heart-target',
    card_id: 'enemy-monster',
    category: 'monster',
    name: 'Quái thú đối thủ',
    face_down: false,
    temporary_control: { return_to: 'ai', zone_index: 0, turn: 2 }
  };
  changeOfHeartResolved.players.ai.monster_zone[0] = null;
  const changeOfHeartFinal = mapDuelMatch(
    changeOfHeartResolved,
    changeOfHeartPrevious
  );
  assert.equal(changeOfHeartFinal.field.me.mon[1]._motion, undefined);
  assert.equal(
    hasNewlySummonedMonster(changeOfHeartPrevious, changeOfHeartFinal),
    false
  );
  const changeOfHeartStage = stageSpellTrapActivation(
    changeOfHeartPrevious,
    changeOfHeartResolved,
    { type: 'activate_effect', source_instance_id: 'change-of-heart-1' }
  );
  assert.equal(changeOfHeartStage.field.me.st[0].id, 's-change-of-heart');
  assert.equal(changeOfHeartStage.field.opp.mon[0].instance_id, 'heart-target');

  const transfers = getTemporaryControlTransfers(activationStage, finalGame);
  assert.deepEqual(transfers, [{
    instanceId: 'borrowed-monster',
    fromSide: 'opp',
    fromIndex: 0,
    toSide: 'me',
    toIndex: 1
  }]);

  const transferStage = stageTemporaryControlTransfers(
    activationStage,
    finalGame
  );
  assert.equal(transferStage.stageGame.field.me.mon[1].instance_id, 'borrowed-monster');
  assert.equal(transferStage.stageGame.field.me.st[0].id, 's-brain-control');
  assert.equal(transferStage.stageGame.grave.me.some(
    (card) => card.instance_id === 'brain-control-1'
  ), false);
  assert.equal(transferStage.finalGame.grave.me[0].id, 's-brain-control');

  const returnedMatch = matchFixture();
  returnedMatch.players.player.monster_zone = [null, null, null, null, null];
  returnedMatch.players.ai.monster_zone[0] = {
    instance_id: 'borrowed-monster',
    card_id: 'enemy-monster',
    category: 'monster',
    name: 'Quái thú đối thủ',
    face_down: false
  };
  const returnedGame = mapDuelMatch(returnedMatch, finalGame);
  const returnTransfers = getTemporaryControlTransfers(finalGame, returnedGame);
  assert.deepEqual(returnTransfers, [{
    instanceId: 'borrowed-monster',
    fromSide: 'me',
    fromIndex: 1,
    toSide: 'opp',
    toIndex: 0
  }]);
  const returnStage = stageTemporaryControlTransfers(finalGame, returnedGame);
  assert.equal(returnStage.stageGame.field.opp.mon[0].instance_id, 'borrowed-monster');
  assert.equal(returnStage.finalGame.field.opp.mon[0]._motion, undefined);
});

test('finds only cards destroyed by the selected Lightning Storm mode', () => {
  for (const [mode, kind] of [
    ['destroy_attack_monsters', 'mon'],
    ['destroy_spell_traps', 'st']
  ]) {
    const backendZone = kind === 'mon' ? 'monster_zone' : 'spell_trap_zone';
    const previousMatch = matchFixture();
    previousMatch.players.player.hand = [{
      instance_id: 'storm-1',
      card_id: 's-lightning-storm',
      category: 'spell',
      name: 'Tia Sét Hủy Diệt'
    }];
    previousMatch.players.ai[backendZone][0] = {
      instance_id: `destroyed-${kind}`,
      card_id: kind === 'mon' ? 'm-target' : 't-target',
      category: kind === 'mon' ? 'monster' : 'trap',
      name: 'Destroyed Target',
      position: 'attack',
      face_down: kind === 'st'
    };
    previousMatch.players.ai[backendZone][1] = {
      instance_id: `survivor-${kind}`,
      card_id: kind === 'mon' ? 'm-survivor' : 's-survivor',
      category: kind === 'mon' ? 'monster' : 'spell',
      name: 'Surviving Target',
      position: 'defense',
      face_down: kind === 'st'
    };
    const previousGame = mapDuelMatch(previousMatch);
    const resolvedMatch = matchFixture();
    resolvedMatch.players.player.hand = [];
    resolvedMatch.players.ai[backendZone][0] = null;
    resolvedMatch.players.ai[backendZone][1] = {
      ...previousMatch.players.ai[backendZone][1]
    };
    resolvedMatch.players.ai.graveyard = [{
      instance_id: `destroyed-${kind}`,
      card_id: kind === 'mon' ? 'm-target' : 't-target',
      category: kind === 'mon' ? 'monster' : 'trap',
      name: 'Destroyed Target'
    }];
    const updatedGame = mapDuelMatch(resolvedMatch, previousGame);

    assert.deepEqual(
      getLightningStormDestroyedZones(previousGame, updatedGame, {
        type: 'activate_effect',
        source_instance_id: 'storm-1',
        payload: { mode }
      }),
      [{ side: 'opp', kind, index: 0 }]
    );
  }
});

test('marks only the opposing side as attack-locked by active Swords of Revealing Light', () => {
  const fixture = matchFixture();
  fixture.players.ai.monster_zone[0].face_down = false;
  fixture.players.player.spell_trap_zone[0] = {
    instance_id: 'swords-player',
    card_id: 's-swords-of-revealing-light',
    category: 'spell',
    face_down: false
  };
  let game = mapDuelMatch(fixture);

  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'opp', game.field.opp.mon[0]),
    true
  );
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
    false
  );

  fixture.players.player.spell_trap_zone[0].face_down = true;
  game = mapDuelMatch(fixture);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'opp', game.field.opp.mon[0]),
    false
  );

  fixture.players.ai.spell_trap_zone[0] = {
    instance_id: 'swords-ai',
    card_id: 's-swords-of-revealing-light',
    category: 'spell',
    face_down: false
  };
  game = mapDuelMatch(fixture);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
    true
  );
});

test('marks only the targeted monster as locked by attack-preventing Spell/Traps', () => {
  for (const cardId of [
    't-spellbinding-circle',
    't-shadow-spell',
    't-nightmare-wheel',
    's-mask-of-the-accursed'
  ]) {
    const fixture = matchFixture();
    fixture.players.player.monster_zone[1] = {
      instance_id: 'field-2',
      card_id: 'm-second',
      category: 'monster',
      name: 'Second Monster',
      atk: 1500,
      def: 1000,
      face_down: false
    };
    fixture.players.ai.spell_trap_zone[0] = {
      instance_id: `lock-${cardId}`,
      card_id: cardId,
      category: cardId.startsWith('t-') ? 'trap' : 'spell',
      face_down: false,
      target_instance_id: 'field-1'
    };
    const game = mapDuelMatch(fixture);

    assert.equal(
      isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
      true,
      cardId
    );
    assert.equal(
      isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[1]),
      false,
      cardId
    );
  }
});

test('marks only level 4 or higher opposing monsters as locked by Gravity Bind', () => {
  const fixture = matchFixture();
  fixture.players.player.monster_zone[0].level = 4;
  fixture.players.ai.spell_trap_zone[0] = {
    instance_id: 'gravity-bind',
    card_id: 't-gravity-bind',
    category: 'trap',
    face_down: false
  };
  let game = mapDuelMatch(fixture);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
    true
  );

  fixture.players.player.monster_zone[0].level = 3;
  game = mapDuelMatch(fixture);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
    false
  );

  fixture.players.player.monster_zone[0].level = 4;
  fixture.players.player.monster_zone[1] = {
    instance_id: 'jinzo-player',
    card_id: 'm-jinzo',
    category: 'monster',
    name: 'Jinzo',
    atk: 2400,
    def: 1500,
    face_down: false
  };
  game = mapDuelMatch(fixture);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'me', game.field.me.mon[0]),
    false
  );
});

test('animates the opening hand and only newly drawn cards in sequence', () => {
  const fixture = matchFixture();
  fixture.players.player.hand = Array.from({ length: 5 }, (_, index) => ({
    instance_id: `opening-${index}`,
    card_id: 'm-test',
    category: 'monster',
    name: 'Test Monster'
  }));
  fixture.players.player.hand_count = 5;
  fixture.players.ai.hand_count = 5;
  const openingGame = mapDuelMatch(fixture);

  assert.deepEqual(
    openingGame.hand.me.map((card) => card._motionDelay),
    [0, 300, 600, 900, 1200]
  );
  assert.deepEqual(
    openingGame.hand.opp.map((card) => card._motionDelay),
    [0, 300, 600, 900, 1200]
  );

  fixture.players.player.hand.push(
    { instance_id: 'drawn-1', card_id: 'm-test', category: 'monster', name: 'Test Monster' },
    { instance_id: 'drawn-2', card_id: 'm-test', category: 'monster', name: 'Test Monster' }
  );
  fixture.players.player.hand_count = 7;
  const updatedGame = mapDuelMatch(fixture, openingGame);

  assert.equal(updatedGame.hand.me[0]._motion, undefined);
  assert.match(updatedGame.hand.me[5]._motion, /^drawn-1-\d+-draw$/);
  assert.equal(updatedGame.hand.me[5]._motionDelay, 0);
  assert.equal(updatedGame.hand.me[6]._motionDelay, 300);
});

test('stages the AI draw and summon before showing the player turn draw', () => {
  const previousMatch = matchFixture({
    turn: 2,
    phase: 'end',
    drawn_this_turn: true
  });
  const previousGame = mapDuelMatch(previousMatch);
  const finalMatch = JSON.parse(JSON.stringify(previousMatch));
  finalMatch.turn = 4;
  finalMatch.turn_player = 'player';
  finalMatch.phase = 'draw';
  finalMatch.players.player.hand.push({
    instance_id: 'player-draw',
    card_id: 'm-test',
    category: 'monster',
    name: 'Drawn Monster'
  });
  finalMatch.players.player.hand_count = 2;
  finalMatch.players.player.deck_count = 34;
  finalMatch.players.ai.monster_zone[1] = {
    instance_id: 'ai-summon',
    card_id: 'm-ai-summon',
    category: 'monster',
    face_down: false,
    position: 'attack'
  };
  finalMatch.players.ai.hand_count = 4;

  const stages = createAiTurnStages(previousGame, finalMatch);

  assert.ok(stages);
  assert.equal(stages.drawStage.turn, 'opp');
  assert.equal(stages.drawStage.hand.opp.length, 5);
  assert.match(stages.drawStage.hand.opp[4]._motion, /-draw$/);
  assert.equal(stages.boardStage.turn, 'opp');
  assert.equal(stages.boardStage.hand.me.length, 1);
  assert.match(stages.boardStage.field.opp.mon[1]._motion, /-summon$/);

  const playerTurn = mapDuelMatch(finalMatch, stages.boardStage);
  assert.equal(playerTurn.turn, 'me');
  assert.match(playerTurn.hand.me[1]._motion, /-draw$/);
});

test('detects a newly revealed AI Spell or Trap activation for card reveal', () => {
  const previousMatch = matchFixture({
    turn: 3,
    turn_player: 'ai',
    phase: 'main1'
  });
  previousMatch.players.ai.spell_trap_zone[2] = {
    instance_id: 'ai-activated',
    card_id: 't-ai-trap',
    category: 'trap',
    name: 'Bẫy AI',
    face_down: true
  };
  const previousGame = mapDuelMatch(previousMatch);
  const stageMatch = matchFixture({
    turn: 3,
    turn_player: 'ai',
    phase: 'main1'
  });
  stageMatch.players.ai.spell_trap_zone[2] = {
    instance_id: 'ai-activated',
    card_id: 't-ai-trap',
    category: 'trap',
    name: 'Bẫy AI',
    face_down: false
  };
  const stageGame = mapDuelMatch(stageMatch, previousGame);

  assert.deepEqual(getAiActivatedSpellTrap(previousGame, stageGame), {
    card: stageGame.field.opp.st[2],
    index: 2
  });
});

test('detects an AI spell activated from hand and sent to the Graveyard', () => {
  const previousMatch = matchFixture({
    turn: 3,
    turn_player: 'ai',
    phase: 'main1'
  });
  const previousGame = mapDuelMatch(previousMatch);
  const stageMatch = matchFixture({
    turn: 3,
    turn_player: 'ai',
    phase: 'main1'
  });
  stageMatch.players.ai.graveyard = [{
    instance_id: 'ai-raigeki',
    card_id: 's-raigeki',
    category: 'spell',
    name: 'Raigeki'
  }];
  stageMatch.players.ai.hand_count = 3;
  const stageGame = mapDuelMatch(stageMatch, previousGame);

  assert.deepEqual(getAiActivatedSpellTrap(previousGame, stageGame), {
    card: stageGame.grave.opp[0],
    index: 1,
    source: 'hand'
  });
});

test('finds AI hand discards from a staged discard action without exposing its hand', () => {
  const discardedCard = {
    instance_id: 'ai-discard',
    card_id: 'm-cost',
    category: 'monster'
  };
  const previousGame = {
    hand: { opp: [{ id: 'opp-hand-0' }, { id: 'opp-hand-1' }] },
    grave: { opp: [{ instance_id: 'old-grave-card' }] }
  };
  const stageGame = {
    hand: { opp: [{ id: 'opp-hand-0' }] },
    grave: {
      opp: [
        { instance_id: 'old-grave-card' },
        discardedCard
      ]
    }
  };

  assert.deepEqual(getAiDiscardedCards(previousGame, stageGame), [discardedCard]);
  assert.deepEqual(getAiDiscardedCards(stageGame, previousGame), []);
});

test('finds AI-stage field cards moved to the Graveyard for destruction motion', () => {
  const previousGame = mapDuelMatch(matchFixture());
  const stageMatch = matchFixture();
  stageMatch.players.player.monster_zone[0] = null;
  stageMatch.players.player.graveyard = [{
    instance_id: 'field-1',
    card_id: 'm-field',
    category: 'monster',
    name: 'Field Monster',
    atk: 2000,
    def: 1200
  }];
  const stageGame = mapDuelMatch(stageMatch, previousGame);

  assert.deepEqual(getAiDestroyedFieldCards(previousGame, stageGame), [
    { side: 'me', kind: 'mon', index: 0, instanceId: 'field-1' }
  ]);
});

test('maps each recorded AI move into a separate animated board stage', () => {
  const previousMatch = matchFixture({
    turn: 2,
    turn_player: 'player',
    phase: 'end'
  });
  const previousGame = mapDuelMatch(previousMatch);
  const drawMatch = JSON.parse(JSON.stringify(previousMatch));
  drawMatch.turn = 3;
  drawMatch.turn_player = 'ai';
  drawMatch.phase = 'draw';
  drawMatch.players.ai.hand_count = 5;
  drawMatch.players.ai.deck_count = 29;

  const summonMatch = JSON.parse(JSON.stringify(drawMatch));
  summonMatch.phase = 'main1';
  summonMatch.players.ai.monster_zone[1] = {
    instance_id: 'ai-summon',
    card_id: 'm-ai-summon',
    category: 'monster',
    name: 'AI Monster',
    face_down: false,
    position: 'attack'
  };
  const setMatch = JSON.parse(JSON.stringify(summonMatch));
  setMatch.players.ai.spell_trap_zone[1] = {
    instance_id: 'ai-set',
    card_id: 't-ai-set',
    category: 'trap',
    name: 'AI Trap',
    face_down: true
  };
  const finalMatch = JSON.parse(JSON.stringify(setMatch));
  finalMatch.turn = 4;
  finalMatch.turn_player = 'player';
  finalMatch.phase = 'draw';
  finalMatch.players.player.hand.push({
    instance_id: 'player-draw',
    card_id: 'm-test',
    category: 'monster',
    name: 'Drawn Monster'
  });
  finalMatch.players.player.hand_count = 2;
  finalMatch.players.player.deck_count = 34;

  const stages = createAiTurnStages(previousGame, finalMatch, [
    { type: 'draw', match: drawMatch },
    { type: 'summon', match: summonMatch },
    { type: 'set', match: setMatch }
  ]);

  assert.deepEqual(stages.actionStages.map((stage) => stage.type), [
    'draw',
    'summon',
    'set'
  ]);
  assert.match(stages.actionStages[0].game.hand.opp[4]._motion, /-draw$/);
  assert.match(
    stages.actionStages[1].game.field.opp.mon[1]._motion,
    /-summon$/
  );
  assert.match(stages.actionStages[2].game.field.opp.st[1]._motion, /-summon$/);
  const playerTurn = mapDuelMatch(finalMatch, stages.boardStage);
  assert.match(playerTurn.hand.me[1]._motion, /-draw$/);
});

test('detects deck-to-Graveyard movement within an individual AI stage', () => {
  const before = {
    deck: { me: [], opp: [{ instance_id: 'deck-1' }, { instance_id: 'deck-2' }] },
    grave: { me: [], opp: [] }
  };
  const standbyStage = {
    deck: { me: [], opp: [] },
    grave: { me: [], opp: [{ instance_id: 'deck-2' }, { instance_id: 'deck-1' }] }
  };

  assert.deepEqual(getMillCountsBetweenStages(before, standbyStage), [
    { side: 'opp', count: 2 }
  ]);
  assert.deepEqual(getMillCountsBetweenStages(standbyStage, standbyStage), []);
});

test('does not treat a field tribute as milling when its effect summons from the Deck', () => {
  const before = {
    deck: { me: [{ instance_id: 'deck-blue-eyes' }], opp: [] },
    grave: { me: [], opp: [] },
    hand: { me: [], opp: [] },
    field: {
      me: { mon: [{ instance_id: 'kaibaman' }], st: [] },
      opp: { mon: [], st: [] }
    },
    banished: { me: [], opp: [] },
    extraDeck: { me: [], opp: [] }
  };
  const after = {
    deck: { me: [], opp: [] },
    grave: { me: [{ instance_id: 'kaibaman' }], opp: [] },
    field: {
      me: { mon: [{ instance_id: 'blue-eyes' }], st: [] },
      opp: { mon: [], st: [] }
    }
  };

  assert.deepEqual(getMillCountsBetweenStages(before, after), []);
  after.grave.me.push({ instance_id: 'milled-card' });
  assert.deepEqual(getMillCountsBetweenStages(before, after), [
    { side: 'me', count: 1 }
  ]);
});

test('suppresses generic mill motion for Card Destruction hand discards', () => {
  const before = {
    deck: {
      me: Array.from({ length: 4 }, (_, index) => ({ id: `me-deck-${index}` })),
      opp: Array.from({ length: 5 }, (_, index) => ({ id: `opp-deck-${index}` }))
    },
    grave: { me: [], opp: [] }
  };
  const after = {
    deck: { me: [], opp: [] },
    grave: {
      me: Array.from({ length: 5 }, (_, index) => ({ id: `me-grave-${index}` })),
      opp: Array.from({ length: 5 }, (_, index) => ({ id: `opp-grave-${index}` }))
    }
  };

  assert.deepEqual(
    getMillCountsBetweenStages(before, after, ['me', 'opp']),
    []
  );
});

test('keeps Pot of Greed on the field until its two drawn cards finish animating', () => {
  const fixture = matchFixture();
  fixture.players.player.spell_trap_zone[0] = {
    instance_id: 'pot-1',
    card_id: 's-pot-of-greed',
    category: 'spell',
    name: 'Hũ Tham Lam',
    face_down: false
  };
  const previousGame = mapDuelMatch(fixture);
  fixture.players.player.hand.push(
    { instance_id: 'drawn-1', card_id: 'm-test', category: 'monster', name: 'Test Monster' },
    { instance_id: 'drawn-2', card_id: 'm-test', category: 'monster', name: 'Test Monster' }
  );
  fixture.players.player.graveyard = [{
    instance_id: 'pot-1',
    card_id: 's-pot-of-greed',
    category: 'spell',
    name: 'Hũ Tham Lam'
  }];
  fixture.players.player.spell_trap_zone[0] = null;
  const updatedGame = mapDuelMatch(fixture, previousGame);
  const stagedGame = stagePotOfGreedResolution(previousGame, updatedGame);
  const destructionStage = stageFieldDestructionResolution(
    previousGame,
    updatedGame
  );

  assert.ok(stagedGame);
  assert.ok(destructionStage);
  assert.equal(stagedGame.busy, true);
  assert.equal(stagedGame.field.me.st[0].instance_id, 'pot-1');
  assert.equal(stagedGame.grave.me.some((card) => card.instance_id === 'pot-1'), false);
  assert.equal(stagedGame.hand.me.length, previousGame.hand.me.length + 2);
  assert.equal(destructionStage.field.me.st[0].instance_id, 'pot-1');
  assert.equal(
    destructionStage.grave.me.some((card) => card.instance_id === 'pot-1'),
    false
  );
  assert.equal(updatedGame.grave.me[0].instance_id, 'pot-1');
  assert.equal(
    stageReloadResolution(stagedGame, updatedGame, 's-pot-of-greed'),
    null
  );
  assert.equal(
    stageReloadResolution(stagedGame, updatedGame, 's-card-destruction'),
    null
  );
});

test('stages a new summon after sequentially destroying tributes that share its zone', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.monster_zone[0] = {
    instance_id: 'tribute-1',
    card_id: 'm-tribute',
    category: 'monster',
    name: 'Tribute',
    face_down: false
  };
  const previousGame = mapDuelMatch(previousMatch);
  const resolvedMatch = JSON.parse(JSON.stringify(previousMatch));
  resolvedMatch.players.player.monster_zone[0] = {
    instance_id: 'summoned-1',
    card_id: 'm-summoned',
    category: 'monster',
    name: 'Summoned Monster',
    face_down: false,
    position: 'attack'
  };
  resolvedMatch.players.player.graveyard = [{
    instance_id: 'tribute-1',
    card_id: 'm-tribute',
    category: 'monster',
    name: 'Tribute'
  }];
  const resolvedGame = mapDuelMatch(resolvedMatch, previousGame);
  const summonStage = stageMonsterSummonResolution(previousGame, resolvedGame);
  const destructionStage = stageFieldDestructionResolution(
    previousGame,
    summonStage
  );

  assert.ok(summonStage);
  assert.equal(summonStage.field.me.mon[0], null);
  assert.ok(destructionStage);
  assert.equal(destructionStage.field.me.mon[0].instance_id, 'tribute-1');
  assert.equal(destructionStage.grave.me.some((card) => card.instance_id === 'tribute-1'), false);
  assert.equal(resolvedGame.field.me.mon[0].instance_id, 'summoned-1');
});

test('stages Reload hand returns, shuffle, and redraw in order', () => {
  const fixture = matchFixture();
  fixture.players.player.hand = [
    {
      instance_id: 'reload-1',
      card_id: 's-reload',
      category: 'spell',
      name: 'Nạp Đạn'
    },
    { instance_id: 'returned-1', card_id: 'm-test', category: 'monster', name: 'Returned 1' },
    { instance_id: 'returned-2', card_id: 'm-test', category: 'monster', name: 'Returned 2' }
  ];
  fixture.players.player.hand_count = 3;
  fixture.players.player.deck_count = 30;
  const previousGame = mapDuelMatch(fixture);

  fixture.players.player.hand = [
    { instance_id: 'drawn-1', card_id: 'm-test', category: 'monster', name: 'Drawn 1' },
    { instance_id: 'drawn-2', card_id: 'm-test', category: 'monster', name: 'Drawn 2' }
  ];
  fixture.players.player.hand_count = 2;
  fixture.players.player.graveyard = [{
    instance_id: 'reload-1',
    card_id: 's-reload',
    category: 'spell',
    name: 'Nạp Đạn'
  }];
  const activationStage = stageReloadActivation(
    previousGame,
    stageSpellTrapActivation(previousGame, fixture, {
      type: 'activate_effect',
      source_instance_id: 'reload-1'
    }),
    'reload-1'
  );
  const updatedGame = mapDuelMatch(fixture, activationStage);
  const stages = stageReloadResolution(
    activationStage,
    updatedGame,
    's-reload'
  );

  assert.deepEqual(
    activationStage.hand.me.map((card) => card.instance_id),
    ['returned-1', 'returned-2']
  );
  assert.equal(activationStage.deck.me.length, 30);
  assert.equal(activationStage.field.me.st[0].instance_id, 'reload-1');
  assert.equal(stages.returnedCount, 2);
  assert.equal(stages.drawnCount, 2);
  assert.equal(stages.shuffleStage.hand.me.length, 0);
  assert.equal(stages.shuffleStage.deck.me.length, 32);
  assert.deepEqual(
    stages.drawStage.hand.me.map((card) => card.instance_id),
    ['drawn-1', 'drawn-2']
  );
  assert.ok(stages.drawStage.hand.me.every((card) => /-draw$/.test(card._motion)));
  assert.equal(stages.drawStage.deck.me.length, 30);
});

test('stages the AI Reload hand return, shuffle, and hidden redraw', () => {
  const fixture = matchFixture();
  fixture.players.ai.hand_count = 4;
  fixture.players.ai.deck_count = 30;
  const previousGame = mapDuelMatch(fixture);

  fixture.players.ai.hand_count = 3;
  fixture.players.ai.graveyard = [{
    instance_id: 'ai-reload-1',
    card_id: 's-reload',
    category: 'spell',
    name: 'Nạp Đạn'
  }];
  const updatedGame = mapDuelMatch(fixture, previousGame);
  const stages = stageAiReloadResolution(previousGame, updatedGame, 1);

  assert.equal(stages.activationStage.hand.opp.length, 3);
  assert.equal(stages.activationStage.deck.opp.length, 30);
  assert.equal(stages.shuffleStage.hand.opp.length, 0);
  assert.equal(stages.shuffleStage.deck.opp.length, 33);
  assert.equal(stages.drawStage.hand.opp.length, 3);
  assert.ok(stages.drawStage.hand.opp.every((card) => card.faceDown));
  assert.ok(stages.drawStage.hand.opp.every((card) => /-draw$/.test(card._motion)));
  assert.equal(stages.drawStage.deck.opp.length, 30);
});

test('animates the opponent redraw when Card Destruction keeps its hand count unchanged', () => {
  const fixture = matchFixture();
  fixture.players.player.hand = [
    {
      instance_id: 'card-destruction',
      card_id: 's-card-destruction',
      category: 'spell',
      name: 'Hủy Diệt Bài Trên Tay'
    },
    {
      instance_id: 'player-discard',
      card_id: 'm-test',
      category: 'monster',
      name: 'Test Monster'
    }
  ];
  fixture.players.ai.hand_count = 2;
  fixture.players.ai.graveyard = [{
    instance_id: 'ai-discard-1',
    card_id: 'm-ai-1',
    category: 'monster',
    name: 'AI Monster 1'
  }, {
    instance_id: 'ai-discard-2',
    card_id: 'm-ai-2',
    category: 'monster',
    name: 'AI Monster 2'
  }];
  const previousGame = mapDuelMatch(fixture);

  fixture.players.player.hand = [{
    instance_id: 'player-draw',
    card_id: 'm-new',
    category: 'monster',
    name: 'New Monster'
  }];
  fixture.players.player.graveyard = [
    ...fixture.players.player.graveyard,
    {
      instance_id: 'card-destruction',
      card_id: 's-card-destruction',
      category: 'spell',
      name: 'Hủy Diệt Bài Trên Tay'
    },
    {
      instance_id: 'player-discard',
      card_id: 'm-test',
      category: 'monster',
      name: 'Test Monster'
    }
  ];
  fixture.players.ai.graveyard = [
    ...fixture.players.ai.graveyard,
    {
      instance_id: 'ai-discard-3',
      card_id: 'm-ai-3',
      category: 'monster',
      name: 'AI Monster 3'
    },
    {
      instance_id: 'ai-discard-4',
      card_id: 'm-ai-4',
      category: 'monster',
      name: 'AI Monster 4'
    }
  ];
  fixture.players.ai.hand_count = 2;

  const action = {
    type: 'activate_effect',
    source_instance_id: 'card-destruction'
  };
  assert.equal(didResolveCardDestruction(previousGame, fixture, action), true);

  const updatedGame = mapDuelMatch(fixture, previousGame, {
    forceRedrawSides: ['opp']
  });
  const discardStage = stageCardDestructionResolution(updatedGame);
  assert.equal(discardStage.busy, true);
  assert.equal(discardStage.hand.me.length, 0);
  assert.equal(discardStage.hand.opp.length, 0);
  assert.deepEqual(
    updatedGame.hand.opp.map((card) => card._motionDelay),
    [0, 300]
  );
  assert.notEqual(updatedGame.hand.opp[0]._motion, previousGame.hand.opp[0]._motion);
});

test('displays the Alternative Blue-Eyes name alias while it is on the field', () => {
  const fixture = matchFixture();
  fixture.players.player.monster_zone[0] = {
    instance_id: 'alternative-1',
    card_id: 'm-blue-eyes-alternative-white-dragon',
    category: 'monster',
    name: 'Rồng Trắng Mắt Xanh Thay Thế',
    name_alias: 'Rồng Trắng Mắt Xanh',
    face_down: false
  };

  const game = mapDuelMatch(fixture);

  assert.equal(game.field.me.mon[0].name, 'Rồng Trắng Mắt Xanh');
});

test('maps revealed battle state so the player can review it before resolution', () => {
  const match = matchFixture({
    pending_battle: {
      attacker_player: 'player',
      attacker_instance_id: 'attacker-1',
      defender_instance_id: 'defender-1',
      awaiting_resolution: true,
      revealed_face_down: true
    }
  });
  match.players.ai.monster_zone[0] = {
    instance_id: 'defender-1',
    card_id: 'm-hidden-defender',
    category: 'monster',
    name: 'Quái thú úp',
    atk: 1000,
    def: 1500,
    face_down: false,
    position: 'defense'
  };
  const game = mapDuelMatch(match);

  assert.deepEqual(game.pendingBattle, {
    attackerInstanceId: 'attacker-1',
    defenderInstanceId: 'defender-1',
    awaitingResolution: true,
    revealedFaceDown: true
  });
  assert.equal(game.field.opp.mon[0].faceDown, false);
  assert.equal(game.field.opp.mon[0].def, 1500);
});

test('does not treat empty opponent zones as a face-down battle defender', () => {
  const game = {
    pendingBattle: null,
    field: { opp: { mon: Array(5).fill(null) } }
  };

  assert.deepEqual(
    getBattleDefenderState(game, { type: 'advance_phase' }),
    { instanceId: undefined, faceDown: false }
  );
});

test('maps pending discard decisions without exposing hidden opponent cards', () => {
  const game = mapDuelMatch(matchFixture({
    pending_decision: {
      type: 'discard',
      player: 'player',
      count: 2,
      source_instance_id: 'hand-1'
    }
  }));

  assert.equal(game.effectMode, 'discard-for-effect');
  assert.equal(game.pendingDiscardCount, 2);
  assert.equal(game.pendingEffect.card.id, 'm-test');
  assert.equal(game.hand.opp[0].id, 'opp-hand-0');
});

test('maps Tricky cost selection into the shared discard UI', () => {
  const game = mapDuelMatch(matchFixture({
    pending_decision: {
      type: 'tricky_discard',
      player: 'player',
      count: 1,
      source_instance_id: 'hand-1'
    }
  }));

  assert.equal(game.effectMode, 'discard-for-effect');
  assert.equal(game.pendingDiscardCount, 1);
  assert.equal(game.pendingDecision.type, 'tricky_discard');
  assert.equal(game.pendingEffect.card.id, 'm-test');
});

test('maps both spell-recovery costs into the discard UI', () => {
  const fixture = matchFixture();
  fixture.players.player.hand = [{
    instance_id: 'recovery-source',
    card_id: 's-spell-reproduction',
    category: 'spell',
    name: 'Sao Chép Ma Thuật'
  }];
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'spell_recovery_discard',
      player: 'player',
      count: 2,
      source_instance_id: 'recovery-source',
      effect_card_id: 's-spell-reproduction',
      discard_category: 'spell'
    }
  });

  assert.equal(game.effectMode, 'discard-for-effect');
  assert.equal(game.pendingDiscardCount, 2);
  assert.equal(game.pendingEffect.card.id, 's-spell-reproduction');
});

test('maps spell-recovery Graveyard selection from the Spell/Trap Zone', () => {
  const fixture = matchFixture();
  fixture.players.player.spell_trap_zone[0] = {
    instance_id: 'recovery-source',
    card_id: 's-magical-stone-excavation',
    category: 'spell',
    name: 'Đá Ma Thuật Phát Sáng'
  };
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_graveyard_card',
      player: 'player',
      count: 1,
      source_instance_id: 'recovery-source',
      effect_card_id: 's-magical-stone-excavation',
      target_mode: 'grave-own-any'
    }
  });

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.card.id, 's-magical-stone-excavation');
  assert.equal(game.pendingEffect.targetMode, 'grave-own-any');
  assert.equal(game.pendingEffect.minTargets, 1);
  assert.equal(game.pendingEffect.maxTargets, 1);
});

test('maps Magical Dimension hand and field choices into the targeted-effect UI', () => {
  const fixture = matchFixture();
  fixture.players.player.spell_trap_zone[0] = {
    instance_id: 'dimension-source',
    card_id: 's-magical-dimension',
    category: 'spell',
    name: 'Quan Tài Của Phù Thủy',
    face_down: false
  };
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'dimension-source',
      effect_card_id: 's-magical-dimension',
      selection_stage: 'summon',
      min_count: 1,
      max_count: 1,
      target_mode: 'hand-spellcaster'
    }
  });

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.targetMode, 'hand-spellcaster');
  assert.equal(game.pendingEffect.singleTarget, true);
  assert.equal(game.pendingEffect.card.id, 's-magical-dimension');

  const destructionGame = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'dimension-source',
      effect_card_id: 's-magical-dimension',
      selection_stage: 'destroy',
      min_count: 0,
      max_count: 1,
      target_mode: 'field-opponent-monster',
      target_player: 'ai'
    }
  });
  assert.equal(destructionGame.pendingEffect.targetMode, 'field-opponent-monster');
  assert.equal(destructionGame.pendingEffect.targetSide, 'opp');
});

test('maps optional Magicat Spell search choices into the targeted-effect UI', () => {
  const fixture = matchFixture();
  fixture.players.player.graveyard = [{
    instance_id: 'magicat-source',
    card_id: 'm-magicat',
    category: 'monster',
    name: 'Mèo Ma Thuật'
  }];
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_deck_card',
      player: 'player',
      source_instance_id: 'magicat-source',
      effect_card_id: 'm-magicat',
      min_count: 0,
      max_count: 1,
      target_mode: 'deck-own-spell',
      eligible_cards: [{
        instance_id: 'deck-spell',
        card_id: 's-target-spell',
        name: 'Lá Phép được chọn'
      }]
    }
  });

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.targetMode, 'deck-own-spell');
  assert.equal(game.pendingEffect.singleTarget, true);
  assert.equal(game.pendingEffect.card.id, 'm-magicat');
  assert.equal(game.pendingDecision.eligible_cards[0].name, 'Lá Phép được chọn');
});

test('maps optional Mana destruction trigger choices from the Graveyard to the duel UI', () => {
  const fixture = matchFixture();
  fixture.players.player.banished = [{
    instance_id: 'mana-source',
    card_id: 'm-palladium-oracle-mana',
    category: 'monster',
    name: 'Thần Quan Mana'
  }];
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_deck_card',
      player: 'player',
      source_instance_id: 'mana-source',
      effect_card_id: 'm-palladium-oracle-mana',
      min_count: 0,
      max_count: 1,
      target_mode: 'mana-dark-magician-girl-summon',
      eligible_cards: [{
        instance_id: 'dark-magician-girl',
        card_id: 'm-dark-magician-girl',
        name: 'Nữ Phù Thủy Bóng Đêm',
        zone: 'deck'
      }]
    }
  });

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.targetMode, 'mana-dark-magician-girl-summon');
  assert.equal(game.pendingEffect.singleTarget, true);
  assert.equal(game.pendingEffect.card.id, 'm-palladium-oracle-mana');
  assert.equal(
    game.pendingDecision.eligible_cards[0].card_id,
    'm-dark-magician-girl'
  );
});

test('maps Mobius field selection and preserves hidden Spell/Trap target identity only', () => {
  const game = mapDuelMatch(matchFixture({
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      max_count: 2,
      source_instance_id: 'field-1'
    },
    players: {
      ...matchFixture().players,
      ai: {
        ...matchFixture().players.ai,
        spell_trap_zone: [{
          instance_id: 'hidden-st-1',
          face_down: true
        }, null, null, null, null]
      }
    }
  }));

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.card.id, 'm-field');
  assert.equal(game.pendingEffect.targetMode, 'field-spell-trap');
  assert.equal(game.pendingEffect.maxTargets, 2);
  assert.equal(game.field.opp.st[0].instance_id, 'hidden-st-1');
  assert.equal(game.field.opp.st[0].id, undefined);
});

test('maps Twin Twisters selection to the opponent Spell/Trap Zone only', () => {
  const fixture = matchFixture();
  fixture.players.player.spell_trap_zone = [{
    instance_id: 'twin-source',
    card_id: 's-twin-twisters',
    category: 'spell',
    name: 'Song Bão',
    face_down: false
  }, null, null, null, null];
  fixture.players.ai.spell_trap_zone = [{
    instance_id: 'opponent-backrow',
    face_down: true
  }, null, null, null, null];
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'twin-source',
      effect_card_id: 's-twin-twisters',
      min_count: 1,
      max_count: 2,
      target_mode: 'field-opponent-spell-trap'
    }
  });

  assert.equal(game.pendingEffect.targetMode, 'field-opponent-spell-trap');
  assert.equal(game.pendingEffect.minTargets, 1);
  assert.equal(game.pendingEffect.maxTargets, 2);
  assert.equal(game.pendingEffect.singleTarget, false);
  assert.equal(game.pendingEffect.card.id, 's-twin-twisters');
});

test('maps Caius mandatory field target selection', () => {
  const game = mapDuelMatch(matchFixture({
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'field-1',
      effect_card_id: 'm-caius-the-shadow-monarch',
      min_count: 1,
      max_count: 1,
      target_mode: 'field-card',
      target_player: 'ai'
    }
  }));

  assert.equal(game.effectMode, 'targeted-effect');
  assert.equal(game.pendingEffect.targetMode, 'field-card');
  assert.equal(game.pendingEffect.minTargets, 1);
  assert.equal(game.pendingEffect.maxTargets, 1);
  assert.equal(game.pendingEffect.targetSide, 'opp');
});

test('maps Crass Clown selection to only opponent monsters', () => {
  const fixture = matchFixture();
  fixture.players.player.monster_zone[0].card_id = 'm-crass-clown';
  const game = mapDuelMatch({
    ...fixture,
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'field-1',
      effect_card_id: 'm-crass-clown',
      min_count: 1,
      max_count: 1,
      target_mode: 'field-opponent-monster',
      target_player: 'ai'
    }
  });

  assert.equal(game.pendingEffect.card.id, 'm-crass-clown');
  assert.equal(game.pendingEffect.targetMode, 'field-opponent-monster');
  assert.equal(game.pendingEffect.targetSide, 'opp');
});

test('maps Ryko field target selection without restricting either side', () => {
  const game = mapDuelMatch(matchFixture({
    pending_decision: {
      type: 'select_field_cards',
      player: 'player',
      source_instance_id: 'field-1',
      effect_card_id: 'm-ryko-lightsworn-hunter',
      min_count: 1,
      max_count: 1,
      target_mode: 'field-card-any'
    }
  }));

  assert.equal(game.pendingEffect.targetMode, 'field-card-any');
  assert.equal(game.pendingEffect.targetSide, null);
});

test('posts player actions to the server and returns its authoritative snapshot', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/duel/action');
    assert.equal(options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(options.body), {
      match_id: 'match-1',
      action: { type: 'draw' }
    });
    return {
      ok: true,
      json: async () => ({ match: { match_id: 'match-1' } })
    };
  };

  const result = await postDuelAction('match-1', { type: 'draw' });

  assert.equal(result.match.match_id, 'match-1');
});

test('surfaces server rule rejections instead of treating them as success', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: 'Hành động không hợp lệ.' })
  });

  await assert.rejects(
    postDuelAction('match-1', { type: 'draw' }),
    { message: 'Hành động không hợp lệ.' }
  );
});

test('stages Skull Dice and Graceful Dice stat changes before destruction and battle', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.monster_zone[0] = {
    instance_id: 'atk-1',
    card_id: 'm-blue-eyes',
    category: 'monster',
    name: 'Rồng Trắng Mắt Xanh',
    atk: 3000,
    current_atk: 3000,
    def: 2500,
    current_def: 2500,
    face_down: false
  };
  previousMatch.players.player.monster_zone[1] = {
    instance_id: 'ally-2',
    card_id: 'm-vorse-raider',
    category: 'monster',
    name: 'Vorse Raider',
    atk: 1900,
    current_atk: 1900,
    def: 1200,
    current_def: 1200,
    face_down: false
  };
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.monster_zone[0] = null;
  resolvedMatch.players.player.graveyard = [{
    ...previousMatch.players.player.monster_zone[0]
  }];
  resolvedMatch.players.player.monster_zone[1] = {
    ...previousMatch.players.player.monster_zone[1],
    current_atk: 950,
    current_def: 600
  };
  resolvedMatch.last_dice_roll = {
    seq: 4,
    value: 2,
    card_id: 't-skull-dice',
    player: 'ai',
    source_instance_id: 'trap-skull'
  };
  const resolvedGame = mapDuelMatch(resolvedMatch, previousGame);

  const stagedSkull = stageDiceStatModification(
    previousGame,
    resolvedGame,
    resolvedGame.lastDiceRoll
  );
  assert.ok(stagedSkull);
  assert.equal(stagedSkull.field.me.mon[0].atk, 1500);
  assert.equal(stagedSkull.field.me.mon[0].def, 1250);
  assert.equal(stagedSkull.field.me.mon[1].atk, 950);
  assert.equal(stagedSkull.field.me.mon[1].def, 600);

  const gracefulMatch = matchFixture();
  gracefulMatch.players.player.monster_zone[1] = {
    ...previousMatch.players.player.monster_zone[1],
    current_atk: 5700,
    current_def: 3600
  };
  gracefulMatch.last_dice_roll = {
    seq: 5,
    value: 3,
    card_id: 's-graceful-dice',
    player: 'player',
    source_instance_id: 'spell-graceful'
  };
  const gracefulResolvedGame = mapDuelMatch(gracefulMatch, previousGame);
  const stagedGraceful = stageDiceStatModification(
    previousGame,
    gracefulResolvedGame,
    gracefulResolvedGame.lastDiceRoll
  );
  assert.ok(stagedGraceful);
  assert.equal(stagedGraceful.field.me.mon[1].atk, 5700);
  assert.equal(stagedGraceful.field.me.mon[1].def, 3600);
});

test('detects Three-Humped Lacooda battle negation and draw-3 without battle damage', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.monster_zone[0] = {
    instance_id: 'p-lacooda',
    card_id: 'm-3-hump-lacooda',
    category: 'monster',
    name: 'Lạc Đà Ba Bướu',
    atk: 500,
    def: 1500,
    face_down: true,
    position: 'defense'
  };
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.monster_zone[0] = {
    ...previousMatch.players.player.monster_zone[0],
    face_down: false
  };
  resolvedMatch.players.player.hand = [
    { instance_id: 'd1', card_id: 'm-test-1', category: 'monster', name: 'D1' },
    { instance_id: 'd2', card_id: 'm-test-2', category: 'monster', name: 'D2' },
    { instance_id: 'd3', card_id: 'm-test-3', category: 'monster', name: 'D3' }
  ];
  const resolvedGame = mapDuelMatch(resolvedMatch, previousGame);

  const negation = getLacoodaBattleNegation(previousGame, resolvedGame, 'opp');
  assert.ok(negation);
  assert.equal(negation.side, 'me');
  assert.equal(negation.zoneIndex, 0);
  assert.equal(negation.card.faceDown, false);
});

test('marks monsters frozen by Blizzard Dragon as attack-locked until turn expires', () => {
  const match = matchFixture();
  match.turn = 3;
  match.players.ai.monster_zone[0] = {
    instance_id: 'opp-frozen',
    card_id: 'm-blue-eyes',
    category: 'monster',
    name: 'Rồng Trắng Mắt Xanh',
    atk: 3000,
    def: 2500,
    cannot_attack_until_turn: 4
  };
  const game = mapDuelMatch(match);
  assert.equal(
    isMonsterAttackLockedBySpellTrap(game, 'opp', game.field.opp.mon[0]),
    true
  );

  const expiredGame = { ...game, turnCount: 5 };
  assert.equal(
    isMonsterAttackLockedBySpellTrap(expiredGame, 'opp', expiredGame.field.opp.mon[0]),
    false
  );
});

test('stages destruction for stolen opponent monsters tributed into the opponent graveyard', () => {
  const previousMatch = matchFixture();
  previousMatch.players.player.monster_zone[0] = {
    instance_id: 'stolen-opp-mon',
    card_id: 'm-gamma-the-magnet-warrior',
    category: 'monster',
    name: 'Chiến Binh Nam Châm Gamma',
    owner: 'ai',
    controller: 'player',
    atk: 1500,
    def: 1800
  };
  const previousGame = mapDuelMatch(previousMatch);

  const resolvedMatch = matchFixture();
  resolvedMatch.players.player.monster_zone[0] = {
    instance_id: 'tribute-summon-mon',
    card_id: 'm-summoned-skull',
    category: 'monster',
    name: 'Ác Quỷ Đầu Lâu',
    owner: 'player',
    controller: 'player',
    atk: 2500,
    def: 1200
  };
  resolvedMatch.players.ai.graveyard = [{
    instance_id: 'stolen-opp-mon',
    card_id: 'm-gamma-the-magnet-warrior',
    category: 'monster',
    name: 'Chiến Binh Nam Châm Gamma',
    owner: 'ai',
    controller: 'ai'
  }];
  const updatedGame = mapDuelMatch(resolvedMatch, previousGame);

  const summonStage = stageMonsterSummonResolution(previousGame, updatedGame);
  const destructionStage = stageFieldDestructionResolution(
    previousGame,
    summonStage || updatedGame
  );

  assert.ok(summonStage);
  assert.ok(destructionStage);
  assert.equal(destructionStage.field.me.mon[0].instance_id, 'stolen-opp-mon');
  assert.equal(destructionStage.grave.opp.length, 0);

  const aiDestroyed = getAiDestroyedFieldCards(previousGame, updatedGame);
  assert.deepEqual(aiDestroyed, [{
    side: 'me',
    kind: 'mon',
    index: 0,
    instanceId: 'stolen-opp-mon'
  }]);
});

test('stages Slifer Thunderforce pre-trigger summon state before stat drop and destruction', () => {
  const previousMatch = matchFixture();
  previousMatch.players.ai.monster_zone = [null, null, null, null, null];
  previousMatch.players.player.monster_zone[0] = {
    instance_id: 'slifer-1',
    card_id: 'm-slifer-the-sky-dragon',
    category: 'monster',
    name: 'Thần Rồng Osiris',
    atk: 3000,
    def: 3000
  };
  const previousGame = mapDuelMatch(previousMatch);

  const destroyedMatch = matchFixture();
  destroyedMatch.players.ai.monster_zone = [null, null, null, null, null];
  destroyedMatch.players.player.monster_zone[0] = previousMatch.players.player.monster_zone[0];
  destroyedMatch.players.ai.graveyard = [{
    instance_id: 'ai-weak-summon',
    card_id: 'm-vorse-raider',
    category: 'monster',
    name: 'Kỵ Binh Vorse',
    atk: 1900,
    def: 1200
  }];
  destroyedMatch.last_slifer_triggers = [{
    seq: 1,
    slifer_player: 'player',
    slifer_instance_id: 'slifer-1',
    target_player: 'ai',
    target_instance_id: 'ai-weak-summon',
    target_zone_index: 0,
    stat: 'atk',
    pre_atk: 1900,
    pre_def: 1200,
    post_atk: 0,
    post_def: 1200,
    destroyed: true,
    monster: {
      instance_id: 'ai-weak-summon',
      card_id: 'm-vorse-raider',
      category: 'monster',
      name: 'Kỵ Binh Vorse',
      atk: 1900,
      def: 1200,
      current_atk: 1900,
      current_def: 1200
    }
  }];
  const destroyedGame = mapDuelMatch(destroyedMatch, previousGame);

  const preTriggerStage = stageSliferPreTriggerResolution(previousGame, destroyedGame, 0);
  assert.ok(preTriggerStage);
  assert.equal(preTriggerStage.field.opp.mon[0].instance_id, 'ai-weak-summon');
  assert.equal(preTriggerStage.field.opp.mon[0].atk, 1900);
  assert.match(preTriggerStage.field.opp.mon[0]._motion, /-summon$/);
  assert.equal(preTriggerStage.grave.opp.length, 0);

  const reduced = applySliferTriggerStatReduction(
    preTriggerStage,
    destroyedGame.lastSliferTriggers[0]
  );
  assert.equal(reduced.field.opp.mon[0].atk, 0);
});
