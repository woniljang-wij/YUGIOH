import { applySliferSummonEffect } from './duelRules.js';

const EXODIA_PIECES = new Set([
  'm-exodia-the-forbidden-one',
  'm-right-arm-of-the-forbidden-one',
  'm-left-arm-of-the-forbidden-one',
  'm-right-leg-of-the-forbidden-one',
  'm-left-leg-of-the-forbidden-one'
]);

export function checkWinByExodia(game, player) {
  const handIds = new Set(game.hand[player].map((card) => card.id));
  if ([...EXODIA_PIECES].some((id) => !handIds.has(id))) return false;
  game.over = true;
  game.winner = player;
  return true;
}

function finishDuelForDeckOut(game, player) {
  game.over = true;
  game.winner = player === 'me' ? 'opp' : 'me';
}

export function applyDrawTriggers(game, player, drawn) {
  if (!drawn) return [];
  const logs = [];
  const hasSolemnWishes = game.field[player].st.some(
    (card) => card?.id === 't-solemn-wishes' && !card.faceDown
  );
  if (hasSolemnWishes) {
    game.lp[player] += 500;
    logs.push(`${player === 'me' ? 'Bạn' : 'Đối thủ'} hồi 500 LP nhờ Ân Huệ Của Thần.`);
  }
  return logs;
}

export function resolveStandbyEffects(game, phasePlayer) {
  const logs = [];
  const standbyKey = `${game.turnCount}:${phasePlayer}`;
  const monsterCount = ['me', 'opp'].reduce(
    (count, owner) => count + game.field[owner].mon.filter(Boolean).length,
    0
  );
  for (const owner of ['me', 'opp']) {
    game.field[owner].st.forEach((card, index) => {
      if (!card || card.faceDown || card.lastStandbyKey === standbyKey) return;
      if (card.id === 's-rain-of-mercy' && owner === phasePlayer) {
        game.lp[owner] += 1000;
        game.field[owner].st[index] = { ...card, lastStandbyKey: standbyKey };
        logs.push(`${owner === 'me' ? 'Bạn' : 'Đối thủ'} hồi 1000 LP nhờ Mưa Ân Huệ.`);
      }
      if (card.id === 's-counterbalance-card' && owner !== phasePlayer) {
        const target = owner === 'me' ? 'opp' : 'me';
        let sent = 0;
        while (sent < monsterCount && game.deck[target].length) {
          game.grave[target].push(game.deck[target].pop());
          sent += 1;
        }
        game.field[owner].st[index] = { ...card, lastStandbyKey: standbyKey };
        logs.push(`${target === 'me' ? 'Bạn' : 'Đối thủ'} gửi ${sent} lá trên cùng Bộ bài vào Mộ do Ma Thuật Hiến Tế Công Bằng.`);
      }
    });
  }
  return logs;
}

export function resolveMonsterSummonEffects(game, player, monster, summonMethod) {
  const logs = [];
  if (
    monster?.id === 'm-berfomet'
    && ['normal', 'tribute', 'flip'].includes(summonMethod)
  ) {
    const gazelleIndex = game.deck[player].findIndex(
      (card) => card.id === 'm-gazelle-king-of-mythical-beasts'
    );
    if (gazelleIndex >= 0) {
      const [gazelle] = game.deck[player].splice(gazelleIndex, 1);
      game.hand[player].push(gazelle);
      logs.push('Berfomet thêm Vua Sư Tử 1 Sừng từ Bộ bài lên tay.');
    }
  }
  if (
    monster?.id === 'm-kings-knight'
    && summonMethod === 'normal'
    && hasFaceUpMonster(game, player, 'm-queens-knight')
  ) {
    const summoned = specialSummonFromZones(
      game,
      player,
      ['deck'],
      (card) => card.id === 'm-jacks-knight',
      1
    );
    if (summoned.length) logs.push('Nhà Vua Hiệp Sĩ Triệu hồi Đặc biệt Kỵ Sĩ Jack từ Bộ bài.');
  }
  return logs;
}

function drawCards(game, player, count, logs) {
  let drawn = 0;
  while (drawn < count) {
    if (!game.deck[player].length) {
      finishDuelForDeckOut(game, player);
      logs.push(`${player === 'me' ? 'Bạn' : 'Đối thủ'} thua vì không thể rút bài.`);
      break;
    }
    game.hand[player].push(game.deck[player].pop());
    drawn += 1;
    if (checkWinByExodia(game, player)) {
      logs.push(`${player === 'me' ? 'Bạn' : 'Đối thủ'} tập hợp đủ 5 mảnh Exodia và thắng Duel!`);
      break;
    }
  }
  if (drawn) {
    logs.push(`${player === 'me' ? 'Bạn' : 'Đối thủ'} rút ${drawn} lá.`);
    logs.push(...applyDrawTriggers(game, player, drawn));
  }
}

function destroyMonsters(game, player, logs, effectPlayer) {
  if (
    effectPlayer
    && effectPlayer !== player
    && game.effectProtection?.[player] === game.turnCount
  ) {
    logs.push(`Quái thú của ${player === 'me' ? 'bạn' : 'đối thủ'} được Khiên Thần Bảo Hộ bảo vệ.`);
    return;
  }
  let count = 0;
  game.field[player].mon.forEach((card, index) => {
    if (!card) return;
    game.field[player].mon[index] = null;
    game.grave[player].push(card);
    count += 1;
  });
  logs.push(`Phá hủy ${count} quái thú của ${player === 'me' ? 'bạn' : 'đối thủ'}.`);
}

function destroyBackrow(game, player, logs) {
  let count = 0;
  game.field[player].st.forEach((card, index) => {
    if (!card) return;
    game.field[player].st[index] = null;
    game.grave[player].push(card);
    count += 1;
  });
  logs.push(`Phá hủy ${count} lá Phép/Bẫy của ${player === 'me' ? 'bạn' : 'đối thủ'}.`);
}

function hasFaceUpMonster(game, player, cardId) {
  return game.field[player].mon.some((card) => card?.id === cardId && !card.faceDown);
}

function isProtectedFromOpponentEffects(game, owner, effectPlayer) {
  return owner !== effectPlayer && game.effectProtection?.[owner] === game.turnCount;
}

