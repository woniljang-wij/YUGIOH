import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLifePointChange,
  applySliferSummonEffect,
  calculateBattle,
  calculateDirectAttack,
  calculateRaLifePointBoost,
  calculateRaTributeStats,
  canBeTargetedByEffects,
  getLegalActions,
  getRequiredTributes,
  hasFaceUpOpponentMonster,
  getSliferStats,
  getTributeValue,
  validateTributes
} from './duelRules.js';

function makeGame(overrides = {}) {
  return {
    ready: true,
    turn: 'me',
    firstPlayer: 'me',
    turnCount: 1,
    phaseIndex: 2,
    busy: false,
    over: false,
    firstTurn: true,
    drawnThisTurn: false,
    normalSummonUsed: { me: false, opp: false },
    attacked: { me: [], opp: [] },
    lp: { me: 8000, opp: 8000 },
    deck: { me: [], opp: [] },
    hand: { me: [], opp: [] },
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    },
    ...overrides
  };
}

test('Tẩy Não requires a face-up opposing monster before opening target selection', () => {
  const game = makeGame();
  assert.equal(hasFaceUpOpponentMonster(game), false);

  game.field.opp.mon[0] = { id: 'm-hidden', faceDown: true };
  assert.equal(hasFaceUpOpponentMonster(game), false);

  game.field.opp.mon[0] = { id: 'm-face-up', faceDown: false };
  assert.equal(hasFaceUpOpponentMonster(game), true);
});

test('tribute requirements follow the configured Battle City level bands', () => {
  assert.equal(getRequiredTributes({ level: 4 }), 0);
  assert.equal(getRequiredTributes({ level: 5 }), 1);
  assert.equal(getRequiredTributes({ level: 7 }), 2);
  assert.equal(getRequiredTributes({ level: 10 }), 3);
  assert.equal(getRequiredTributes({ id: 'm-obelisk-the-tormentor', level: 4 }), 3);
});

test('The Tricky can be Tribute Summoned normally when one tribute is available', () => {
  const game = makeGame({
    hand: {
      me: [{ id: 'm-the-tricky', type: 'monster', category: 'monster', level: 5 }],
      opp: []
    }
  });
  const getTrickyNormalSummons = () => getLegalActions(game).filter(
    (action) => action.type === 'normalSummon' && action.handIndex === 0
  );

  assert.equal(getTrickyNormalSummons().length, 0);
  game.field.me.mon[0] = { id: 'tribute', type: 'monster', category: 'monster' };
  assert.ok(getTrickyNormalSummons().some(
    (action) => action.tributeIndexes.length === 1 && action.tributeIndexes[0] === 0
  ));

  game.normalSummonUsed.me = true;
  assert.equal(getTrickyNormalSummons().length, 0);
});

test('Fusion monsters count as two tribute units without enabling Fusion Summon', () => {
  const fusion = { category: 'fusion', level: 4 };
  assert.equal(getTributeValue(fusion), 2);
  assert.deepEqual(validateTributes([fusion], 2), { valid: true, value: 2 });
  assert.deepEqual(validateTributes([fusion], 1), { valid: false, value: 2 });
});

test('Kaiser Seahorse and Double Coston count as two tributes only for matching attributes', () => {
  const seahorse = { id: 'm-kaiser-seahorse', type: 'monster', attribute: 'LIGHT' };
  const doubleCoston = { id: 'm-double-coston', type: 'monster', attribute: 'DARK' };
  const lightTarget = { id: 'light-level-seven', level: 7, attribute: 'LIGHT' };
  const darkTarget = { id: 'dark-level-seven', level: 7, attribute: 'DARK' };

  assert.equal(getTributeValue(seahorse, lightTarget), 2);
  assert.equal(getTributeValue(seahorse, darkTarget), 1);
  assert.equal(getTributeValue(doubleCoston, darkTarget), 2);
  assert.equal(getTributeValue(doubleCoston, lightTarget), 1);
  assert.equal(
    getTributeValue(seahorse, { level: 5, attribute: 'LIGHT' }),
    1
  );
  assert.deepEqual(validateTributes([seahorse], 2, lightTarget), { valid: true, value: 2 });
  assert.deepEqual(validateTributes([seahorse], 2, darkTarget), { valid: false, value: 1 });
});

