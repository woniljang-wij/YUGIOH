import { useEffect, useReducer, useRef, useState } from 'react';
import { CardFace } from '../components/CardFace.jsx';
import { getDuelCardArtwork } from './duelCardArt.js';
import { playDuelCardMotion } from './duelMotion.js';
import { useDuelCanvasEngine } from './useDuelCanvasEngine.js';

const LP_START = 8000;
const PHASES = [
  { id: 'draw', label: 'RÚT' },
  { id: 'stand', label: 'CHỜ' },
  { id: 'main1', label: 'CH.1' },
  { id: 'battle', label: 'Đ.ĐẤU' },
  { id: 'main2', label: 'CH.2' },
  { id: 'end', label: 'K.THÚC' }
];

const SAMPLE_CARDS = [
  { id: 'm01', type: 'monster', name: 'Rồng Trắng Mắt Xanh', image: 'assets/images/artwork/Blue-Eyes White Dragon.png', atk: 3000, def: 2500, lv: 8, attr: 'LIGHT', race: 'Rồng' },
  { id: 'm02', type: 'monster', name: 'Phù Thuỷ Đen', image: 'assets/images/artwork/Dark Magician.png', atk: 2500, def: 2100, lv: 7, attr: 'DARK', race: 'Phù thuỷ' },
  { id: 'm03', type: 'monster', name: 'Chiến Binh Hỗn Mang', atk: 2300, def: 1500, lv: 6, attr: 'WIND', race: 'Chiến binh' },
  { id: 'm04', type: 'monster', name: 'Kuriboh', atk: 300, def: 200, lv: 1, attr: 'DARK', race: 'Ác ma' },
  { id: 'm05', type: 'monster', name: 'Thần Bầu Trời', atk: 2100, def: 1600, lv: 5, attr: 'LIGHT', race: 'Thiên thần' },
  { id: 'm06', type: 'monster', name: 'Kiếm Sĩ Huyền Thoại', atk: 1800, def: 1200, lv: 4, attr: 'EARTH', race: 'Chiến binh' },
  { id: 'm07', type: 'monster', name: 'Rồng Lửa Đỏ', atk: 2400, def: 2000, lv: 6, attr: 'FIRE', race: 'Rồng' },
  { id: 'm08', type: 'monster', name: 'Nữ Pháp Sư Ánh Sáng', atk: 1600, def: 1400, lv: 4, attr: 'LIGHT', race: 'Phù thuỷ' },
  { id: 'm09', type: 'monster', name: 'Golem Đá Cổ', atk: 1500, def: 2200, lv: 5, attr: 'EARTH', race: 'Đá' },
  { id: 'm10', type: 'monster', name: 'Tinh Linh Nước', atk: 1200, def: 1800, lv: 3, attr: 'WATER', race: 'Thuỷ' },
  { id: 's01', type: 'spell', name: 'Hố Đen' },
  { id: 's02', type: 'spell', name: 'Tái Sinh', image: 'assets/images/artwork/Monster Reborn.png' },
  { id: 's03', type: 'spell', name: 'Kiếm Ma Thuật' },
  { id: 's04', type: 'spell', name: 'Lốc Xoáy' },
  { id: 't01', type: 'trap', name: 'Lỗ Hổng Trọng Lực' },
  { id: 't02', type: 'trap', name: 'Gương Phản Chiếu' },
  { id: 't03', type: 'trap', name: 'Hố Tử Thần' }
];

function normalizeCard(card) {
  if (!card) return null;
  const category = String(card.category || card.type || '').toLowerCase();
  if (!['monster', 'fusion', 'spell', 'trap'].includes(category)) return null;
  return {
    ...card,
    category,
    type: category === 'fusion' ? 'monster' : category,
    attr: card.attribute || card.attr || '',
    lv: card.level || card.lv || 0
  };
}