function isDragonCaptureJarActive(game) {
  return ['me', 'opp'].some((owner) =>
    game.field[owner].st.some((card) => card?.id === 't-dragon-capture-jar' && !card.faceDown)
  );
}

function applyDragonCaptureJar(game, monster) {
  if (!isDragonCaptureJarActive(game) || !isDragon(monster)) return monster;
  return { ...monster, position: 'defense' };
}

function shuffle(cards, random) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
}

function findSourceCardIndex(game, player, zone, predicate) {
  const cards = zone === 'field'
    ? game.field[player].mon
    : game[zone][player];
  return cards.findIndex((card) => card && predicate(card));
}

function specialSummonFromZones(game, player, zones, predicate, limit, position = 'attack') {
  const summoned = [];
  for (let count = 0; count < limit; count += 1) {
    const zoneIndex = game.field[player].mon.findIndex((card) => !card);
    if (zoneIndex < 0) break;
    let source = null;
    let sourceIndex = -1;
    for (const zone of zones) {
      sourceIndex = findSourceCardIndex(game, player, zone, predicate);
      if (sourceIndex >= 0) {
        source = zone;
        break;
      }
    }
    if (!source) break;
    const [card] = game[source][player].splice(sourceIndex, 1);
    const monster = applyDragonCaptureJar(game, {
      ...card,
      faceDown: false,
      position,
      summonMethod: 'special',
      summonedTurn: game.turnCount
    });
    const opposingPlayer = player === 'me' ? 'opp' : 'me';
    const opposingSlifer = game.field[opposingPlayer].mon.some(
      (fieldCard) => fieldCard?.id === 'm-slifer-the-sky-dragon'
    ) && !isProtectedFromOpponentEffects(game, player, opposingPlayer);
    if (opposingSlifer) {
      const result = applySliferSummonEffect(monster, monster.position);
      game.field[player].mon[zoneIndex] = result.monster;
      if (result.destroyed) {
        game.field[player].mon[zoneIndex] = null;
        game.grave[player].push(result.monster);
        continue;
      }
    } else {
      game.field[player].mon[zoneIndex] = monster;
    }
    summoned.push(game.field[player].mon[zoneIndex]);
  }
  return summoned;
}

function specialSummonFromGrave(game, player, graveOwner, graveIndex, position = 'attack') {
  const zoneIndex = game.field[player].mon.findIndex((card) => !card);
  const target = game.grave[graveOwner][graveIndex];
  if (zoneIndex < 0 || !target || target.type !== 'monster') return null;
  const [card] = game.grave[graveOwner].splice(graveIndex, 1);
  const monster = applyDragonCaptureJar(game, {
    ...card,
    faceDown: false,
    position,
    summonMethod: 'special',
    summonedTurn: game.turnCount
  });
  const opposingPlayer = player === 'me' ? 'opp' : 'me';
  const opposingSlifer = game.field[opposingPlayer].mon.some(
    (fieldCard) => fieldCard?.id === 'm-slifer-the-sky-dragon'
  ) && !isProtectedFromOpponentEffects(game, player, opposingPlayer);
  if (opposingSlifer) {
    const result = applySliferSummonEffect(monster, monster.position);
    game.field[player].mon[zoneIndex] = result.monster;
    if (result.destroyed) {
      game.field[player].mon[zoneIndex] = null;
      game.grave[player].push(result.monster);
      return result.monster;
    }
    return result.monster;
  }
  game.field[player].mon[zoneIndex] = monster;
  return monster;
}

function isDragon(card) {
  const race = String(card?.race || card?.monsterType || '').toLowerCase();
  return race.includes('rồng') || race.includes('dragon');
}

function isSpellcaster(card) {
  const race = String(card?.race || card?.monsterType || '').toLowerCase();
  return race.includes('phù thủy') || race.includes('spellcaster');
}

