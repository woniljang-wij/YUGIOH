/* ============================================================
   duel.js – Logic bàn đấu (demo)
   - Rút bài, đặt quái thú / phép / bẫy bằng click
   - Kết thúc lượt, đổi phase, đối thủ máy đơn giản
   - Ghi log, cập nhật LP, màn hình kết thúc trận
   ============================================================ */

const LP_START = 8000;

const PHASES = [
  { id:'draw',   label:'RÚT'   },
  { id:'stand',  label:'CHỜ'   },
  { id:'main1',  label:'CH.1'  },
  { id:'battle', label:'Đ.ĐẤU'},
  { id:'main2',  label:'CH.2'  },
  { id:'end',    label:'K.THÚC'}
];

const state = {
  turn: 'me',              // 'me' | 'opp'
  phaseIndex: 0,
  turnCount: 1,
  selected: null,          // { card, from, index }
  lp: { me: LP_START, opp: LP_START },
  busy: false,
  over: false,
  deck:   { me: [], opp: [] },
  hand:   { me: [], opp: [] },
  grave:  { me: [], opp: [] },
  field:  { me: { mon: Array(5).fill(null), st: Array(5).fill(null) },
            opp: { mon: Array(5).fill(null), st: Array(5).fill(null) } }
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- LOG ---------------- */
function log(text, kind = 'sys'){
  const box = $('[data-js="log-list"]');
  const el = document.createElement('div');
  el.className = 'log__line is-' + (kind === 'me' ? 'me' : kind === 'opp' ? 'opp' : 'sys');
  el.innerHTML = text;
  box.prepend(el);
  while (box.children.length > 60) box.lastChild.remove();
}

/* ---------------- RÚT BÀI ---------------- */
function draw(who, silent){
  if (state.deck[who].length === 0){
    log('Bộ bài đã hết!', 'sys');
    return null;
  }
  const card = state.deck[who].pop();
  state.hand[who].push(card);
  if (!silent) log(`<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> rút 1 lá bài.`, who);
  return card;
}

/* ---------------- RENDER ---------------- */
function renderLP(){
  ['me','opp'].forEach(who => {
    const v = state.lp[who];
    const num = $(`[data-js="lp-${who}"]`);
    num.textContent = v.toLocaleString('vi-VN');
    num.classList.toggle('is-low', v <= 2000);
    $(`[data-js="lpbar-${who}"] > i`).style.width =
      Math.max(0, Math.min(100, v / LP_START * 100)) + '%';
  });
}

function renderCardFrames(root){
  if (typeof window.drawCardBacks === 'function') window.drawCardBacks(root);
  if (typeof window.drawCardFrame !== 'function') return;
  root.querySelectorAll('.card-frame-canvas').forEach(canvas => {
    const card = canvas.closest('.card');
    window.drawCardFrame(
      canvas,
      card.dataset.cardCategory,
      card.dataset.cardMonsterType
    );
  });
}

function renderField(){
  if (window.CocosDuelEngine) window.CocosDuelEngine.render(state);
  ['me','opp'].forEach(who => {
    ['mon','st'].forEach(kind => {
      state.field[who][kind].forEach((card, i) => {
        const z = $(`[data-zone="${who}-${kind}-${i}"]`);
        z.innerHTML = card
          ? cardHTML(card, { width: 'clamp(27px,3.8vw,34px)', faceDown: card.faceDown })
          : '';
        z.dataset.occupied = card ? '1' : '0';
      });
    });
    $(`[data-js="deck-${who}"] b`).textContent  = state.deck[who].length;
    $(`[data-js="grave-${who}"]`).textContent = state.grave[who].length;
    $(`[data-js="extra-${who}"]`).textContent = state.field[who].mon.filter(Boolean).length;
    const gb = $(`[data-js="grave-badge-${who}"]`);
    gb.textContent = state.grave[who].length;
    gb.classList.toggle('is-zero', state.grave[who].length === 0);
  });
  renderCardFrames(document);
}

function renderHand(){
  const box = $('[data-js="hand-me"]');
  if (!state.hand.me.length){
    box.innerHTML = '<div class="hand__empty">Tay bài trống</div>';
    return;
  }
  box.innerHTML = state.hand.me.map((c, i) =>
    cardHTML(c, { size:'sm' })
      .replace('class="card', `data-hand="${i}" class="card`)
  ).join('');
  renderCardFrames(box);
}

function renderHandOpp(){
  const n = state.hand.opp.length;
  $('[data-js="hand-opp"]').innerHTML = n
    ? '<div class="hand__opponent-list" aria-label="Đối thủ đang giữ ' + n + ' lá bài">' +
      Array.from({ length:n }, () =>
        '<div class="card card--back card--xs"><canvas class="card__back-canvas" aria-hidden="true"></canvas></div>'
      ).join('') + '</div>'
    : '';
  renderCardFrames($('[data-js="hand-opp"]'));
}

function renderPhases(){
  $('[data-js="phases"]').innerHTML = PHASES.map((p, i) =>
    `<span class="phase ${i === state.phaseIndex ? 'is-active' : ''}">${p.label}</span>`
  ).join('');
}

function renderTurn(){
  const myTurn = state.turn === 'me';
  $('[data-js="turn-flag"]').innerHTML =
    (myTurn ? '🟢 LƯỢT CỦA BẠN' : '🔴 LƯỢT ĐỐI THỦ') +
    ` &nbsp;·&nbsp; Lượt ${state.turnCount}`;
  $('[data-js="pinfo-opp"]').classList.toggle('is-turn', !myTurn);
  $('[data-js="pinfo-me"]').classList.toggle('is-turn', myTurn);
  $('[data-js="btn-end"]').disabled = !myTurn || state.busy || state.over;
}

function renderAll(){
  renderLP(); renderField(); renderHand(); renderHandOpp();
  renderPhases(); renderTurn();
}

/* ---------------- CHỌN / ĐẶT BÀI ---------------- */
function clearSelection(){
  state.selected = null;
  $$('.card--sel').forEach(el => el.classList.remove('card--sel'));
  $$('.zone.is-hover').forEach(el => el.classList.remove('is-hover'));
}

function selectHand(index){
  const card = state.hand.me[index];
  if (!card) return;
  clearSelection();
  state.selected = { card, from:'hand', index };
  const el = $(`[data-hand="${index}"]`);
  if (el) el.classList.add('card--sel');
  if (window.CocosDuelEngine) window.CocosDuelEngine.render(state);
  log(`Đã chọn <b>${card.name}</b> – bấm vào ô trống trên sân để đặt.`, 'me');
}

function placeCard(who, kind, i, card){
  state.field[who][kind][i] = card;
  renderField();
  const cardElement = $(`[data-zone="${who}-${kind}-${i}"] .card`);
  if (window.CocosMotion) window.CocosMotion.play(cardElement, 'summon');
  log(`<b>${who === 'me' ? 'Bạn' : 'Đối thủ'}</b> triệu hồi <b>${card.name}</b>.`, who);
}

function animateDrawnCard(index){
  const cardElement = $(`[data-js="hand-me"] [data-hand="${index}"]`);
  if (window.CocosMotion) window.CocosMotion.play(cardElement, 'draw');
}

function handleZoneClick(who, kind, i){
  if (state.over) return;
  const zoneCard = state.field[who][kind][i];

  // Ô đã có bài -> lật/xem thông tin
  if (zoneCard){
    if (who === 'opp' && zoneCard.faceDown){
      log('Lá bài của đối thủ đang úp.', 'sys');
      return;
    }
    zoneCard.faceDown = false;
    renderField();
    const extra = zoneCard.atk ? ` — ATK ${zoneCard.atk} / DEF ${zoneCard.def}` : '';
    log(`<b>${zoneCard.name}</b>${extra}`, who);
    return;
  }

  if (state.turn !== 'me' || state.busy) return;
  if (who !== 'me'){ log('Không thể đặt bài sang sân đối thủ.', 'sys'); return; }

  const sel = state.selected;
  if (!sel){ log('Hãy chọn một lá bài trên tay trước.', 'sys'); return; }

  const card = sel.card;
  if (kind === 'st' && card.type === 'monster'){
    log('Ô Phép/Bẫy chỉ đặt được thẻ Phép hoặc Bẫy.', 'sys');
    return;
  }
  if (kind === 'mon' && card.type !== 'monster'){
    log('Ô Quái thú chỉ đặt được thẻ Quái thú.', 'sys');
    return;
  }
  if (kind === 'mon' && state.field.me.mon.filter(Boolean).length >= 5){
    log('Sân quái thú đã đầy.', 'sys');
    return;
  }

  state.hand.me.splice(sel.index, 1);
  placeCard('me', kind, i, card);
  clearSelection();
  renderHand();

  if (state.phaseIndex < 2) state.phaseIndex = 2;   // sang Main 1
  renderPhases();
}

/* ---------------- LƯỢT ---------------- */
function endTurn(){
  if (state.busy || state.over || state.turn !== 'me') return;
  state.busy = true;
  clearSelection();
  state.turn = 'opp';
  state.phaseIndex = 0;
  renderAll();
  log('— Kết thúc lượt của bạn —', 'sys');

  window.GameScheduler.sequence([
    {
      at: 500,
      run() {
        draw('opp');
        renderHandOpp();
      }
    },
    { at: 1200, run: oppPlay },
    {
      at: 2400,
      run() {
        state.turnCount++;
        state.turn = 'me';
        state.phaseIndex = 0;
        state.busy = false;
        const drawnCard = draw('me');
        renderAll();
        if (drawnCard) animateDrawnCard(state.hand.me.length - 1);
        log('— Đến lượt bạn —', 'me');
      }
    }
  ]);
}

function oppPlay(){
  if (state.over) return;
  const card = state.hand.opp[state.hand.opp.length - 1];
  if (!card) return;

  const kind = card.type === 'monster' ? 'mon' : 'st';
  const free = state.field.opp[kind].map((c, i) => c ? -1 : i).filter(i => i >= 0);
  if (!free.length){ log('Đối thủ không còn ô trống.', 'opp'); return; }

  const idx = free[Math.floor(Math.random() * free.length)];
  state.hand.opp.pop();
  state.field.opp[kind][idx] = { ...card, faceDown: true };
  renderField();
  renderHandOpp();
  log('Đối thủ đặt 1 lá bài úp trên sân.', 'opp');
}

function autoPlace(){
  if (state.over) return;
  let guard = 0;
  while (state.hand.me.length && guard++ < 10){
    const card = state.hand.me[0];
    const kind = card.type === 'monster' ? 'mon' : 'st';
    const free = state.field.me[kind].map((c, i) => c ? -1 : i).filter(i => i >= 0);
    if (!free.length) break;
    const idx = free[Math.floor(Math.random() * free.length)];
    state.hand.me.shift();
    placeCard('me', kind, idx, card);
  }
  renderHand();
}

/* ---------------- KHỞI TẠO ---------------- */
async function loadDuelCatalog(){
  const response = await fetch('/api/cards', { credentials:'same-origin' });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error('Máy chủ không trả về danh mục bài dạng JSON.');
  }
  if (!response.ok) throw new Error(result.error || 'Không tải được danh mục bài.');
  if (!result || !Array.isArray(result.cards))
    throw new Error('Danh mục bài cần có thuộc tính cards dạng mảng.');
  const cards = result.cards.map(normalizeDuelCard).filter(Boolean);
  if (!cards.length) throw new Error('Danh mục bài không có lá bài hợp lệ.');
  return cards;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof buildDeck !== 'function') return;   // cards.js chưa nạp

  let catalog = CARDS;
  let catalogWarning = null;
  try {
    catalog = await loadDuelCatalog();
  } catch (error) {
    catalogWarning = error;
    console.error('Không thể tải danh mục bài cho trận đấu:', error);
  }

  state.deck.me  = buildDeck(40, catalog);
  state.deck.opp = buildDeck(40, catalog);

  for (let i = 0; i < 5; i++){ draw('me', true); draw('opp', true); }

  renderAll();
  log('Trận đấu bắt đầu! LP mỗi bên: <b>8000</b>.', 'sys');
  log('Lượt 1 thuộc về bạn – chọn bài trên tay rồi bấm vào ô trên sân.', 'me');
  if (catalogWarning) {
    log('Không tải được danh mục bài từ máy chủ; trận đấu đang dùng bộ bài mẫu. ' +
      catalogWarning.message, 'sys');
  }

  document.addEventListener('click', (e) => {
    const handCard = e.target.closest('[data-hand]');
    if (handCard){ selectHand(Number(handCard.dataset.hand)); return; }

    const zone = e.target.closest('[data-zone]');
    if (zone){
      const parts = zone.dataset.zone.split('-');
      handleZoneClick(parts[0], parts[1], Number(parts[2]));
    }
  });

  // hover ô sân khi đang chọn bài
  document.addEventListener('mouseover', (e) => {
    const zone = e.target.closest('.zone');
    if (zone && state.selected)
      zone.classList.add('is-hover');
  });
  document.addEventListener('mouseout', (e) => {
    const zone = e.target.closest('.zone');
    if (zone) zone.classList.remove('is-hover');
  });

  $('[data-js="btn-end"]').addEventListener('click', endTurn);

  $('[data-js="btn-draw"]').addEventListener('click', () => {
    if (state.turn !== 'me' || state.busy) return;
    const c = draw('me');
    if (c){
      renderHand();
      animateDrawnCard(state.hand.me.length - 1);
    }
  });

  $('[data-js="btn-auto"]').addEventListener('click', autoPlace);

  $('[data-js="btn-log"]').addEventListener('click', () => {
    $('[data-js="log"]').classList.toggle('is-open');
  });

  $('[data-js="btn-rematch"]').addEventListener('click', () => window.location.reload());
  $('[data-js="btn-exit"]').addEventListener('click', () => { window.location.href = 'index.html'; });
});