function shuffle(cards) {
  const result = cards.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function buildDeck(size, catalog) {
  const cards = catalog.map(normalizeCard).filter(Boolean);
  if (!cards.length) throw new Error('Danh sách bài đấu không có lá bài hợp lệ.');
  return shuffle(Array.from({ length: size }, (_, index) => cards[index % cards.length]));
}

function createGame(catalog, warning) {
  const game = {
    turn: 'me',
    phaseIndex: 0,
    turnCount: 1,
    selected: null,
    lp: { me: LP_START, opp: LP_START },
    busy: false,
    over: false,
    deck: { me: buildDeck(40, catalog), opp: buildDeck(40, catalog) },
    hand: { me: [], opp: [] },
    grave: { me: [], opp: [] },
    field: {
      me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
      opp: { mon: Array(5).fill(null), st: Array(5).fill(null) }
    },
    log: [],
    logId: 0,
    motionId: 0,
    logOpen: false,
    ready: true
  };

  for (let index = 0; index < 5; index += 1) {
    game.hand.me.push(game.deck.me.pop());
    game.hand.opp.push(game.deck.opp.pop());
  }
  appendLog(game, 'Trận đấu bắt đầu! LP mỗi bên: <b>8000</b>.', 'sys');
  appendLog(game, 'Lượt 1 thuộc về bạn – chọn bài trên tay rồi bấm vào ô trên sân.', 'me');
  if (warning) {
    appendLog(
      game,
      `Không tải được danh mục bài từ máy chủ; trận đấu đang dùng bộ bài mẫu. ${warning}`,
      'sys'
    );
  }
  return game;
}

function appendLog(game, message, kind = 'sys') {
  game.log = [
    { id: game.logId++, message, kind: kind === 'me' || kind === 'opp' ? kind : 'sys' },
    ...game.log
  ].slice(0, 60);
}

function draw(game, who, silent = false) {
  if (!game.deck[who].length) {
    appendLog(game, 'Bộ bài đã hết!', 'sys');
    return null;
  }
  const card = game.deck[who].pop();
  game.hand[who].push(card);
  if (!silent) appendLog(game, `<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> rút 1 lá bài.`, who);
  return card;
}

function withChangedGame(state, mutate) {
  const next = {
    ...state,
    lp: { ...state.lp },
    deck: { me: state.deck.me.slice(), opp: state.deck.opp.slice() },
    hand: { me: state.hand.me.slice(), opp: state.hand.opp.slice() },
    grave: { me: state.grave.me.slice(), opp: state.grave.opp.slice() },
    field: {
      me: { mon: state.field.me.mon.slice(), st: state.field.me.st.slice() },
      opp: { mon: state.field.opp.mon.slice(), st: state.field.opp.st.slice() }
    },
    log: state.log.slice()
  };
  mutate(next);
  return next;
}

function placeCard(game, who, kind, index, card) {
  const placedCard = { ...card, _motion: `${game.motionId++}-summon` };
  game.field[who][kind][index] = placedCard;
  appendLog(
    game,
    `<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> triệu hồi <b>${card.name}</b>.`,
    who
  );
}

function reducer(state, action) {
  if (action.type === 'initialize') return action.game;
  if (!state.ready) return state;

  switch (action.type) {
    case 'select': {
      const card = state.hand.me[action.index];
      if (!card) return state;
      return withChangedGame(state, (game) => {
        game.selected = action.index;
        appendLog(game, `Đã chọn <b>${card.name}</b> – bấm vào ô trống trên sân để đặt.`, 'me');
      });
    }
    case 'zone': {
      const { who, kind, index } = action;
      const card = state.field[who][kind][index];
      if (state.over) return state;
      if (card) {
        if (who === 'opp' && card.faceDown) {
          return withChangedGame(state, (game) => appendLog(game, 'Lá bài của đối thủ đang úp.', 'sys'));
        }
        return withChangedGame(state, (game) => {
          game.field[who][kind][index] = { ...card, faceDown: false };
          const extra = card.atk ? ` — ATK ${card.atk} / DEF ${card.def}` : '';
          appendLog(game, `<b>${card.name}</b>${extra}`, who);
        });
      }
      if (state.turn !== 'me' || state.busy) return state;
      if (who !== 'me') {
        return withChangedGame(state, (game) => appendLog(game, 'Không thể đặt bài sang sân đối thủ.', 'sys'));
      }
      if (state.selected === null) {
        return withChangedGame(state, (game) => appendLog(game, 'Hãy chọn một lá bài trên tay trước.', 'sys'));
      }
      const selectedCard = state.hand.me[state.selected];
      if (kind === 'st' && selectedCard.type === 'monster') {
        return withChangedGame(state, (game) => appendLog(game, 'Ô Phép/Bẫy chỉ đặt được thẻ Phép hoặc Bẫy.', 'sys'));
      }
      if (kind === 'mon' && selectedCard.type !== 'monster') {
        return withChangedGame(state, (game) => appendLog(game, 'Ô Quái thú chỉ đặt được thẻ Quái thú.', 'sys'));
      }
      if (kind === 'mon' && state.field.me.mon.filter(Boolean).length >= 5) {
        return withChangedGame(state, (game) => appendLog(game, 'Sân quái thú đã đầy.', 'sys'));
      }
      return withChangedGame(state, (game) => {
        const played = game.hand.me.splice(state.selected, 1)[0];
        placeCard(game, 'me', kind, index, played);
        game.selected = null;
        if (game.phaseIndex < 2) game.phaseIndex = 2;
      });
    }
    case 'draw': {
      if (state.turn !== 'me' || state.busy) return state;
      return withChangedGame(state, (game) => {
        const card = draw(game, 'me');
        if (card) game.hand.me[game.hand.me.length - 1] = { ...card, _motion: `${game.motionId++}-draw` };
      });
    }
    case 'autoPlace': {
      if (state.over) return state;
      return withChangedGame(state, (game) => {
        let guard = 0;
        while (game.hand.me.length && guard++ < 10) {
          const card = game.hand.me[0];
          const kind = card.type === 'monster' ? 'mon' : 'st';
          const free = game.field.me[kind].map((item, index) => item ? -1 : index).filter((index) => index >= 0);
          if (!free.length) break;
          const index = free[Math.floor(Math.random() * free.length)];
          game.hand.me.shift();
          placeCard(game, 'me', kind, index, card);
        }
        game.selected = null;
      });
    }
    case 'endTurn':
      if (state.busy || state.over || state.turn !== 'me') return state;
      return withChangedGame(state, (game) => {
        game.busy = true;
        game.selected = null;
        game.turn = 'opp';
        game.phaseIndex = 0;
        appendLog(game, '— Kết thúc lượt của bạn —', 'sys');
      });
    case 'opponentDraw':
      if (state.over) return state;
      return withChangedGame(state, (game) => draw(game, 'opp'));
    case 'opponentPlay':
      if (state.over) return state;
      return withChangedGame(state, (game) => {
        const card = game.hand.opp[game.hand.opp.length - 1];
        if (!card) return;
        const kind = card.type === 'monster' ? 'mon' : 'st';
        const free = game.field.opp[kind].map((item, index) => item ? -1 : index).filter((index) => index >= 0);
        if (!free.length) {
          appendLog(game, 'Đối thủ không còn ô trống.', 'opp');
          return;
        }
        const index = free[Math.floor(Math.random() * free.length)];
        game.hand.opp.pop();
        game.field.opp[kind][index] = { ...card, faceDown: true };
        appendLog(game, 'Đối thủ đặt 1 lá bài úp trên sân.', 'opp');
      });
    case 'finishTurn':
      return withChangedGame(state, (game) => {
        game.turnCount += 1;
        game.turn = 'me';
        game.phaseIndex = 0;
        game.busy = false;
        const card = draw(game, 'me');
        if (card) game.hand.me[game.hand.me.length - 1] = { ...card, _motion: `${game.motionId++}-draw` };
        appendLog(game, '— Đến lượt bạn —', 'me');
      });
    case 'toggleLog':
      return { ...state, logOpen: !state.logOpen };
    default:
      return state;
  }
}

function LogMessage({ message }) {
  return message.split(/(<b>.*?<\/b>)/g).map((part, index) => {
    const bold = part.match(/^<b>(.*?)<\/b>$/);
    return bold ? <strong key={index}>{bold[1]}</strong> : part;
  });
}

function CardBack() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    function draw() {
      const size = window.getComputedStyle(canvas);
      const width = parseFloat(size.width);
      const height = parseFloat(size.height);
      if (!width || !height) return;

      const pixelRatio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
      const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);

      const scale = Math.min(pixelWidth / 265, pixelHeight / 357);
      const offsetX = (pixelWidth - 265 * scale) / 2;
      const offsetY = (pixelHeight - 357 * scale) / 2;
      context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      context.fillStyle = '#d6ae7a';
      context.fillRect(0, 0, 265, 357);
      context.strokeStyle = '#21120d';
      context.lineWidth = 1.5;
      context.strokeRect(0.75, 0.75, 263.5, 355.5);
      context.fillStyle = '#28150f';
      context.fillRect(9.5, 8.5, 246, 340);
      context.save();
      context.beginPath();
      context.rect(12, 11, 241, 335);
      context.clip();
      context.fillStyle = '#764131';
      context.fillRect(12, 11, 241, 335);
      context.restore();
      context.beginPath();
      context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
      context.fillStyle = '#4b4c46';
      context.fill();
      context.beginPath();
      context.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
      context.strokeStyle = '#100c09';
      context.lineWidth = 2.5;
      context.stroke();
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);
  return <canvas ref={canvasRef} className="card__back-canvas" aria-hidden="true"></canvas>;
}