const normalSpellEffects = {
  // s-pot-of-greed — Chiếc Bình Tham Lam: rút 2 lá.
  's-pot-of-greed'(game, player, logs) {
    drawCards(game, player, 2, logs);
  },
  // s-raigeki — Lôi Kích: phá hủy toàn bộ quái thú đối thủ.
  's-raigeki'(game, player, logs) {
    destroyMonsters(game, player === 'me' ? 'opp' : 'me', logs, player);
  },
  // s-heavy-storm — Bão Lớn: phá hủy hàng Phép/Bẫy đối thủ.
  's-heavy-storm'(game, player, logs) {
    destroyBackrow(game, player === 'me' ? 'opp' : 'me', logs);
  },
  // s-harpies-feather-duster — Lông Vũ Của Harpie: phá hủy hàng Phép/Bẫy đối thủ.
  's-harpies-feather-duster'(game, player, logs) {
    destroyBackrow(game, player === 'me' ? 'opp' : 'me', logs);
  },
  // s-card-of-sanctity — Kho Báu Từ Thiên Đường: mỗi bên rút đến khi có 6 lá.
  's-card-of-sanctity'(game, _player, logs) {
    for (const owner of ['me', 'opp']) {
      drawCards(game, owner, Math.max(0, 6 - game.hand[owner].length), logs);
    }
  },
  // s-card-destruction — Bỏ Hết Bài Trên Tay: cả hai bỏ bài rồi rút lại số tương ứng.
  's-card-destruction'(game, _player, logs) {
    const handSizes = { me: game.hand.me.length, opp: game.hand.opp.length };
    for (const owner of ['me', 'opp']) {
      game.grave[owner].push(...game.hand[owner].splice(0));
    }
    logs.push('Cả hai người chơi gửi toàn bộ bài trên tay vào Mộ.');
    for (const owner of ['me', 'opp']) drawCards(game, owner, handSizes[owner], logs);
  },
  // s-graceful-charity — Món Quà Của Thiên Thần: rút 3, yêu cầu người chơi chọn bỏ 2.
  's-graceful-charity'(game, player, logs) {
    drawCards(game, player, 3, logs);
    return { activated: true, requiresDiscard: 2 };
  },
  // s-cost-down — Giáng Cấp: giảm Cấp quái thú trên tay đi 2.
  's-cost-down'(game, player, logs) {
    game.hand[player] = game.hand[player].map((card) => {
      if (card.type !== 'monster') return card;
      const currentLevel = Number(card.level ?? card.lv);
      if (!Number.isFinite(currentLevel)) return card;
      const level = Math.max(1, currentLevel - 2);
      return { ...card, level, lv: level };
    });
    logs.push('Cấp của quái thú trên tay bạn giảm 2.');
  },
  // s-reload — Nạp Đạn: đưa bài trên tay về Bộ bài, xáo trộn rồi rút lại cùng số lượng.
  's-reload'(game, player, logs, random) {
    const returnedCount = game.hand[player].length;
    game.deck[player].push(...game.hand[player].splice(0));
    shuffle(game.deck[player], random);
    drawCards(game, player, returnedCount, logs);
  },
  // s-dice-of-destiny — Xúc Xắc Định Mệnh: tung xúc xắc và rút số lá tương ứng.
  's-dice-of-destiny'(game, player, logs, random) {
    const result = Math.floor(random() * 6) + 1;
    logs.push(`Xúc xắc ra ${result}.`);
    drawCards(game, player, result, logs);
  },
  // s-swords-of-revealing-light — Vòng Tròn Kiếm Ánh Sáng: lật quái thú úp và khóa tấn công đối thủ.
  's-swords-of-revealing-light'(game, player, logs) {
    const opponent = player === 'me' ? 'opp' : 'me';
    game.field[opponent].mon = game.field[opponent].mon.map((monster) =>
      monster?.faceDown ? { ...monster, faceDown: false, position: 'defense' } : monster
    );
    logs.push('Quái thú úp của đối thủ được lật ngửa; quái thú đối thủ không thể tấn công.');
    return { activated: true, keepOnField: true };
  },
  // s-dark-magic-curtain — Áo Choàng Của Ma Thuật Đen: trả nửa LP để gọi Dark Magician/Girl từ Deck.
  's-dark-magic-curtain'(game, player, logs) {
    if (game.lp[player] < 2) return { activated: false, reason: 'Không đủ LP để trả một nửa.' };
    if (!game.field[player].mon.some((card) => !card)) {
      return { activated: false, reason: 'Không còn ô quái thú trống.' };
    }
    const canSummon = game.deck[player].some((card) =>
      ['m-dark-magician', 'm-dark-magician-girl'].includes(card.id)
    );
    if (!canSummon) return { activated: false, reason: 'Không có mục tiêu hợp lệ trong Bộ bài.' };
    const paid = Math.ceil(game.lp[player] / 2);
    game.lp[player] -= paid;
    if (!game.lp[player]) finishDuelForDeckOut(game, player);
    const summoned = specialSummonFromZones(
      game,
      player,
      ['deck'],
      (card) => ['m-dark-magician', 'm-dark-magician-girl'].includes(card.id),
      1
    );
    logs.push(`Trả ${paid} LP để Triệu hồi Đặc biệt ${summoned[0]?.name || 'quái thú mục tiêu'}.`);
  },
  // s-sages-stone — Viên Đá Của Thầy Phù Thủy: từ tay/Deck gọi Dark Magician khi Dark Magician Girl ngửa.
  's-sages-stone'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-dark-magician-girl')) {
      return { activated: false, reason: 'Cần điều khiển Nữ Phù Thủy Bóng Đêm ngửa.' };
    }
    const summoned = specialSummonFromZones(
      game,
      player,
      ['hand', 'deck'],
      (card) => card.id === 'm-dark-magician',
      1
    );
    if (!summoned.length) return { activated: false, reason: 'Không có Phù Thủy Bóng Đêm trong tay hoặc Bộ bài.' };
    logs.push('Triệu hồi Đặc biệt Phù Thủy Bóng Đêm.');
  },
  // s-the-flute-of-summoning-dragon — Cây Sáo Gọi Rồng: cần Thủ Lĩnh Rồng, gọi tối đa 2 Rồng từ tay.
  's-the-flute-of-summoning-dragon'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-lord-of-d')) {
      return { activated: false, reason: 'Cần điều khiển Thủ Lĩnh Rồng ngửa.' };
    }
    const summoned = specialSummonFromZones(
      game,
      player,
      ['hand'],
      isDragon,
      2
    );
    if (!summoned.length) return { activated: false, reason: 'Không có quái thú Rồng trên tay.' };
    logs.push(`Triệu hồi Đặc biệt ${summoned.length} quái thú Rồng từ tay.`);
  },
  // s-the-melody-of-awakening-dragon — Giai Điệu Đánh Thức Rồng: trả 1000 LP, gọi 2 Rồng và khóa tấn công.
  's-the-melody-of-awakening-dragon'(game, player, logs) {
    const dragonCount = ['hand', 'deck'].reduce((count, zone) =>
      count + game[zone][player].filter(isDragon).length, 0);
    if (dragonCount < 2) return { activated: false, reason: 'Cần có ít nhất 2 quái thú Rồng trong tay/Bộ bài.' };
    if (game.field[player].mon.filter((card) => !card).length < 2) {
      return { activated: false, reason: 'Cần 2 ô quái thú trống.' };
    }
    if (game.lp[player] < 1000) return { activated: false, reason: 'Không đủ 1000 LP.' };
    game.lp[player] -= 1000;
    if (!game.lp[player]) {
      finishDuelForDeckOut(game, player);
      return { activated: true };
    }
    const summoned = specialSummonFromZones(game, player, ['hand', 'deck'], isDragon, 2);
    summoned.forEach((monster) => {
      const index = game.field[player].mon.indexOf(monster);
      game.field[player].mon[index] = { ...monster, cannotAttackTurn: game.turnCount };
    });
    logs.push(`Trả 1000 LP; Triệu hồi ${summoned.length} Rồng không thể tấn công lượt này.`);
  },
  // s-bond-between-teacher-and-student — Mối Liên Kết Giữa Thầy Và Trò: gọi Dark Magician Girl, rồi Úp một Phép chỉ định.
  's-bond-between-teacher-and-student'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-dark-magician')) {
      return { activated: false, reason: 'Cần điều khiển Phù Thủy Bóng Đêm ngửa.' };
    }
    const summoned = specialSummonFromZones(
      game,
      player,
      ['hand', 'deck', 'grave'],
      (card) => card.id === 'm-dark-magician-girl',
      1
    );
    if (!summoned.length) return { activated: false, reason: 'Không có Nữ Phù Thủy Bóng Đêm hợp lệ.' };
    const settableIds = new Set([
      's-thousand-knives',
      's-dark-burning-attack',
      's-dark-magic-attack',
      's-dark-magic-twin-burst'
    ]);
    const backrowIndex = game.field[player].st.findIndex((card) => !card);
    const settableIndex = game.deck[player].findIndex((card) => settableIds.has(card.id));
    if (backrowIndex >= 0 && settableIndex >= 0) {
      const [spell] = game.deck[player].splice(settableIndex, 1);
      game.field[player].st[backrowIndex] = { ...spell, faceDown: true, setTurn: game.turnCount };
      logs.push(`Úp ${spell.name} từ Bộ bài.`);
    }
    logs.push('Triệu hồi Đặc biệt Nữ Phù Thủy Bóng Đêm.');
  },
  // s-dark-magic-attack — Ma Thuật Tấn Công: cần Dark Magician ngửa; phá hủy hàng Phép/Bẫy đối thủ.
  's-dark-magic-attack'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-dark-magician')) {
      return { activated: false, reason: 'Cần điều khiển Phù Thủy Bóng Đêm ngửa mặt.' };
    }
    destroyBackrow(game, player === 'me' ? 'opp' : 'me', logs);
  },
  // s-dark-burning-attack — Đòn Tấn Công Thiêu Đốt Bóng Tối: cần Dark Magician Girl; phá hủy quái thú đối thủ.
  's-dark-burning-attack'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-dark-magician-girl')) {
      return { activated: false, reason: 'Cần điều khiển Nữ Phù Thủy Bóng Đêm ngửa mặt.' };
    }
    destroyMonsters(game, player === 'me' ? 'opp' : 'me', logs, player);
  },
  // s-burst-stream-of-destruction — Đạn Pháo Rồng Trắng: cần Blue-Eyes; phá hủy quái thú đối thủ, khóa Blue-Eyes tấn công.
  's-burst-stream-of-destruction'(game, player, logs) {
    if (!hasFaceUpMonster(game, player, 'm-blue-eyes-white-dragon')) {
      return { activated: false, reason: 'Cần điều khiển Rồng Trắng Mắt Xanh ngửa mặt.' };
    }
    destroyMonsters(game, player === 'me' ? 'opp' : 'me', logs, player);
    game.field[player].mon = game.field[player].mon.map((card) =>
      card?.id === 'm-blue-eyes-white-dragon'
        ? { ...card, cannotAttackTurn: game.turnCount }
        : card
    );
    logs.push('Rồng Trắng Mắt Xanh bạn điều khiển không thể tấn công trong lượt này.');
  },
  // s-divine-shield — Khiên Thần Bảo Hộ: bảo vệ quái thú của bạn khỏi hiệu ứng và chiến đấu lượt này.
  's-divine-shield'(game, player, logs) {
    game.effectProtection = {
      ...game.effectProtection,
      [player]: game.turnCount
    };
    logs.push('Quái thú bạn điều khiển không thể bị phá hủy trong chiến đấu hoặc bởi hiệu ứng bài lượt này.');
  },
  // s-rain-of-mercy — Mưa Ân Huệ: hồi 1000 LP trong Standby Phase của người kích hoạt.
  's-rain-of-mercy'(_game, _player, logs) {
    logs.push('Mưa Ân Huệ sẽ hồi 1000 LP trong Standby Phase của bạn.');
    return { activated: true, keepOnField: true };
  },
  // s-counterbalance-card — Ma Thuật Hiến Tế Công Bằng: đối thủ gửi bài từ Deck bằng số quái thú trên sân.
  's-counterbalance-card'(_game, _player, logs) {
    logs.push('Ma Thuật Hiến Tế Công Bằng được duy trì để kích hoạt trong Standby Phase của đối thủ.');
    return { activated: true, keepOnField: true };
  }
};

