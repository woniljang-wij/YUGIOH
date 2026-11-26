import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWinByExodia,
  getTargetMode,
  resolveAttackTrap,
  resolveMonsterSummonEffects,
  resolveNormalSpell,
  resolveStandbyEffects,
  resolveTrapActivation,
  resolveTargetedEffect
} from './duelEffects.js';

function makeGame(overrides = {}) {
  return {
    turnCount: 1,
    over: false,
    winner: null,
    lp: { me: 8000, opp: 8000 },
    deck: { me: [], opp: [] },
    hand: { me: [], opp: [] },
    grave: { me: [], opp: [] },
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    },
    ...overrides
  };
}

test('exposes registered target modes for the duel interface', () => {
  assert.equal(getTargetMode({ id: 's-monster-reborn' }), 'grave-monster');
  assert.equal(getTargetMode({ id: 's-soul-release' }), 'grave-any');
  assert.equal(getTargetMode({ id: 'm-lava-golem' }), 'field-opponent-monster');
  assert.equal(getTargetMode({ id: 'm-blue-eyes-alternative-white-dragon' }), 'field-opponent-monster');
  assert.equal(getTargetMode({ id: 's-change-of-heart' }), 'field-opponent-monster');
  assert.equal(getTargetMode({ id: 's-brain-control' }), 'field-opponent-monster');
  assert.equal(getTargetMode({ id: 's-magical-dimension' }), 'friendly-monster');
  assert.equal(getTargetMode({ id: 's-twin-twisters' }), 'field-opponent-spell-trap');
  assert.equal(getTargetMode({ id: 't-graverobber' }), 'grave-opponent-any');
  assert.equal(getTargetMode({ id: 'm-blizzard-dragon' }), 'opponent-monster');
  assert.equal(getTargetMode({ id: 'm-catapult-turtle' }), 'friendly-monster');
  assert.equal(getTargetMode({ id: 't-spellbinding-circle' }), 'opponent-face-up-monster');
  assert.equal(getTargetMode({ id: 't-shadow-spell' }), 'opponent-face-up-monster');
  assert.equal(getTargetMode({ id: 't-heavy-storm-duster' }), 'field-spell-trap');
  for (const cardId of [
    's-horn-of-the-unicorn',
    's-magic-formula',
    's-butterfly-dagger-elma',
    's-mask-of-the-accursed',
    's-sword-of-deep-seated'
  ]) {
    assert.equal(getTargetMode({ id: cardId }), 'face-up-monster');
  }
  assert.equal(getTargetMode({ id: 't-nightmare-wheel' }), 'opponent-face-up-monster');
  assert.equal(getTargetMode({ id: 't-call-of-the-haunted' }), 'grave-monster');
  assert.equal(getTargetMode({ id: 's-pot-of-greed' }), null);
});