test('legal summon actions use attribute-specific double tributes', () => {
  for (const [tributeId, targetAttribute] of [
    ['m-kaiser-seahorse', 'LIGHT'],
    ['m-double-coston', 'DARK']
  ]) {
    const game = makeGame({
      hand: {
        me: [{
          id: `m-level-seven-${targetAttribute}`,
          type: 'monster',
          category: 'monster',
          level: 7,
          attribute: targetAttribute
        }],
        opp: []
      },
      field: {
        me: {
          mon: [
            { id: tributeId, type: 'monster', category: 'monster', attribute: targetAttribute },
            null,
            null,
            null,
            null
          ],
          st: Array(5).fill(null)
        },
        opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
      }
    });

    const tributeSummons = getLegalActions(game)
      .filter((action) => action.type === 'normalSummon');
    assert.ok(tributeSummons.length > 0);
    assert.ok(tributeSummons.every((action) => action.tributeIndexes.length === 1));
    assert.ok(tributeSummons.every((action) => action.tributeIndexes[0] === 0));
  }
});

test('battle calculations handle attack, defense, ties, and piercing-free damage', () => {
  assert.deepEqual(calculateBattle({ atk: 2000 }, { atk: 1500 }), {
    destroyed: ['defender'],
    damage: { attacker: 0, defender: 500 }
  });
  assert.deepEqual(calculateBattle({ atk: 1500 }, { atk: 2000 }), {
    destroyed: ['attacker'],
    damage: { attacker: 500, defender: 0 }
  });
  assert.deepEqual(calculateBattle({ atk: 1800 }, { def: 1800 }, 'defense'), {
    destroyed: [],
    damage: { attacker: 0, defender: 0 }
  });
  assert.deepEqual(calculateBattle({ atk: 1000 }, { def: 1500 }, 'defense'), {
    destroyed: [],
    damage: { attacker: 500, defender: 0 }
  });
});

test('monster battle skills apply piercing and destruction protection', () => {
  assert.deepEqual(
    calculateBattle(
      { id: 'm-lancer-lindwurm', atk: 1900 },
      { id: 'm-wall', def: 1200, position: 'defense' },
      'defense'
    ),
    { destroyed: ['defender'], damage: { attacker: 0, defender: 700 } }
  );
  assert.deepEqual(
    calculateBattle(
      { id: 'm-attacker', atk: 2000 },
      { id: 'm-celtic-guardian', atk: 1400, def: 1200 },
      'attack'
    ),
    { destroyed: [], damage: { attacker: 0, defender: 600 } }
  );
  assert.deepEqual(
    calculateBattle(
      { id: 'm-attacker', atk: 1200 },
      { id: 'm-marshmallon', atk: 300, position: 'attack' },
      'attack'
    ),
    { destroyed: [], damage: { attacker: 0, defender: 900 } }
  );
});

test('direct attacks are blocked by any opposing monster', () => {
  assert.deepEqual(calculateDirectAttack({ atk: 2500 }, [null, { id: 'defender' }]), {
    legal: false,
    damage: 0
  });
  assert.deepEqual(calculateDirectAttack({ atk: 2500 }, [null, null]), {
    legal: true,
    damage: 2500
  });
});

test('Slifer scales with hand size and reduces the stat matching the summon posture', () => {
  assert.deepEqual(getSliferStats({ id: 'm-slifer-the-sky-dragon' }, 4), {
    atk: 4000,
    def: 4000
  });
  assert.deepEqual(applySliferSummonEffect({ atk: 1900, def: 2100 }, 'attack'), {
    monster: { atk: 0, def: 2100 },
    destroyed: true,
    stat: 'atk'
  });
  assert.deepEqual(applySliferSummonEffect({ atk: 1900, def: 2500 }, 'defense'), {
    monster: { atk: 1900, def: 500 },
    destroyed: false,
    stat: 'def'
  });
});

test('Ra tribute and LP effects preserve exact stats and leave 100 LP', () => {
  assert.deepEqual(calculateRaTributeStats([
    { atk: 1000, def: 500 },
    { atk: 1500, def: 1000 },
    { atk: 2000, def: 1500 }
  ]), { atk: 4500, def: 3000 });
  assert.deepEqual(calculateRaLifePointBoost(8000), {
    remainingLP: 100,
    atkBoost: 7900,
    defBoost: 7900
  });
  assert.equal(canBeTargetedByEffects({ id: 'm-obelisk-the-tormentor' }), false);
  assert.equal(canBeTargetedByEffects({ id: 'm-slifer-the-sky-dragon' }), true);
});

test('LP reaching zero ends the duel and identifies the winner', () => {
  const result = applyLifePointChange({ lp: { me: 8000, opp: 1000 } }, 'opp', 1000);
  assert.deepEqual(result.lp, { me: 8000, opp: 0 });
  assert.equal(result.over, true);
  assert.equal(result.winner, 'me');
});