const targetedEffects = {
  's-soul-release': {
    target: 'grave-any'
  },
  // Người Đá Dung Nham: chọn hai quái thú đối thủ để Hiến tế.
  'm-lava-golem': {
    target: 'field-opponent-monster'
  },
  // Rồng Trắng Mắt Xanh Thay Thế: chọn một quái thú đối thủ để phá hủy.
  'm-blue-eyes-alternative-white-dragon': {
    target: 'field-opponent-monster'
  },
  // Kẻ Trộm Mộ: chọn một lá trong Mộ đối thủ.
  't-graverobber': {
    target: 'grave-opponent-any'
  },
  // Rùa Biển Đại Bác: chọn quái thú của bạn để hiến tế.
  'm-catapult-turtle': {
    target: 'friendly-monster'
  },
  's-multiply': {
    target: 'friendly-monster',
    condition(game, player) {
      return game.field[player].mon.some(
        (card) => card?.id === 'm-kuriboh' && !card.faceDown
      );
    },
    resolve(game, player, target, logs) {
      const zone = game.field[player].mon;
      const kuriboh = target?.who === player && target.kind === 'mon'
        ? zone[target.index]
        : null;
      if (kuriboh?.id !== 'm-kuriboh' || kuriboh.faceDown) {
        return {
          activated: false,
          reason: 'Cấp Số Nhân cần Hiến tế một Kuriboh ngửa của bạn.'
        };
      }

      zone[target.index] = null;
      game.grave[player].push(kuriboh);
      let summonedCount = 0;
      zone.forEach((monster, slot) => {
        if (monster) return;
        zone[slot] = {
          id: 'token-kuriboh',
          instance_id: `${player}:kuriboh-token-${slot}`,
          name: 'Kuriboh Token',
          type: 'monster',
          category: 'monster',
          attribute: 'DARK',
          attr: 'DARK',
          race: 'Ác quỷ',
          level: 1,
          lv: 1,
          atk: 300,
          def: 200,
          faceDown: false,
          position: 'defense'
        };
        summonedCount += 1;
      });
      logs.push(
        `Cấp Số Nhân Triệu hồi Đặc biệt ${summonedCount} Kuriboh Token ở tư thế Phòng thủ.`
      );
      return { activated: true };
    }
  },
  // m-blizzard-dragon — Rồng Băng Giá: chọn quái thú đối thủ để khóa tấn công và đổi thế.
  'm-blizzard-dragon': {
    target: 'opponent-monster'
  },
  // s-monster-reborn — Hồi Sinh Quái Thú: chọn quái thú trong một trong hai Mộ để Triệu hồi Đặc biệt.
  's-monster-reborn': {
    target: 'grave-monster',
    condition(game, player) {
      return ['me', 'opp'].some((owner) =>
        game.grave[owner].some((card) => card.type === 'monster')
      ) && game.field[player].mon.some((card) => !card);
    },
    resolve(game, player, target) {
      if (target.zone !== 'grave' || !['me', 'opp'].includes(target.owner)) {
        return { activated: false, reason: 'Chọn quái thú trong một trong hai Mộ.' };
      }
      if (!specialSummonFromGrave(game, player, target.owner, target.index)) {
        return { activated: false, reason: 'Không thể Triệu hồi Đặc biệt mục tiêu đó.' };
      }
      return { activated: true, logs: ['Quái thú được Triệu hồi Đặc biệt từ Mộ.'] };
    }
  },
  // s-return-of-the-dragon-lords — Sự Trở Lại Của Chúa Rồng: hồi sinh Rồng Cấp 7/8 từ Mộ của bạn.
  's-return-of-the-dragon-lords': {
    target: 'grave-dragon-level-7-8',
    condition(game, player) {
      return game.grave[player].some((card) =>
        isDragon(card) && [7, 8].includes(Number(card.level ?? card.lv))
      ) && game.field[player].mon.some((card) => !card);
    },
    resolve(game, player, target) {
      const card = game.grave[player]?.[target.index];
      const level = Number(card?.level ?? card?.lv);
      if (
        target.zone !== 'grave'
        || target.owner !== player
        || !isDragon(card)
        || ![7, 8].includes(level)
      ) return { activated: false, reason: 'Chọn quái thú Rồng Cấp 7 hoặc 8 trong Mộ của bạn.' };
      if (!specialSummonFromGrave(game, player, player, target.index)) {
        return { activated: false, reason: 'Không thể Triệu hồi Đặc biệt mục tiêu đó.' };
      }
      return { activated: true, logs: ['Quái thú Rồng được Triệu hồi Đặc biệt từ Mộ.'] };
    }
  },
  // s-a-wingbeat-of-giant-dragon — Rồng Thiêng Đập Cánh: trả Rồng Cấp 5+ về tay để phá hàng Phép/Bẫy đối thủ.
  's-a-wingbeat-of-giant-dragon': {
    target: 'face-up-monster',
    condition(game, player) {
      return game.field[player].mon.some((card) =>
        card
        && !card.faceDown
        && isDragon(card)
        && Number.isFinite(Number(card.level ?? card.lv))
        && Number(card.level ?? card.lv) >= 5
      );
    },
    resolve(game, player, { who, kind, index }, logs) {
      const dragon = game.field[player].mon[index];
      if (
        who !== player
        || kind !== 'mon'
        || !dragon
        || dragon.faceDown
        || !isDragon(dragon)
        || !Number.isFinite(Number(dragon.level ?? dragon.lv))
        || Number(dragon.level ?? dragon.lv) < 5
      ) return { activated: false, reason: 'Chọn Rồng ngửa Cấp 5 trở lên do bạn điều khiển.' };
      game.field[player].mon[index] = null;
      game.hand[player].push(dragon);
      destroyBackrow(game, player === 'me' ? 'opp' : 'me', logs);
      return { logs: ['Rồng mục tiêu được trả về tay.'] };
    }
  },
  // s-diffusion-wave-motion — Sóng Khuếch Tán Năng Lượng: trả 1000 LP, rồi quét quái thú đối thủ bằng Phù thủy Cấp 7+.
  's-diffusion-wave-motion': {
    target: 'face-up-monster',
    condition(game, player) {
      return game.lp[player] >= 1000 && game.field[player].mon.some((card) =>
        card
        && !card.faceDown
        && Number.isFinite(Number(card.level ?? card.lv))
        && Number(card.level ?? card.lv) >= 7
        && isSpellcaster(card)
      );
    },
    resolve(game, player, { who, kind, index }, logs) {
      const caster = game.field[player].mon[index];
      if (
        who !== player
        || kind !== 'mon'
        || !caster
        || caster.faceDown
        || !Number.isFinite(Number(caster.level ?? caster.lv))
        || Number(caster.level ?? caster.lv) < 7
        || !isSpellcaster(caster)
      ) return { activated: false, reason: 'Chọn Phù thủy ngửa Cấp 7 trở lên do bạn điều khiển.' };
      if (game.lp[player] < 1000) {
        return { activated: false, reason: 'Không đủ 1000 LP để kích hoạt.' };
      }
      game.lp[player] -= 1000;
      if (game.lp[player] === 0) {
        finishDuelForDeckOut(game, player);
        return { logs: ['Bạn mất Duel sau khi trả 1000 LP.'] };
      }
      const opponent = player === 'me' ? 'opp' : 'me';
      if (!isProtectedFromOpponentEffects(game, opponent, player)) {
        let damage = 0;
        game.field[opponent].mon.forEach((monster, monsterIndex) => {
          if (!monster) return;
          damage += Math.floor(Math.max(0, Number(monster.atk) || 0) / 2);
          game.field[opponent].mon[monsterIndex] = null;
          game.grave[opponent].push(monster);
        });
        game.lp[opponent] = Math.max(0, game.lp[opponent] - damage);
        if (game.lp[opponent] === 0) finishDuelForDeckOut(game, opponent);
        logs.push(`Quái thú đối thủ bị phá hủy; họ chịu tổng cộng ${damage} sát thương.`);
      } else {
        logs.push('Quái thú đối thủ được Khiên Thần Bảo Hộ bảo vệ khỏi hiệu ứng.');
      }
      return { logs };
    }
  },
  // s-change-of-heart — Trái Tim Hoán Đổi: chiếm quái thú đối thủ đến hết lượt.
  's-change-of-heart': {
    target: 'opponent-monster',
    resolve(game, player, { who, kind, index }) {
      if (who !== (player === 'me' ? 'opp' : 'me') || kind !== 'mon') {
        return { activated: false, reason: 'Chọn quái thú của đối thủ.' };
      }
      const freeZone = game.field[player].mon.findIndex((monster) => !monster);
      if (freeZone < 0) return { activated: false, reason: 'Không còn ô quái thú trống.' };
      const target = game.field[who].mon[index];
      game.field[player].mon[freeZone] = {
        ...target,
        temporaryControl: { returnTo: who, zoneIndex: index, turnCount: game.turnCount }
      };
      game.field[who].mon[index] = null;
      return { activated: true, logs: ['Bạn chiếm quyền điều khiển quái thú mục tiêu đến hết lượt.'] };
    }
  },
  // s-brain-control — Tẩy Não: chiếm quái thú ngửa của đối thủ đến hết lượt.
  's-brain-control': {
    target: 'opponent-face-up-monster',
    resolve(game, player, { who, kind, index }) {
      if (
        who !== (player === 'me' ? 'opp' : 'me')
        || kind !== 'mon'
        || game.field[who].mon[index]?.faceDown
      ) return { activated: false, reason: 'Chọn quái thú ngửa của đối thủ.' };
      const freeZone = game.field[player].mon.findIndex((monster) => !monster);
      if (freeZone < 0) return { activated: false, reason: 'Không còn ô quái thú trống.' };
      const target = game.field[who].mon[index];
      game.field[player].mon[freeZone] = {
        ...target,
        temporaryControl: { returnTo: who, zoneIndex: index, turnCount: game.turnCount }
      };
      game.field[who].mon[index] = null;
      return { activated: true, logs: ['Bạn chiếm quyền điều khiển quái thú mục tiêu đến hết lượt.'] };
    }
  },
  // s-thousand-knives — Ngàn Lưỡi Dao Găm: cần Dark Magician; phá hủy quái thú đối thủ.
  's-thousand-knives': {
    target: 'opponent-monster',
    condition(game, player) {
      return hasFaceUpMonster(game, player, 'm-dark-magician');
    },
    resolve(game, player, { who, kind, index }, logs) {
      if (who !== (player === 'me' ? 'opp' : 'me') || kind !== 'mon') {
        return { activated: false, reason: 'Chọn quái thú của đối thủ.' };
      }
      const target = game.field[who].mon[index];
      if (!target) return { activated: false, reason: 'Quái thú mục tiêu không còn trên sân.' };
      game.field[who].mon[index] = null;
      game.grave[who].push(target);
      logs.push('Quái thú mục tiêu bị phá hủy.');
    }
  },
  // s-mystical-space-typhoon — Lốc Xoáy: phá hủy một Lá Phép/Bẫy trên sân.
  's-mystical-space-typhoon': {
    target: 'spell-trap',
    resolve(game, _player, { who, kind, index }, logs) {
      if (kind !== 'st' || !game.field[who].st[index]) {
        return { activated: false, reason: 'Chọn một lá Phép/Bẫy trên sân.' };
      }
      const [target] = game.field[who].st.splice(index, 1, null);
      game.grave[who].push(target);
      logs.push('Lá Phép/Bẫy mục tiêu bị phá hủy.');
    }
  },
  // s-soul-taker — Thợ Săn Linh Hồn: phá hủy quái thú ngửa của đối thủ; họ hồi 1000 LP.
  's-soul-taker': {
    target: 'opponent-face-up-monster',
    resolve(game, player, { who, kind, index }, logs) {
      if (
        who !== (player === 'me' ? 'opp' : 'me')
        || kind !== 'mon'
        || game.field[who].mon[index]?.faceDown
      ) return { activated: false, reason: 'Chọn quái thú ngửa của đối thủ.' };
      const [target] = game.field[who].mon.splice(index, 1, null);
      game.grave[who].push(target);
      game.lp[who] += 1000;
      logs.push('Quái thú bị phá hủy; đối thủ nhận 1000 LP.');
    }
  },
  // s-shrink — Kính Hiển Vi: giảm một nửa ATK gốc của quái thú ngửa.
  's-shrink': {
    target: 'face-up-monster',
    resolve(game, _player, { who, kind, index }) {
      const target = game.field[who]?.mon[index];
      if (kind !== 'mon' || !target || target.faceDown) {
        return { activated: false, reason: 'Chọn một quái thú ngửa trên sân.' };
      }
      const originalAtk = Number(target.originalAtk ?? target.atk);
      game.field[who].mon[index] = {
        ...target,
        originalAtk: Number.isFinite(originalAtk) ? originalAtk : 0,
        atk: Math.floor((Number.isFinite(originalAtk) ? originalAtk : 0) / 2)
      };
      return { activated: true, logs: ['ATK gốc của quái thú mục tiêu bị giảm một nửa.'] };
    }
  },
  // s-remove-trap — Giải Trừ Cạm Bẫy: phá hủy một Lá Bẫy ngửa.
  's-remove-trap': {
    target: 'face-up-trap',
    resolve(game, _player, { who, kind, index }, logs) {
      const target = game.field[who]?.st[index];
      if (kind !== 'st' || target?.type !== 'trap' || target.faceDown) {
        return { activated: false, reason: 'Chọn một lá Bẫy ngửa trên sân.' };
      }
      game.field[who].st[index] = null;
      game.grave[who].push(target);
      logs.push('Lá Bẫy mục tiêu bị phá hủy.');
    }
  },
  // s-de-spell — Giải Trừ Ma Pháp: phá hủy Lá Phép ngửa hoặc xác minh lá úp.
  's-de-spell': {
    target: 'spell-or-set-card',
    resolve(game, _player, { who, kind, index }, logs) {
      const target = game.field[who]?.st[index];
      if (kind !== 'st' || !target) {
        return { activated: false, reason: 'Chọn một lá Phép ngửa hoặc lá đang úp.' };
      }
      if (!target.faceDown && target.type !== 'spell') {
        return { activated: false, reason: 'Lá ngửa mục tiêu không phải Lá Phép.' };
      }
      if (target.faceDown && target.type !== 'spell') {
        game.field[who].st[index] = { ...target, faceDown: true };
        logs.push('Lá úp được xác nhận không phải Lá Phép và được úp lại.');
        return;
      }
      game.field[who].st[index] = null;
      game.grave[who].push({ ...target, faceDown: false });
      logs.push('Lá Phép mục tiêu bị phá hủy.');
    }
  },
  // t-compulsory-evacuation-device — Cưỡng Chế Tháo Trang Bị: trả một quái thú trên sân về tay.
  't-compulsory-evacuation-device': {
    target: 'any-monster',
    resolve(game, _player, { who, kind, index }) {
      const target = game.field[who]?.mon[index];
      if (kind !== 'mon' || !target) {
        return { activated: false, reason: 'Chọn một quái thú trên sân.' };
      }
      const freeHand = game.hand[who];
      game.field[who].mon[index] = null;
      freeHand.push(target);
      return { activated: true, logs: ['Quái thú mục tiêu được trả về tay chủ sở hữu.'] };
    }
  },
  // t-ring-of-destruction — Vòng Hủy Diệt: phá hủy quái thú đối thủ và gây sát thương bằng ATK.
  't-ring-of-destruction': {
    target: 'opponent-monster',
    resolve(game, player, { who, kind, index }, logs) {
      if (who !== (player === 'me' ? 'opp' : 'me') || kind !== 'mon') {
        return { activated: false, reason: 'Chọn quái thú của đối thủ.' };
      }
      const target = game.field[who].mon[index];
      if (!target) return { activated: false, reason: 'Quái thú mục tiêu không còn trên sân.' };
      const damage = Math.max(0, Number(target.atk) || 0);
      game.field[who].mon[index] = null;
      game.grave[who].push(target);
      game.lp[who] = Math.max(0, game.lp[who] - damage);
      if (!game.lp[who]) finishDuelForDeckOut(game, who);
      logs.push(`Quái thú bị phá hủy; đối thủ chịu ${damage} sát thương.`);
    }
  },
  // t-spellbinding-circle — Vòng Tròn Pháp Thuật: chọn quái thú đối thủ để khóa tấn công và đổi thế.
  't-spellbinding-circle': {
    target: 'opponent-face-up-monster'
  },
  // t-shadow-spell — Lời Nguyền Bóng Tối: chọn quái thú ngửa của đối thủ.
  't-shadow-spell': {
    target: 'opponent-face-up-monster'
  },
  // t-heavy-storm-duster — Cơn Bão Lớn: chọn tối đa hai Lá Phép/Bẫy trên sân.
  't-heavy-storm-duster': {
    target: 'field-spell-trap'
  },
  // Sừng Kỳ Lân: chọn quái thú ngửa để tăng ATK và DEF.
  's-horn-of-the-unicorn': {
    target: 'face-up-monster'
  },
  // Quyển Sách Ma Thuật: chọn Dark Magician hoặc Dark Magician Girl ngửa.
  's-magic-formula': {
    target: 'face-up-monster'
  },
  // Kiếm Bướm Elma: chọn quái thú ngửa để tăng ATK.
  's-butterfly-dagger-elma': {
    target: 'face-up-monster'
  },
  // Mặt Nạ Chú Hồn: chọn quái thú ngửa bị khóa tấn công.
  's-mask-of-the-accursed': {
    target: 'face-up-monster'
  },
  // Kiếm Chấp Niệm: chọn quái thú ngửa để tăng ATK và DEF.
  's-sword-of-deep-seated': {
    target: 'face-up-monster'
  },
  // Bánh Xe Ác Mộng: chọn quái thú ngửa của đối thủ.
  't-nightmare-wheel': {
    target: 'opponent-face-up-monster'
  },
  // Tiếng Gọi Của Cái Chết Và Sự Sống: chọn quái thú trong Mộ để hồi sinh.
  't-call-of-the-haunted': {
    target: 'grave-monster'
  }
};