function DuelCard({ card, size, faceDown = false, selected = false, handIndex, onClick, animation }) {
  const cardRef = useRef(null);
  const classNames = [
    'card',
    !faceDown && !card?.faceDown ? 'card--shared-face' : '',
    size === 'sm' ? 'card--sm' : '',
    size === 'xs' ? 'card--xs' : '',
    card?.type === 'spell' ? 'card--spell' : '',
    card?.type === 'trap' ? 'card--trap' : '',
    faceDown || card?.faceDown ? 'card--back' : '',
    selected ? 'card--sel' : ''
  ].filter(Boolean).join(' ');
  const category = card && (card.category || card.type);
  const monsterType = card && (card.monsterType || 'Thường');

  useEffect(() => {
    if (animation && cardRef.current) playDuelCardMotion(cardRef.current, animation);
  }, [animation]);

  if (faceDown || card?.faceDown) {
    return (
      <div ref={cardRef} className={classNames} onClick={onClick}>
        <CardBack />
        <div className="card__frame"></div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={classNames}
      data-hand={handIndex}
      data-id={card?.id}
      data-card-category={category}
      data-card-monster-type={monsterType}
      data-attribute={card?.attribute || card?.attr}
      data-level={card?.level ?? card?.lv}
      style={size ? undefined : { '--cw': 'clamp(27px,3.8vw,34px)' }}
      onClick={onClick}
    >
      <CardFace
        card={card.monsterType ? card : { ...card, monsterType }}
        className="duel-card-face"
        fallbackImage={getDuelCardArtwork(card).fallback}
      />
    </div>
  );
}

function formatLP(value) {
  return value.toLocaleString('vi-VN');
}

function DuelPage() {
  const [game, dispatch] = useReducer(reducer, null);
  const [hoveredZone, setHoveredZone] = useState('');
  const [cocosError, setCocosError] = useState('');
  const [cocosFallback, setCocosFallback] = useState(false);
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  useDuelCanvasEngine(canvasRef, game, (message) => {
    setCocosFallback(true);
    setCocosError(message);
  });

  useEffect(() => {
    document.body.className = 'duel';
    document.title = 'Yu-Gi-Oh! H5 — Bàn đấu';
    const background = document.querySelector('.bg-image');
    const backgroundImage = background && getComputedStyle(background).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)?.[2];
    if (backgroundImage) {
      const probe = new Image();
      probe.addEventListener('load', () => document.body.classList.add('has-bg'), { once: true });
      probe.src = backgroundImage;
    }
    let cancelled = false;

    async function initialize() {
      let catalog = SAMPLE_CARDS;
      let warning = '';
      try {
        const response = await fetch('/api/cards', { credentials: 'same-origin' });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error('Máy chủ không trả về danh mục bài dạng JSON.');
        }
        if (!response.ok) throw new Error(result.error || 'Không tải được danh mục bài.');
        if (!result || !Array.isArray(result.cards)) {
          throw new Error('Danh mục bài cần có thuộc tính cards dạng mảng.');
        }
        catalog = result.cards.map(normalizeCard).filter(Boolean);
        if (!catalog.length) throw new Error('Danh mục bài không có lá bài hợp lệ.');
      } catch (error) {
        warning = error.message || 'Không thể tải danh mục bài.';
        console.error('Không thể tải danh mục bài cho trận đấu:', error);
      }
      if (!cancelled) dispatch({ type: 'initialize', game: createGame(catalog, warning) });
    }

    initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const tracks = ['/assets/music/bgm/duel1.mp3', '/assets/music/bgm/duel2.mp3'];
    let trackIndex = Math.floor(Math.random() * tracks.length);
    let wantsPlayback = true;
    let disposed = false;
    try {
      wantsPlayback = window.localStorage.getItem('yugioh.music') !== 'off';
    } catch (error) {
      console.error('Không thể đọc tùy chọn nhạc nền:', error);
    }

    audio.preload = 'auto';
    audio.volume = 0.55;
    audio.src = tracks[trackIndex];

    function removeGestureListeners() {
      document.removeEventListener('pointerdown', onUserGesture, true);
      document.removeEventListener('keydown', onUserGesture, true);
    }
    function startPlayback() {
      if (disposed) return;
      const request = audio.play();
      if (!request || typeof request.then !== 'function') return;
      request.then(removeGestureListeners).catch((error) => {
        console.warn('Nhạc nền duel đang chờ tương tác để phát:', error);
        document.addEventListener('pointerdown', onUserGesture, true);
        document.addEventListener('keydown', onUserGesture, true);
      });
    }
    function onUserGesture() {
      if (wantsPlayback && audio.paused) startPlayback();
    }
    function handleEnded() {
      trackIndex = (trackIndex + 1) % tracks.length;
      audio.src = tracks[trackIndex];
      if (wantsPlayback) startPlayback();
    }
    function handleError() {
      console.error('Không tải được nhạc nền duel:', audio.currentSrc || audio.src);
    }
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    if (wantsPlayback) {
      document.addEventListener('pointerdown', onUserGesture, true);
      document.addEventListener('keydown', onUserGesture, true);
      startPlayback();
    }
    return () => {
      disposed = true;
      removeGestureListeners();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
    };
  }, []);

  useEffect(() => {
    if (!game?.busy) return undefined;
    const drawTimer = window.setTimeout(() => dispatch({ type: 'opponentDraw' }), 500);
    const playTimer = window.setTimeout(() => dispatch({ type: 'opponentPlay' }), 1200);
    const finishTimer = window.setTimeout(() => dispatch({ type: 'finishTurn' }), 2400);
    return () => {
      window.clearTimeout(drawTimer);
      window.clearTimeout(playTimer);
      window.clearTimeout(finishTimer);
    };
  }, [game?.busy]);

  function renderZone(who, kind, index) {
    const zoneKey = `${who}-${kind}-${index}`;
    const card = game?.field[who][kind][index];
    return (
      <div
        key={zoneKey}
        className={`zone${kind === 'st' ? ' zone--st' : ''}${game?.selected != null && hoveredZone === zoneKey ? ' is-hover' : ''}`}
        data-zone={zoneKey}
        data-occupied={card ? '1' : '0'}
        onClick={() => dispatch({ type: 'zone', who, kind, index })}
        onMouseEnter={() => setHoveredZone(zoneKey)}
        onMouseLeave={() => setHoveredZone('')}
      >
        {card && (
          <DuelCard
            card={card}
            faceDown={card.faceDown}
            animation={card._motion?.endsWith('-summon') ? card._motion : undefined}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="bg-image bg-image--duel" aria-hidden="true"></div>
      <div className="bg-layer"></div>
      <div className="bg-grid"></div>

      <div className="rotate-hint" role="status" aria-live="polite">
        <div className="rotate-hint__card">
          <div className="rotate-hint__device" aria-hidden="true"></div>
          <p className="rotate-hint__eyebrow">TRẬN ĐẤU TOÀN MÀN HÌNH</p>
          <h1>Hãy xoay ngang thiết bị</h1>
          <p>Bàn đấu sẽ hiển thị đầy đủ và dễ thao tác hơn ở chế độ ngang.</p>
        </div>
      </div>

      <div className="wrap">
        <header className="hud">
          <div className={`pinfo${game?.turn === 'me' ? ' is-turn' : ''}`} data-js="pinfo-me">
            <div className="avatar">🧑<span className="avatar__lvl">Lv.4</span></div>
            <div className="pinfo__body">
              <div className="pinfo__row">
                <span className="pinfo__name">CốtNgoàiChg</span>
                <span className={`pinfo__lp${game && game.lp.me <= 2000 ? ' is-low' : ''}`} data-js="lp-me">{formatLP(game?.lp.me ?? LP_START)}</span>
              </div>
              <div className="bar bar--hp" data-js="lpbar-me"><i style={{ width: `${Math.max(0, Math.min(100, (game?.lp.me ?? LP_START) / LP_START * 100))}%` }}></i></div>
            </div>
          </div>
          <div className="hud__spacer"></div>
          <div className="phases" data-js="phases">
            {PHASES.map((phase, index) => <span key={phase.id} className={`phase${(game?.phaseIndex ?? 0) === index ? ' is-active' : ''}`}>{phase.label}</span>)}
          </div>
          <div className="turnflag" data-js="turn-flag">
            {game?.turn === 'opp' ? '🔴 LƯỢT ĐỐI THỦ' : '🟢 LƯỢT CỦA BẠN'} &nbsp;·&nbsp; Lượt {game?.turnCount ?? 1}
          </div>
          <div className="hud__spacer"></div>
          <div className={`pinfo${game?.turn === 'opp' ? ' is-turn' : ''}`} data-js="pinfo-opp">
            <div className="pinfo__body">
              <div className="pinfo__row">
                <span className={`pinfo__lp${game && game.lp.opp <= 2000 ? ' is-low' : ''}`} data-js="lp-opp">{formatLP(game?.lp.opp ?? LP_START)}</span>
                <span className="pinfo__name">Đối thủ</span>
              </div>
              <div className="bar bar--hp" data-js="lpbar-opp"><i style={{ width: `${Math.max(0, Math.min(100, (game?.lp.opp ?? LP_START) / LP_START * 100))}%` }}></i></div>
            </div>
            <div className="avatar">😈<span className="avatar__lvl">Lv.6</span></div>
          </div>
          <button className="icon-btn" data-js="btn-log" title="Nhật ký" onClick={() => dispatch({ type: 'toggleLog' })}>
            <svg viewBox="0 0 24 24" className="ico"><path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M7 9h10M7 13h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </header>

        <main className={`board${cocosFallback ? ' cocos-fallback' : ''}`}>
          <canvas ref={canvasRef} id="cocosDuelCanvas" width="960" height="640" aria-label="Bàn đấu Cocos2d Canvas"></canvas>
          <div className="cocos-error" data-js="cocos-error" role="status" hidden={!cocosError}>{cocosError}</div>
          <section className="side side--opp">
            <div className="rail">
              <div className="slot slot--extra" data-soon><div>EXTRA<b data-js="extra-opp">{game?.field.opp.mon.filter(Boolean).length ?? 0}</b></div></div>
              <div className="slot slot--deck" data-js="deck-opp" data-soon><div>BỘ BÀI<b>{game?.deck.opp.length ?? 40}</b></div></div>
              <div className="slot slot--grave" data-soon><i className={`slot__badge${game?.grave.opp.length ? '' : ' is-zero'}`} data-js="grave-badge-opp">{game?.grave.opp.length ?? 0}</i><div>MỘ<b data-js="grave-opp">{game?.grave.opp.length ?? 0}</b></div></div>
            </div>
            <div className="side__field">
              <div className="row">{Array.from({ length: 5 }, (_, index) => renderZone('opp', 'mon', index))}</div>
              <div className="row">{Array.from({ length: 5 }, (_, index) => renderZone('opp', 'st', index))}</div>
            </div>
          </section>
          <div className="midline"><span className="midline__label">Duel Field</span></div>
          <section className="side side--me">
            <div className="side__field">
              <div className="row">{Array.from({ length: 5 }, (_, index) => renderZone('me', 'mon', index))}</div>
              <div className="row">{Array.from({ length: 5 }, (_, index) => renderZone('me', 'st', index))}</div>
            </div>
            <div className="rail">
              <div className="slot slot--extra" data-soon><div>EXTRA<b data-js="extra-me">{game?.field.me.mon.filter(Boolean).length ?? 0}</b></div></div>
              <div className="slot slot--deck" data-js="deck-me" data-soon><div>BỘ BÀI<b>{game?.deck.me.length ?? 40}</b></div></div>
              <div className="slot slot--grave" data-soon><i className={`slot__badge${game?.grave.me.length ? '' : ' is-zero'}`} data-js="grave-badge-me">{game?.grave.me.length ?? 0}</i><div>MỘ<b data-js="grave-me">{game?.grave.me.length ?? 0}</b></div></div>
            </div>
          </section>
        </main>

        <div className="hand hand--opponent">
          <div data-js="hand-opp">
            {!!game?.hand.opp.length && (
              <div className="hand__opponent-list" aria-label={`Đối thủ đang giữ ${game.hand.opp.length} lá bài`}>
                {game.hand.opp.map((card, index) => (
                  <div key={`${card.id}-${index}`} className="card card--back card--xs">
                    <CardBack />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="hud hud--bottom">
          <button className="btn btn--sm" data-js="btn-draw" aria-label="Rút bài" onClick={() => dispatch({ type: 'draw' })}>🃏<span>Rút bài</span></button>
          <button className="btn btn--sm" data-js="btn-auto" aria-label="Tự động đặt bài" onClick={() => dispatch({ type: 'autoPlace' })}>⚡<span>Tự động</span></button>
          <div className="hand">
            <div className="hand__list" data-js="hand-me">
              {game?.ready && !game.hand.me.length && <div className="hand__empty">Tay bài trống</div>}
              {game?.hand.me.map((card, index) => (
                <DuelCard
                  key={`${card.id}-${index}`}
                  card={card}
                  size="sm"
                  handIndex={index}
                  selected={game.selected === index}
                  animation={card._motion?.endsWith('-draw') ? card._motion : undefined}
                  onClick={() => dispatch({ type: 'select', index })}
                />
              ))}
            </div>
          </div>
          <button className="btn btn--gold" data-js="btn-end" disabled={!game || game.turn !== 'me' || game.busy || game.over} onClick={() => dispatch({ type: 'endTurn' })}>⏭ Kết thúc lượt</button>
        </section>
      </div>

      <audio ref={audioRef} id="duelMusic" preload="auto" aria-hidden="true"></audio>

      <aside className={`log panel${game?.logOpen ? ' is-open' : ''}`} data-js="log">
        <div className="panel__head">📜 Nhật ký trận đấu</div>
        <div className="log__list" data-js="log-list">
          {game?.log.map((entry) => <div key={entry.id} className={`log__line is-${entry.kind}`}><LogMessage message={entry.message} /></div>)}
        </div>
      </aside>

      <div className="result" data-js="result">
        <div className="result__box">
          <h2 className="result__title" data-js="result-title">CHIẾN THẮNG</h2>
          <p className="result__lp" data-js="result-lp">LP còn lại: 8.000</p>
          <div className="result__actions">
            <button className="btn btn--gold" data-js="btn-rematch" onClick={() => window.location.reload()}>🔁 Đấu lại</button>
            <button className="btn" data-js="btn-exit" onClick={() => { window.location.href = 'index.html'; }}>🏠 Về sảnh</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default DuelPage;