test('legal action generation honors tribute cost and excludes Fusion Summon', () => {
  const game = makeGame({
    hand: {
      me: [
        { id: 'm-level-seven', name: 'Level Seven', type: 'monster', category: 'monster', level: 7 },
        { id: 'm-fusion', name: 'Fusion', type: 'monster', category: 'fusion', level: 4 }
      ],
      opp: []
    },
    field: {
      me: {
        mon: [
          { id: 'm-fusion-material', type: 'monster', category: 'fusion' },
          null,
          null,
          null,
          null
        ],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  const actions = getLegalActions(game);
  const tributeSummons = actions.filter((action) => action.type === 'normalSummon');
  assert.ok(tributeSummons.length > 0);
  assert.ok(tributeSummons.every((action) => action.tributeIndexes.length === 1));
  assert.ok(tributeSummons.every((action) => action.tributeIndexes[0] === 0));
  assert.equal(actions.some((action) => action.cardId === 'm-fusion'), false);
});

test('legal summon actions use a tributed zone when all five monster zones are full', () => {
  const game = makeGame({
    hand: {
      me: [{ id: 'm-level-five', type: 'monster', category: 'monster', level: 5 }],
      opp: []
    },
    field: {
      me: {
        mon: Array.from({ length: 5 }, (_, index) => ({ id: `m-${index}`, type: 'monster', category: 'monster' })),
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  const actions = getLegalActions(game).filter((action) => action.type === 'normalSummon');
  assert.deepEqual(actions.map((action) => action.zoneIndex), [0, 1, 2, 3, 4]);
});

test('legal actions enforce first-turn draw and end-phase hand limit', () => {
  const firstTurn = makeGame({ phaseIndex: 0, deck: { me: [{ id: 'deck-card' }], opp: [] } });
  assert.deepEqual(getLegalActions(firstTurn), [{ type: 'advancePhase' }]);

  const endPhase = makeGame({
    phaseIndex: 5,
    hand: { me: Array.from({ length: 7 }, (_, index) => ({ id: `hand-${index}` })), opp: [] }
  });
  const actions = getLegalActions(endPhase);
  assert.equal(actions.filter((action) => action.type === 'discard').length, 7);
  assert.equal(actions.some((action) => action.type === 'endTurn'), false);
});

test('legal battle actions allow direct attacks only when the opposing field is empty', () => {
  const game = makeGame({
    phaseIndex: 3,
    turnCount: 2,
    field: {
      me: {
        mon: [{ id: 'attacker', atk: 1800, position: 'attack' }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  assert.deepEqual(
    getLegalActions(game).filter((action) => action.type === 'attack'),
    [{ type: 'attack', attackerIndex: 0, targetIndex: null, direct: true }]
  );
  game.field.opp.mon[2] = { id: 'defender', atk: 1600, position: 'attack' };
  assert.deepEqual(
    getLegalActions(game).filter((action) => action.type === 'attack'),
    [{ type: 'attack', attackerIndex: 0, targetIndex: 2 }]
  );
});

test('Swords of Revealing Light blocks the opposing player from attacking', () => {
  const game = makeGame({
    turn: 'opp',
    phaseIndex: 3,
    field: {
      me: {
        mon: Array(5).fill(null),
        st: [{ id: 's-swords-of-revealing-light', faceDown: false }, null, null, null, null]
      },
      opp: {
        mon: [{ id: 'attacker', atk: 1800, position: 'attack' }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });

  assert.equal(getLegalActions(game).some((action) => action.type === 'attack'), false);
});

test('Gravity Bind prevents Level 4 and higher opponent monsters from attacking', () => {
  const game = makeGame({
    phaseIndex: 3,
    turnCount: 2,
    field: {
      me: {
        mon: [
          { id: 'level-four', level: 4, atk: 1800, position: 'attack' },
          { id: 'level-three', level: 3, atk: 1500, position: 'attack' },
          null,
          null,
          null
        ],
        st: Array(5).fill(null)
      },
      opp: {
        mon: Array(5).fill(null),
        st: [{ id: 't-gravity-bind', faceDown: false }, null, null, null, null]
      }
    }
  });

  assert.deepEqual(
    getLegalActions(game).filter((action) => action.type === 'attack').map((action) => action.attackerIndex),
    [1]
  );
});

test('Dragon Capture Jar prevents Dragons from changing battle position while active', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [{ id: 'my-dragon', race: 'Dragon', position: 'defense' }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: {
        mon: Array(5).fill(null),
        st: [{ id: 't-dragon-capture-jar', faceDown: false }, null, null, null, null]
      }
    }
  });

  assert.equal(getLegalActions(game).some((action) => action.type === 'changePosition'), false);
});