const normalTrapEffects = {
  // t-gravity-bind — Mạng Lưới Trọng Lực: ngăn quái thú Cấp 4 trở lên của đối thủ tấn công.
  't-gravity-bind'(_game, _player, logs) {
    logs.push('Quái thú Cấp 4 trở lên của đối thủ không thể tấn công khi Mạng Lưới Trọng Lực ngửa.');
    return { activated: true, keepOnField: true };
  },
  // t-solemn-wishes — Ân Huệ Của Thần: hồi 500 LP mỗi khi người điều khiển rút bài.
  't-solemn-wishes'(_game, _player, logs) {
    logs.push('Ân Huệ Của Thần hồi 500 LP mỗi khi bạn rút bài.');
    return { activated: true, keepOnField: true };
  },
  // t-dragon-capture-jar — Hủ Nhốt Rồng: chuyển các Rồng ngửa sang Thế Thủ và khóa đổi thế.
  't-dragon-capture-jar'(game, _player, logs) {
    for (const owner of ['me', 'opp']) {
      game.field[owner].mon = game.field[owner].mon.map((monster) =>
        monster && !monster.faceDown && isDragon(monster)
          ? { ...monster, position: 'defense' }
          : monster
      );
    }
    logs.push('Các quái thú Rồng ngửa chuyển sang Thế Thủ và không thể đổi tư thế khi Hủ Nhốt Rồng còn ngửa.');
    return { activated: true, keepOnField: true };
  }
};

