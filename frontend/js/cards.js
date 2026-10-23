/* ============================================================
   cards.js – Dữ liệu thẻ mẫu (demo)
   type: monster | spell | trap
   image: local artwork path (optional; card-art.js supplies SVG fallback)
   ============================================================ */

const CARDS = [
  // ---------- Quái thú ----------
  { id:'m01', type:'monster', name:'Rồng Trắng Mắt Xanh', image:'assets/images/artwork/Blue-Eyes White Dragon.png', atk:3000, def:2500, lv:8,  attr:'LIGHT', race:'Rồng' },
  { id:'m02', type:'monster', name:'Phù Thuỷ Đen',        image:'assets/images/artwork/Dark Magician.png', atk:2500, def:2100, lv:7,  attr:'DARK',  race:'Phù thuỷ' },
  { id:'m03', type:'monster', name:'Chiến Binh Hỗn Mang', atk:2300, def:1500, lv:6,  attr:'WIND',  race:'Chiến binh' },
  { id:'m04', type:'monster', name:'Kuriboh',             atk:300,  def:200,  lv:1,  attr:'DARK',  race:'Ác ma' },
  { id:'m05', type:'monster', name:'Thần Bầu Trời',       atk:2100, def:1600, lv:5,  attr:'LIGHT', race:'Thiên thần' },
  { id:'m06', type:'monster', name:'Kiếm Sĩ Huyền Thoại', atk:1800, def:1200, lv:4,  attr:'EARTH', race:'Chiến binh' },
  { id:'m07', type:'monster', name:'Rồng Lửa Đỏ',         atk:2400, def:2000, lv:6,  attr:'FIRE',  race:'Rồng' },
  { id:'m08', type:'monster', name:'Nữ Pháp Sư Ánh Sáng', atk:1600, def:1400, lv:4,  attr:'LIGHT', race:'Phù thuỷ' },
  { id:'m09', type:'monster', name:'Golem Đá Cổ',         atk:1500, def:2200, lv:5,  attr:'EARTH', race:'Đá' },
  { id:'m10', type:'monster', name:'Tinh Linh Nước',      atk:1200, def:1800, lv:3,  attr:'WATER', race:'Thuỷ' },

  // ---------- Phép ----------
  { id:'s01', type:'spell', name:'Hố Đen' },
  { id:'s02', type:'spell', name:'Tái Sinh', image:'assets/images/artwork/Monster Reborn.png' },
  { id:'s03', type:'spell', name:'Kiếm Ma Thuật' },
  { id:'s04', type:'spell', name:'Lốc Xoáy' },

  // ---------- Bẫy ----------
  { id:'t01', type:'trap', name:'Lỗ Hổng Trọng Lực' },
  { id:'t02', type:'trap', name:'Gương Phản Chiếu' },
  { id:'t03', type:'trap', name:'Hố Tử Thần' }
];

/** Lấy thẻ theo id */
function getCard(id){
  return CARDS.find(c => c.id === id) || null;
}

/** Trộn mảng (Fisher–Yates) */
function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tạo bộ bài 40 lá từ danh sách mẫu */
function normalizeDuelCard(card){
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

function buildDeck(size = 40, catalog = CARDS){
  const playableCards = catalog.map(normalizeDuelCard).filter(Boolean);
  if (!playableCards.length) throw new Error('Danh sách bài đấu không có lá bài hợp lệ.');
  const deck = [];
  let i = 0;
  while (deck.length < size){
    deck.push(playableCards[i % playableCards.length]);
    i++;
  }
  return shuffle(deck);
}

/**
 * Render HTML cho 1 lá thẻ.
 * @param {object} card  dữ liệu thẻ
 * @param {object} opt   { faceDown, size:'sm'|'xs', classes }
 */
function cardHTML(card, opt = {}){
  const cls = ['card'];
  if (opt.size === 'sm') cls.push('card--sm');
  if (opt.size === 'xs') cls.push('card--xs');
  if (card){
    if (card.type === 'spell') cls.push('card--spell');
    if (card.type === 'trap')  cls.push('card--trap');
  }
  if (opt.faceDown) cls.push('card--back');
  if (opt.classes) cls.push(opt.classes);

  const widthValue = typeof opt.width === 'number' ? `${opt.width}px` : opt.width;
  const style = widthValue ? ` style="--cw:${widthValue}"` : '';
  const category = card && (card.category || card.type);
  const monsterType = card && (card.monsterType || 'Thường');
  const safeAttribute = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  if (opt.faceDown || !card){
    const backCanvas = opt.faceDown
      ? '<canvas class="card__back-canvas" aria-hidden="true"></canvas>'
      : '';
    return `<div class="${cls.join(' ')}"${style}>${backCanvas}<div class="card__frame"></div></div>`;
  }

  const art = typeof cardArtHTML === 'function'
    ? cardArtHTML(card)
    : `<div class="card__art-fallback" aria-hidden="true">${card.type === 'monster' ? '✦' : card.type === 'spell' ? '✧' : '◇'}</div>`;
  const stats = card.type === 'monster'
    ? `<div class="card__stats"><span>ATK ${card.atk}</span><span>DEF ${card.def}</span></div>`
    : `<div class="card__stats"><span>${card.type === 'spell' ? 'PHÉP' : 'BẪY'}</span><span>★</span></div>`;

  return `<div class="${cls.join(' ')}"${style} data-id="${safeAttribute(card.id)}" data-card-category="${safeAttribute(category)}" data-card-monster-type="${safeAttribute(monsterType)}">
      <canvas class="card-frame-canvas" aria-hidden="true"></canvas>
      <div class="card__frame">
        <div class="card__name">${card.name}</div>
        <div class="card__art">${art}</div>
        ${stats}
      </div>
    </div>`;
}