test('Pot of Greed resolves its draw effect', () => {
  const game = makeGame({
    deck: { me: [{ id: 'one' }, { id: 'two' }], opp: [] }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-pot-of-greed' });

  assert.equal(result.activated, true);
  assert.deepEqual(game.hand.me.map((card) => card.id), ['two', 'one']);
  assert.deepEqual(game.deck.me, []);
});

test('Solemn Wishes grants LP after a draw effect and can be activated as a set trap', () => {
  const game = makeGame({
    deck: { me: [{ id: 'one' }, { id: 'two' }], opp: [] },
    field: {
      me: {
        mon: Array(5).fill(null),
        st: [{ id: 't-solemn-wishes', faceDown: false }, null, null, null, null]
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });

  resolveNormalSpell(game, 'me', { id: 's-pot-of-greed' });

  assert.equal(game.lp.me, 8500);
  assert.equal(game.lp.opp, 8000);
  assert.equal(resolveTrapActivation(game, 'me', { id: 't-solemn-wishes' }).keepOnField, true);
});

test('Rain of Mercy and Counterbalance resolve only in their configured Standby Phase', () => {
  const game = makeGame({
    deck: { me: [], opp: [{ id: 'mill-one' }, { id: 'mill-two' }] },
    field: {
      me: {
        mon: [{ id: 'monster-one' }, null, null, null, null],
        st: [
          { id: 's-rain-of-mercy', faceDown: false },
          { id: 's-counterbalance-card', faceDown: false },
          null,
          null,
          null
        ]
      },
      opp: {
        mon: [{ id: 'monster-two' }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });

  assert.equal(resolveNormalSpell(makeGame(), 'me', { id: 's-rain-of-mercy' }).keepOnField, true);
  assert.deepEqual(resolveStandbyEffects(game, 'me'), ['Bạn hồi 1000 LP nhờ Mưa Ân Huệ.']);
  assert.equal(game.lp.me, 9000);
  assert.deepEqual(resolveStandbyEffects(game, 'me'), []);
  assert.equal(game.deck.opp.length, 2);
  assert.deepEqual(
    resolveStandbyEffects(game, 'opp'),
    ['Đối thủ gửi 2 lá trên cùng Bộ bài vào Mộ do Ma Thuật Hiến Tế Công Bằng.']
  );
  assert.deepEqual(game.grave.opp.map((card) => card.id), ['mill-two', 'mill-one']);
});

test('Berfomet searches Gazelle and Kings Knight summons Jack when its condition is met', () => {
  const berfometGame = makeGame({
    deck: { me: [{ id: 'm-gazelle-king-of-mythical-beasts' }], opp: [] }
  });
  const berfometLogs = resolveMonsterSummonEffects(
    berfometGame,
    'me',
    { id: 'm-berfomet' },
    'normal'
  );
  assert.equal(berfometGame.hand.me[0].id, 'm-gazelle-king-of-mythical-beasts');
  assert.equal(berfometLogs.length, 1);

  const kingsKnightGame = makeGame({
    deck: {
      me: [
        { id: 'm-jacks-knight', type: 'monster' },
        { id: 'm-jacks-knight', type: 'monster' }
      ],
      opp: []
    },
    field: {
      me: {
        mon: [{ id: 'm-queens-knight', faceDown: false }, { id: 'm-kings-knight' }, null, null, null],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  const kingsKnightLogs = resolveMonsterSummonEffects(
    kingsKnightGame,
    'me',
    { id: 'm-kings-knight' },
    'normal'
  );
  assert.equal(kingsKnightGame.field.me.mon[2].id, 'm-jacks-knight');
  assert.equal(kingsKnightGame.deck.me.length, 1);
  assert.equal(kingsKnightGame.deck.me[0].id, 'm-jacks-knight');
  assert.equal(kingsKnightLogs.length, 1);

  const tributeSummonGame = makeGame({
    deck: { me: [{ id: 'm-jacks-knight', type: 'monster' }], opp: [] },
    field: {
      me: {
        mon: [{ id: 'm-queens-knight', faceDown: false }, { id: 'm-kings-knight' }, null, null, null],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  const tributeSummonLogs = resolveMonsterSummonEffects(
    tributeSummonGame,
    'me',
    { id: 'm-kings-knight' },
    'tribute'
  );
  assert.equal(tributeSummonGame.deck.me.length, 1);
  assert.equal(tributeSummonGame.field.me.mon[2], null);
  assert.equal(tributeSummonLogs.length, 0);
});

test('drawing the fifth Exodia piece wins immediately', () => {
  const game = makeGame({
    deck: {
      me: [{ id: 'spare-card' }, { id: 'm-exodia-the-forbidden-one' }],
      opp: []
    },
    hand: {
      me: [
        { id: 'm-right-arm-of-the-forbidden-one' },
        { id: 'm-left-arm-of-the-forbidden-one' },
        { id: 'm-right-leg-of-the-forbidden-one' },
        { id: 'm-left-leg-of-the-forbidden-one' }
      ],
      opp: []
    }
  });

  resolveNormalSpell(game, 'me', { id: 's-pot-of-greed' });

  assert.equal(checkWinByExodia(game, 'me'), true);
  assert.equal(game.over, true);
  assert.equal(game.winner, 'me');
  assert.equal(game.hand.me.length, 5);
});

test('Card Destruction discards both hands then draws the same number', () => {
  const game = makeGame({
    deck: { me: [{ id: 'm-draw' }], opp: [{ id: 'o-one' }, { id: 'o-two' }] },
    hand: { me: [{ id: 'm-old' }], opp: [{ id: 'o-old-1' }, { id: 'o-old-2' }] }
  });

  resolveNormalSpell(game, 'me', { id: 's-card-destruction' });

  assert.deepEqual(game.grave.me.map((card) => card.id), ['m-old']);
  assert.deepEqual(game.grave.opp.map((card) => card.id), ['o-old-1', 'o-old-2']);
  assert.deepEqual(game.hand.me.map((card) => card.id), ['m-draw']);
  assert.deepEqual(game.hand.opp.map((card) => card.id), ['o-two', 'o-one']);
});

test('Graceful Charity draws before requesting two player-selected discards', () => {
  const game = makeGame({
    deck: { me: [{ id: 'one' }, { id: 'two' }, { id: 'three' }], opp: [] }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-graceful-charity' });

  assert.equal(result.activated, true);
  assert.equal(result.requiresDiscard, 2);
  assert.deepEqual(game.hand.me.map((card) => card.id), ['three', 'two', 'one']);
});

test('Cost Down reduces all monster levels in hand by two', () => {
  const game = makeGame({
    hand: {
      me: [
        { id: 'level-8', type: 'monster', level: 8 },
        { id: 'level-1', type: 'monster', level: 1 },
        { id: 'spell', type: 'spell' }
      ],
      opp: []
    }
  });

  resolveNormalSpell(game, 'me', { id: 's-cost-down' });

  assert.deepEqual(game.hand.me.map((card) => card.level), [6, 1, undefined]);
});

test('Dice of Destiny draws the number rolled', () => {
  const game = makeGame({
    deck: { me: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index}` })), opp: [] }
  });

  resolveNormalSpell(game, 'me', { id: 's-dice-of-destiny' }, { random: () => 0.5 });

  assert.equal(game.hand.me.length, 4);
});

test('Swords of Revealing Light remains on the field and reveals opposing set monsters', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: {
        mon: [{ id: 'set-monster', faceDown: true }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-swords-of-revealing-light' });

  assert.equal(result.activated, true);
  assert.equal(result.keepOnField, true);
  assert.equal(game.field.opp.mon[0].faceDown, false);
  assert.equal(game.field.opp.mon[0].position, 'defense');
});

test('Dark Magic Curtain pays half LP and summons a matching monster from Deck', () => {
  const game = makeGame({
    deck: {
      me: [{ id: 'm-dark-magician-girl', name: 'Dark Magician Girl', type: 'monster' }],
      opp: []
    }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-dark-magic-curtain' });

  assert.equal(result.activated, true);
  assert.equal(game.lp.me, 4000);
  assert.equal(game.field.me.mon[0].id, 'm-dark-magician-girl');
  assert.deepEqual(game.deck.me, []);
});

test('The Flute of Summoning Dragon requires Lord of D and summons dragons from hand', () => {
  const game = makeGame({
    hand: {
      me: [
        { id: 'm-dragon-one', type: 'monster', race: 'Rồng' },
        { id: 'm-dragon-two', type: 'monster', race: 'Dragon' }
      ],
      opp: []
    },
    field: {
      me: {
        mon: [{ id: 'm-lord-of-d', faceDown: false }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-the-flute-of-summoning-dragon' });

  assert.equal(result.activated, true);
  assert.deepEqual(game.field.me.mon.slice(1, 3).map((card) => card.id), ['m-dragon-one', 'm-dragon-two']);
  assert.deepEqual(game.hand.me, []);
});

test('Raigeki destroys opposing monsters and sends them to the graveyard', () => {
  const game = makeGame({
    field: {
      me: { mon: [{ id: 'ally' }, null, null, null, null], st: Array(5).fill(null) },
      opp: { mon: [{ id: 'enemy' }, null, null, null, null], st: Array(5).fill(null) }
    }
  });

  resolveNormalSpell(game, 'me', { id: 's-raigeki' });

  assert.equal(game.field.opp.mon[0], null);
  assert.deepEqual(game.grave.opp, [{ id: 'enemy' }]);
  assert.equal(game.field.me.mon[0].id, 'ally');
});

test('Divine Shield protects monsters from opposing destruction effects for the turn', () => {
  const game = makeGame({
    field: {
      me: { mon: [{ id: 'protected-monster' }, null, null, null, null], st: Array(5).fill(null) },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });

  resolveNormalSpell(game, 'me', { id: 's-divine-shield' });
  resolveNormalSpell(game, 'opp', { id: 's-raigeki' });
  const targetedResult = resolveTargetedEffect(
    game,
    'opp',
    { id: 's-soul-taker' },
    { who: 'me', kind: 'mon', index: 0 }
  );

  assert.equal(targetedResult.activated, false);
  assert.equal(game.field.me.mon[0].id, 'protected-monster');
  assert.deepEqual(game.grave.me, []);
});

test('conditional spells remain unactivated when their required monster is absent', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: [{ id: 'enemy' }, null, null, null, null], st: Array(5).fill(null) }
    }
  });

  const result = resolveNormalSpell(game, 'me', { id: 's-burst-stream-of-destruction' });

  assert.equal(result.activated, false);
  assert.equal(game.field.opp.mon[0].id, 'enemy');
});

test('implemented standby spells activate while unsupported effects are rejected explicitly', () => {
  const game = makeGame();

  assert.equal(resolveNormalSpell(game, 'me', { id: 's-rain-of-mercy' }).keepOnField, true);
  assert.equal(resolveNormalSpell(game, 'me', { id: 's-spell-reproduction' }).activated, false);
  assert.equal(resolveNormalSpell(game, 'me', { id: 's-not-implemented' }).activated, false);
});

test('targeted spells declare and resolve their actual field targets', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: {
        mon: [{ id: 'enemy', atk: 1800, position: 'attack' }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });
  const spell = { id: 's-change-of-heart', name: 'Trái Tim Hoán Đổi' };

  assert.deepEqual(resolveNormalSpell(game, 'me', spell), {
    activated: false,
    requiresTarget: true,
    targetMode: 'opponent-monster'
  });
  const result = resolveTargetedEffect(game, 'me', spell, { who: 'opp', kind: 'mon', index: 0 });

  assert.equal(result.activated, true);
  assert.equal(game.field.opp.mon[0], null);
  assert.equal(game.field.me.mon[0].id, 'enemy');
  assert.deepEqual(game.field.me.mon[0].temporaryControl, {
    returnTo: 'opp',
    zoneIndex: 0,
    turnCount: 1
  });
});

test('Monster Reborn selects a monster from either graveyard and summons it', () => {
  const game = makeGame({
    grave: {
      me: [],
      opp: [{ id: 'enemy-monster', type: 'monster', atk: 1700 }]
    }
  });
  const spell = { id: 's-monster-reborn' };
  const activation = resolveNormalSpell(game, 'me', spell);

  assert.equal(activation.requiresTarget, true);
  assert.equal(activation.targetMode, 'grave-monster');
  const result = resolveTargetedEffect(game, 'me', spell, {
    zone: 'grave',
    owner: 'opp',
    index: 0
  });

  assert.equal(result.activated, true);
  assert.equal(game.grave.opp.length, 0);
  assert.equal(game.field.me.mon[0].id, 'enemy-monster');
});

test('A Wingbeat of Giant Dragon returns a qualifying Dragon and clears opposing back row', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [{ id: 'm-dragon', type: 'monster', level: 5, race: 'Rồng', faceDown: false }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: {
        mon: Array(5).fill(null),
        st: [{ id: 'opp-spell', type: 'spell' }, { id: 'opp-trap', type: 'trap' }, null, null, null]
      }
    }
  });
  const activation = resolveNormalSpell(game, 'me', { id: 's-a-wingbeat-of-giant-dragon' });
  const result = resolveTargetedEffect(game, 'me', { id: 's-a-wingbeat-of-giant-dragon' }, {
    who: 'me',
    kind: 'mon',
    index: 0
  });

  assert.equal(activation.requiresTarget, true);
  assert.equal(result.activated, true);
  assert.equal(game.hand.me[0].id, 'm-dragon');
  assert.deepEqual(game.grave.opp.map((card) => card.id), ['opp-spell', 'opp-trap']);
});

test('Multiply tributes a face-up Kuriboh and fills available zones with Defense Tokens', () => {
  const game = makeGame({
    hand: { me: [{ id: 's-multiply', type: 'spell' }], opp: [] },
    field: {
      me: {
        mon: [
          { id: 'm-kuriboh', type: 'monster', faceDown: false },
          { id: 'existing-monster', type: 'monster' },
          null,
          null,
          null
        ],
        st: Array(5).fill(null)
      },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    }
  });
  const activation = resolveNormalSpell(game, 'me', { id: 's-multiply' });
  const invalidTarget = resolveTargetedEffect(game, 'me', { id: 's-multiply' }, {
    who: 'me',
    kind: 'mon',
    index: 1
  });
  const result = resolveTargetedEffect(game, 'me', { id: 's-multiply' }, {
    who: 'me',
    kind: 'mon',
    index: 0
  });

  assert.equal(activation.requiresTarget, true);
  assert.equal(activation.targetMode, 'friendly-monster');
  assert.equal(invalidTarget.activated, false);
  assert.equal(result.activated, true);
  assert.equal(game.grave.me[0].id, 'm-kuriboh');
  const tokens = game.field.me.mon.filter((card) => card?.id === 'token-kuriboh');
  assert.equal(tokens.length, 4);
  assert.ok(tokens.every((token) =>
    token.type === 'monster'
    && token.position === 'defense'
    && !token.faceDown
    && token.atk === 300
    && token.def === 200
  ));
});

test('Diffusion Wave-Motion pays LP, clears opposing monsters, and deals half their ATK', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [{ id: 'm-caster', level: 7, race: 'Phù thủy', faceDown: false }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: {
        mon: [{ id: 'enemy-one', atk: 1000 }, { id: 'enemy-two', atk: 1200 }, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });
  const spell = { id: 's-diffusion-wave-motion' };
  const activation = resolveNormalSpell(game, 'me', spell);
  const result = resolveTargetedEffect(game, 'me', spell, { who: 'me', kind: 'mon', index: 0 });

  assert.equal(activation.requiresTarget, true);
  assert.equal(result.activated, true);
  assert.equal(game.lp.me, 7000);
  assert.equal(game.lp.opp, 6900);
  assert.deepEqual(game.grave.opp.map((card) => card.id), ['enemy-one', 'enemy-two']);
});

test('settable traps resolve targeted effects and retain continuous Gravity Bind', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: [{ id: 'enemy' }, null, null, null, null], st: Array(5).fill(null) }
    }
  });
  const activation = resolveTrapActivation(game, 'me', { id: 't-compulsory-evacuation-device' });
  const result = resolveTargetedEffect(game, 'me', { id: 't-compulsory-evacuation-device' }, {
    who: 'opp',
    kind: 'mon',
    index: 0
  });
  const gravity = resolveTrapActivation(game, 'me', { id: 't-gravity-bind' });

  assert.equal(activation.requiresTarget, true);
  assert.equal(result.activated, true);
  assert.equal(game.hand.opp[0].id, 'enemy');
  assert.equal(gravity.activated, true);
  assert.equal(gravity.keepOnField, true);
});

test('Dragon Capture Jar changes every face-up Dragon to Defense Position', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [
          { id: 'my-dragon', race: 'Dragon', position: 'attack', faceDown: false },
          { id: 'my-set-dragon', race: 'Dragon', position: 'attack', faceDown: true },
          null,
          null,
          null
        ],
        st: Array(5).fill(null)
      },
      opp: {
        mon: [{ id: 'enemy-dragon', race: 'Rồng', position: 'attack', faceDown: false }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });
  const result = resolveTrapActivation(game, 'me', { id: 't-dragon-capture-jar' });

  assert.equal(result.activated, true);
  assert.equal(result.keepOnField, true);
  assert.equal(game.field.me.mon[0].position, 'defense');
  assert.equal(game.field.me.mon[1].position, 'attack');
  assert.equal(game.field.opp.mon[0].position, 'defense');
});

test('Brain Control rejects face-down opponent monsters', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: {
        mon: [{ id: 'enemy', faceDown: true }, null, null, null, null],
        st: Array(5).fill(null)
      }
    }
  });
  const result = resolveTargetedEffect(
    game,
    'me',
    { id: 's-brain-control' },
    { who: 'opp', kind: 'mon', index: 0 }
  );

  assert.equal(result.activated, false);
  assert.equal(result.reason, 'Chọn quái thú ngửa của đối thủ.');
});

test('targeted destruction rejects invalid targets and preserves the field', () => {
  const game = makeGame({
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: [{ id: 'enemy' }, null, null, null, null], st: Array(5).fill(null) }
    }
  });
  const result = resolveTargetedEffect(
    game,
    'me',
    { id: 's-thousand-knives' },
    { who: 'opp', kind: 'mon', index: 0 }
  );

  assert.equal(result.activated, false);
  assert.equal(game.field.opp.mon[0].id, 'enemy');
});

test('Mirror Force destroys all opposing attack-position monsters and cancels the attack', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [
          { id: 'attacker', position: 'attack' },
          { id: 'other-attacker', position: 'attack' },
          { id: 'defender', position: 'defense' },
          null,
          null
        ],
        st: Array(5).fill(null)
      },
      opp: {
        mon: Array(5).fill(null),
        st: [{ id: 't-mirror-force', type: 'trap', faceDown: true }, null, null, null, null]
      }
    }
  });

  const result = resolveAttackTrap(game, 'me', 0);

  assert.equal(result.cancelled, true);
  assert.equal(game.field.me.mon[0], null);
  assert.equal(game.field.me.mon[1], null);
  assert.equal(game.field.me.mon[2].id, 'defender');
  assert.equal(game.grave.opp[0].id, 't-mirror-force');
});

test('Magic Cylinder cancels an attack and applies the attacker ATK as damage', () => {
  const game = makeGame({
    field: {
      me: {
        mon: [{ id: 'attacker', atk: 2400 }, null, null, null, null],
        st: Array(5).fill(null)
      },
      opp: {
        mon: Array(5).fill(null),
        st: [{ id: 't-magic-cylinder', type: 'trap', faceDown: true }, null, null, null, null]
      }
    }
  });

  const result = resolveAttackTrap(game, 'me', 0);

  assert.equal(result.cancelled, true);
  assert.equal(game.lp.me, 5600);
  assert.equal(game.field.me.mon[0].id, 'attacker');
});

test('Waboku protects its controller and monsters from battle for the current turn', () => {
  const game = makeGame({
    turn: 'me',
    field: {
      me: { mon: [{ id: 'attacker' }, null, null, null, null], st: Array(5).fill(null) },
      opp: {
        mon: [{ id: 'defender', position: 'attack' }, null, null, null, null],
        st: [{ id: 't-waboku', type: 'trap', faceDown: true }, null, null, null, null]
      }
    }
  });

  const result = resolveAttackTrap(game, 'me', 0);

  assert.equal(result.cancelled, false);
  assert.deepEqual(game.battleProtection, { player: 'opp', turn: 'me', turnCount: 1 });
});

test('failed draw ends the duel by deck-out', () => {
  const game = makeGame({
    deck: { me: [{ id: 'last-card' }], opp: [] }
  });

  resolveNormalSpell(game, 'me', { id: 's-pot-of-greed' });

  assert.equal(game.over, true);
  assert.equal(game.winner, 'opp');
  assert.equal(game.hand.me.length, 1);
});