function prepareTargetedEffect(game, player, card) {
  const effect = targetedEffects[card?.id];
  if (!effect) return null;
  if (effect.condition && !effect.condition(game, player)) {
    return { activated: false, reason: 'Không thỏa điều kiện kích hoạt của lá bài.' };
  }
  return { activated: false, requiresTarget: true, targetMode: effect.target };
}

export function getTargetMode(card) {
  if (['s-change-of-heart', 's-brain-control'].includes(card?.id)) {
    return 'field-opponent-monster';
  }
  if (card?.id === 'm-odd-eyes-advance-dragon') return 'field-opponent-monster';
  if (card?.id === 's-soul-exchange') return 'field-opponent-monster';
  if (card?.id === 's-magical-dimension') return 'friendly-monster';
  if (card?.id === 's-multiply') return 'friendly-monster';
  if (card?.id === 's-twin-twisters') return 'field-opponent-spell-trap';
  if (card?.id === 's-dicephoon') return 'field-spell-trap';
  if (card?.id === 'm-night-assailant') return 'field-opponent-monster';
  if (card?.id === 't-trap-hole') return 'field-opponent-monster';
  return targetedEffects[card?.id]?.target || null;
}

export function resolveNormalSpell(game, player, card, { random = Math.random } = {}) {
  const targetedResult = prepareTargetedEffect(game, player, card);
  if (targetedResult) return targetedResult;
  if (!normalSpellEffects[card?.id]) {
    return { activated: false, reason: 'Hiệu ứng của lá Phép này chưa được đăng ký trong bộ xử lý.' };
  }
  const logs = [];
  const result = normalSpellEffects[card.id](game, player, logs, random) || { activated: true };
  if (result.activated === false) return { ...result, logs: [] };
  return { ...result, activated: true, logs };
}

