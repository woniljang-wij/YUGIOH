/* Generates original SVG card art until a card has a local artwork image. */
(function (global) {
  'use strict';

  const palettes = {
    monster: ['#67ddff', '#6652dc', '#f6d784'],
    spell: ['#71f0b3', '#2587bd', '#dcfff0'],
    trap: ['#f58add', '#762f8d', '#ffe0f7']
  };

  const attributes = {
    LIGHT: ['#fff0a1', '#e98c43', '#fff9d9'],
    DARK: ['#bd8cff', '#45227f', '#f1d7ff'],
    WIND: ['#9af5df', '#267f9c', '#e0fff7'],
    EARTH: ['#e1b477', '#70502f', '#fff0cb'],
    FIRE: ['#ffb45f', '#c73847', '#ffe2ac'],
    WATER: ['#86e5ff', '#285cc4', '#e0faff']
  };
  const artworkCache = new Map();

  function escapeAttribute(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function artworkSvg(card) {
    const cacheKey = `${card.id || card.name || 'card'}:${card.type}:${card.attr || ''}`;
    if (artworkCache.has(cacheKey)) return artworkCache.get(cacheKey);

    const palette = attributes[card.attr] || palettes[card.type] || palettes.monster;
    const [primary, secondary, highlight] = palette;
    const seed = Array.from(String(card.id || card.name || 'card'))
      .reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const starPoints = Array.from({ length: 9 }, (_, index) => {
      const x = 22 + ((seed * (index + 7) * 17) % 196);
      const y = 24 + ((seed * (index + 11) * 23) % 252);
      const radius = index % 3 === 0 ? 2.2 : 1.2;
      return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${highlight}" opacity=".78"/>`;
    }).join('');

    let subject;
    if (card.type === 'spell') {
      subject = `
        <circle cx="120" cy="145" r="69" fill="url(#orb)" opacity=".9"/>
        <circle cx="120" cy="145" r="48" fill="none" stroke="${highlight}" stroke-width="2" opacity=".72"/>
        <circle cx="120" cy="145" r="29" fill="none" stroke="${primary}" stroke-width="5" stroke-dasharray="18 9" transform="rotate(-24 120 145)"/>
        <path d="M120 83 130 132 179 145 130 158 120 207 110 158 61 145 110 132Z" fill="${highlight}" opacity=".88"/>
        <circle cx="120" cy="145" r="12" fill="#fff" opacity=".92"/>
        <path d="M46 220Q120 187 194 220M60 238Q120 211 180 238" fill="none" stroke="${primary}" stroke-width="3" opacity=".75"/>`;
    } else if (card.type === 'trap') {
      subject = `
        <path d="M120 67 139 98 176 88 169 127 202 145 169 164 176 202 139 192 120 224 101 192 64 202 71 164 38 145 71 127 64 88 101 98Z" fill="url(#orb)" stroke="${highlight}" stroke-width="3"/>
        <circle cx="120" cy="145" r="38" fill="#100b27" stroke="${primary}" stroke-width="4"/>
        <circle cx="120" cy="145" r="23" fill="none" stroke="${highlight}" stroke-width="2" stroke-dasharray="4 5"/>
        <path d="M108 128 137 145 108 162Z" fill="${highlight}"/>
        <path d="M50 225 81 198M190 225 159 198M55 76 83 100M185 76 157 100" stroke="${primary}" stroke-width="5" stroke-linecap="round"/>`;
    } else {
      subject = `
        <path d="M116 103Q79 67 39 79Q55 115 87 133Q56 129 34 147Q65 172 96 160L105 189 120 215 135 189 144 160Q175 172 206 147Q184 129 153 133Q185 115 201 79Q161 67 124 103Z" fill="url(#creature)" stroke="${highlight}" stroke-width="3" stroke-linejoin="round"/>
        <path d="m120 91 14 24-14 23-14-23Z" fill="${highlight}" opacity=".95"/>
        <path d="M106 143 91 157 111 172 120 199 129 172 149 157 134 143Z" fill="#17132f" stroke="${primary}" stroke-width="3"/>
        <path d="m98 126 12 5-12 6M142 126l-12 5 12 6" fill="none" stroke="#fff8d8" stroke-width="4" stroke-linecap="round"/>
        <path d="M101 189 85 211M139 189l16 22M120 201v24" stroke="${highlight}" stroke-width="4" stroke-linecap="round"/>`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300">
      <defs>
        <linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${secondary}"/><stop offset="1" stop-color="#09091c"/></linearGradient>
        <radialGradient id="orb"><stop stop-color="${highlight}"/><stop offset=".42" stop-color="${primary}"/><stop offset="1" stop-color="${secondary}" stop-opacity=".08"/></radialGradient>
        <linearGradient id="creature" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${highlight}"/><stop offset=".42" stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient>
        <pattern id="runes" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 12h24M12 0v24" stroke="${highlight}" stroke-opacity=".08"/></pattern>
      </defs>
      <rect width="240" height="300" fill="url(#backdrop)"/>
      <rect width="240" height="300" fill="url(#runes)"/>
      <path d="M120 18 220 75v150l-100 57L20 225V75Z" fill="none" stroke="${primary}" stroke-opacity=".38" stroke-width="2"/>
      <ellipse cx="120" cy="153" rx="91" ry="112" fill="url(#orb)" opacity=".32"/>
      ${starPoints}
      ${subject}
      <path d="M14 270Q120 242 226 270" fill="none" stroke="${highlight}" stroke-opacity=".42" stroke-width="2"/>
    </svg>`;

    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    artworkCache.set(cacheKey, source);
    return source;
  }

  function imageHTML(card) {
    const fallback = artworkSvg(card);
    const source = card.image || fallback;
    return `<img class="card__art-image" data-card-art src="${escapeAttribute(source)}" data-art-fallback="${escapeAttribute(fallback)}" alt="" draggable="false" decoding="async">`;
  }

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-card-art')) return;
    if (image.dataset.fallbackApplied) return;
    image.dataset.fallbackApplied = 'true';
    image.src = image.dataset.artFallback;
  }, true);

  global.cardArtHTML = imageHTML;
})(window);