export function resolveTrapActivation(game, player, card, { random = Math.random } = {}) {
  const targetedResult = prepareTargetedEffect(game, player, card);
  if (targetedResult) return targetedResult;
  const effect = normalTrapEffects[card?.id];
  if (!effect) {
    return { activated: false, reason: 'Hiệu ứng kích hoạt của lá Bẫy này chưa được đăng ký trong bộ xử lý.' };
  }
  const logs = [];
  const result = effect(game, player, logs, random) || { activated: true };
  if (result.activated === false) return { ...result, logs: [] };
  return { ...result, activated: true, logs };
}

export function resolveTargetedEffect(game, player, card, target) {
  const effect = targetedEffects[card?.id];
  if (!effect) return { activated: false, reason: 'Hiệu ứng chọn mục tiêu chưa được đăng ký.' };
  if (effect.condition && !effect.condition(game, player)) {
    return { activated: false, reason: 'Không thỏa điều kiện kích hoạt của lá bài.' };
  }
  if (
    target?.kind === 'mon'
    && target.who !== player
    && game.effectProtection?.[target.who] === game.turnCount
  ) {
    return { activated: false, reason: 'Quái thú mục tiêu được Khiên Thần Bảo Hộ bảo vệ.' };
  }
  const logs = [];
  const result = effect.resolve(game, player, target, logs, card) || { activated: true };
  if (result.activated === false) return { ...result, logs: [] };
  return {
    activated: true,
    keepOnField: result.keepOnField,
    logs: result.logs || logs
  };
}

export function resolveAttackTrap(game, attackerPlayer, attackerIndex) {
  const defenderPlayer = attackerPlayer === 'me' ? 'opp' : 'me';
  const trapIndex = game.field[defenderPlayer].st.findIndex((card) =>
    card?.type === 'trap' && card.faceDown
    && [
      't-mirror-force',
      't-magic-cylinder',
      't-waboku',
      't-negate-attack',
      't-scrap-iron-scarecrow',
      't-silent-commander'
    ].includes(card.id)
  );
  if (trapIndex === -1) return { activated: false };

  const trap = game.field[defenderPlayer].st[trapIndex];
  const logs = [];
  const attacker = game.field[attackerPlayer].mon[attackerIndex];
  // t-mirror-force — Gương Phản Chiếu: phá hủy mọi quái thú tấn công của đối thủ.
  if (trap.id === 't-mirror-force') {
    game.field[attackerPlayer].mon.forEach((monster, index) => {
      if (
        !monster
        || monster.faceDown
        || monster.position === 'defense'
        || isProtectedFromOpponentEffects(game, attackerPlayer, defenderPlayer)
      ) return;
      game.field[attackerPlayer].mon[index] = null;
      game.grave[attackerPlayer].push(monster);
    });
    game.field[defenderPlayer].st[trapIndex] = null;
    game.grave[defenderPlayer].push(trap);
    logs.push('Gương Phản Chiếu phá hủy các quái thú tấn công của đối thủ.');
    return { activated: true, cancelled: true, logs };
  }
  // t-magic-cylinder — Ống Ma Thuật: vô hiệu hóa đòn tấn công và gây sát thương bằng ATK.
  if (trap.id === 't-magic-cylinder') {
    const damage = Math.max(0, Number(attacker?.atk) || 0);
    game.field[defenderPlayer].st[trapIndex] = null;
    game.grave[defenderPlayer].push(trap);
    game.lp[attackerPlayer] = Math.max(0, game.lp[attackerPlayer] - damage);
    if (!game.lp[attackerPlayer]) finishDuelForDeckOut(game, attackerPlayer);
    logs.push(`Ống Ma Thuật vô hiệu hóa đòn tấn công và gây ${damage} sát thương.`);
    return { activated: true, cancelled: true, logs };
  }
  // t-waboku — ngăn sát thương chiến đấu và bảo vệ quái thú của người kích hoạt.
  if (trap.id === 't-waboku') {
    game.field[defenderPlayer].st[trapIndex] = null;
    game.grave[defenderPlayer].push(trap);
    game.battleProtection = { player: defenderPlayer, turn: game.turn, turnCount: game.turnCount };
    logs.push('Waboku ngăn sát thương chiến đấu và bảo vệ quái thú của người kích hoạt lượt này.');
    return { activated: true, cancelled: false, logs };
  }
  // t-scrap-iron-scarecrow — Bù Nhìn Sắt Phế Liệu: vô hiệu hóa đòn đánh rồi úp lại.
  if (trap.id === 't-scrap-iron-scarecrow') {
    game.field[defenderPlayer].st[trapIndex] = { ...trap, faceDown: true };
    logs.push('Bù Nhìn Sắt Phế Liệu vô hiệu hóa đòn tấn công và được úp lại.');
    return { activated: true, cancelled: true, logs };
  }

  // t-negate-attack / t-silent-commander — vô hiệu hóa đòn đánh và kết thúc Battle Phase.
  game.field[defenderPlayer].st[trapIndex] = null;
  game.grave[defenderPlayer].push(trap);
  if (trap.id === 't-silent-commander') {
    drawCards(game, defenderPlayer, 2, logs);
    logs.push('Người Chỉ Huy Câm Lặng kết thúc Battle Phase.');
  } else {
    logs.push('Vô Hiệu Hóa Đòn Tấn Công kết thúc Battle Phase.');
  }
  game.phaseIndex = 4;
  return { activated: true, cancelled: true, logs };
}
