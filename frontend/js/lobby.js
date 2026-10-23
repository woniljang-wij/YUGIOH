/* ============================================================
   lobby.js – Sảnh chính H5
   Chỉ xử lý: đổi tên người chơi + toast cho các nút "sắp mở"
   (Chưa có chức năng gameplay – theo yêu cầu)
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Toast ---------- */
  let timer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-show'), 1700);
  }

  document.addEventListener('DOMContentLoaded', function () {

    /* ---------- Nút chưa làm ---------- */
    document.querySelectorAll('[data-soon]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toast('🚧 ' + btn.dataset.soon + ' – sắp ra mắt!');
      });
    });

    /* ---------- Thư Viện ---------- */
    const libraryModal = document.getElementById('libraryModal');
    const libraryButton = document.querySelector('[data-js="btn-library"]');
    if (libraryModal && libraryButton) {
      const libraryCloseButtons = libraryModal.querySelectorAll('[data-library-close]');
      const libraryTabs = libraryModal.querySelectorAll('[data-library-tab]');
      const libraryGrid = libraryModal.querySelector('.library-screen__grid');
      const libraryCount = libraryModal.querySelector('.library-screen__count');
      const cardDetail = libraryModal.querySelector('#cardDetail');
      const cardDetailDialog = cardDetail.querySelector('.card-detail__dialog');
      let libraryCards = [];
      let libraryCardsLoaded = false;
      let libraryLoadPromise = null;
      let activeLibraryCategory = 'monster';
      let previousCardFocus = null;

      const setLibraryCount = function (count) {
        libraryCount.replaceChildren(
          document.createTextNode(String(count)),
          document.createTextNode(' '),
          Object.assign(document.createElement('span'), { textContent: '/' }),
          document.createTextNode(' '),
          document.createTextNode(String(count) + ' '),
          Object.assign(document.createElement('small'), { textContent: 'lá bài' })
        );
      };

      const makeCardText = function (tag, className, value) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = value;
        return element;
      };

      const fitCardName = function (name) {
        name.style.fontSize = '';
        name.style.whiteSpace = 'nowrap';
        name.style.textOverflow = 'clip';
        name.style.overflowWrap = 'normal';

        const nameStyle = window.getComputedStyle(name);
        const availableWidth = name.clientWidth -
          parseFloat(nameStyle.paddingLeft) -
          parseFloat(nameStyle.paddingRight);
        if (!availableWidth) return;

        const baseSize = parseFloat(nameStyle.fontSize);
        const canvas = fitCardName.canvas || (fitCardName.canvas = document.createElement('canvas'));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D is not available to fit the card name.');
        const fontPrefix = nameStyle.fontStyle === 'normal' ? '' : nameStyle.fontStyle + ' ';
        const fontWeight = nameStyle.fontWeight + ' ';
        const fontFamily = ' ' + nameStyle.fontFamily;
        const textWidthAt = function (size) {
          const measurementSize = Math.max(10, size);
          context.font = fontPrefix + fontWeight + measurementSize + 'px' + fontFamily;
          return context.measureText(name.textContent).width * size / measurementSize;
        };
        if (textWidthAt(baseSize) <= availableWidth) return;

        let minimum = 5;
        let maximum = baseSize;
        for (let iteration = 0; iteration < 10; iteration += 1) {
          const candidate = (minimum + maximum) / 2;
          if (textWidthAt(candidate) <= availableWidth * 0.96) {
            minimum = candidate;
          } else {
            maximum = candidate;
          }
        }
        name.style.fontSize = minimum + 'px';
        if (textWidthAt(minimum) > availableWidth) {
          name.style.whiteSpace = 'normal';
          name.style.overflowWrap = 'anywhere';
        }
      };

      const isMonsterCard = function (card) {
        return card.category === 'monster' || card.category === 'fusion';
      };

      const getCardTypeLabel = function (card) {
        if (card.category === 'fusion') return 'Quái thú Dung hợp - ' + card.monsterType;
        if (card.category === 'monster') return card.monsterType;
        const subtype = card[card.category + 'Type'];
        const normalizedSubtype = String(subtype || '').toLowerCase();
        const subtypeLabels = {
          normal: 'Thường',
          'quick-play': 'Tốc hành',
          equip: 'Trang bị',
          field: 'Môi trường',
          ritual: 'Nghi thức',
          continuous: 'Liên tục',
          counter: 'Phản kích',
          'tức thời': 'Tốc hành',
          'liên tục': 'Liên tục',
          'phản kích': 'Phản kích'
        };
        return (card.category === 'spell' ? 'Phép' : 'Bẫy') +
          ' - ' + (subtypeLabels[normalizedSubtype] || subtype);
      };

      const getCardSubtype = function (card) {
        const subtype = card[card.category + 'Type'];
        const normalizedSubtype = String(subtype || '').toLowerCase();
        const subtypeKeys = {
          'quick-play': 'quick-play',
          'tức thời': 'quick-play',
          equip: 'equip',
          field: 'field',
          ritual: 'ritual',
          continuous: 'continuous',
          'liên tục': 'continuous',
          counter: 'counter',
          'phản kích': 'counter'
        };
        return subtypeKeys[normalizedSubtype] || '';
      };

      const createSubtypeIcon = function (card) {
        const type = getCardSubtype(card);
        if (!type) return null;

        const svgNamespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('class', 'card-detail__subtype-icon card-detail__subtype-icon--' + type);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-label', getCardTypeLabel(card));
        svg.setAttribute('role', 'img');
        svg.setAttribute('focusable', 'false');

        const path = document.createElementNS(svgNamespace, 'path');
        const paths = {
          'quick-play': 'M13.5 1.5 4.8 13h5.8l-.8 9.5L19.2 11h-5.8l.1-9.5Z',
          equip: 'M5 3l5 5m-7 1 6-6m5 4 7 7m-4-10 3 3-8 8-3-3m3 3-4 4-3-3 4-4m10-1 2 2',
          field: 'm12 2 2.4 6.5L21 11l-6.6 2.5L12 20l-2.4-6.5L3 11l6.6-2.5L12 2Zm0 6v6m-3-3h6',
          ritual: 'M12 2c1.5 3-1 4.5 1 6 1.8-1 2.2-2.5 2.2-3.5C20 9 19 14 16 17a5.5 5.5 0 0 1-9-4c0-2.5 1.5-4.5 3.5-6 .1 2 1 3 2 3.5C14 8.5 12 6 12 2Zm0 11c-2 2-2.2 3.4-1 5a2.5 2.5 0 0 0 4-2c0-1.2-1-2.2-1.5-3-.2 1-1 1.5-1.5 2-.3-.8 0-1.3 0-2Z',
          continuous: 'M12 12c-2.3-3.1-4.3-4.8-6.3-4.8a4.8 4.8 0 1 0 0 9.6c2 0 4-1.7 6.3-4.8Zm0 0c2.3-3.1 4.3-4.8 6.3-4.8a4.8 4.8 0 1 1 0 9.6c-2 0-4-1.7-6.3-4.8Z',
          counter: 'M20 11a8 8 0 1 0 1 4m-1-9v5h-5m-4-3 3 3-3 3'
        };
        path.setAttribute('d', paths[type]);
        path.setAttribute('class', 'card-detail__subtype-path');
        svg.appendChild(path);
        return svg;
      };

      const createCardFace = function (card) {
        const face = document.createElement('div');
        face.className = 'card-detail__card';
        if (card.category === 'fusion') {
          face.classList.add('card-detail__card--fusion');
        } else if (card.category === 'monster' && card.monsterType !== 'Thường') {
          face.classList.add('card-detail__card--effect');
        } else if (card.category === 'spell' || card.category === 'trap') {
          face.classList.add('card-detail__card--' + card.category);
        }
        const frame = document.createElement('canvas');
        frame.className = 'card-detail__frame-canvas';
        frame.setAttribute('aria-hidden', 'true');
        face.appendChild(frame);
        window.drawCardFrame(frame, card.category, card.monsterType);
        const attributes = {
          DARK: '闇',
          LIGHT: '光',
          EARTH: '地',
          WATER: '水',
          FIRE: '炎',
          WIND: '風',
          DIVINE: '神'
        };

        const heading = document.createElement('header');
        heading.className = 'card-detail__card-header';
        heading.appendChild(makeCardText('span', 'card-detail__card-name', card.name));
        const attribute = makeCardText(
          'span',
          'card-detail__attribute' +
            (card.category === 'spell' || card.category === 'trap'
              ? ' card-detail__attribute--' + card.category
              : ''),
          card.category === 'spell' ? '魔' :
            card.category === 'trap' ? '罠' :
              attributes[card.attribute] || card.attribute || ''
        );
        if (isMonsterCard(card) && card.attribute) {
          attribute.classList.add('card-detail__attribute--' + card.attribute.toLowerCase());
        }
        attribute.setAttribute('aria-label', card.attribute || card.category);
        heading.appendChild(attribute);
        face.appendChild(heading);
        const stars = document.createElement('div');
        stars.className = 'card-detail__card-stars';
        if (isMonsterCard(card)) {
          stars.setAttribute('aria-label', card.level + ' sao');
          for (let i = 0; i < card.level; i += 1) {
            stars.appendChild(makeCardText('span', 'card-detail__star', '★'));
          }
        } else {
          stars.classList.add('card-detail__card-icon');
          const subtypeIcon = createSubtypeIcon(card);
          if (subtypeIcon) stars.appendChild(subtypeIcon);
        }
        face.appendChild(stars);

        const artwork = document.createElement('div');
        artwork.className = 'card-detail__card-art';
        if (card.rarity) {
          artwork.appendChild(makeCardText(
            'span',
            'card-detail__rarity',
            card.rarity === 'ULTRA RARE' ? 'UR' : card.rarity
          ));
        }
        if (card.image) {
          const image = document.createElement('img');
          image.src = card.image;
          image.alt = card.name;
          artwork.appendChild(image);
        } else {
          const placeholder = makeCardText(
            'div',
            'card-detail__art-missing',
            isMonsterCard(card) ? '✦' : card.category === 'spell' ? '魔' : '罠'
          );
          placeholder.appendChild(makeCardText('small', '', 'Ảnh bổ sung sau'));
          artwork.appendChild(placeholder);
        }
        face.appendChild(artwork);

        const cardType = card.category === 'spell'
          ? 'Bài Phép'
          : card.category === 'trap'
            ? 'Bài Bẫy'
            : card.category === 'fusion'
              ? '[' + card.race + ' / Dung hợp / ' + card.monsterType + ']'
              : card.category === 'monster'
                ? '[' + card.race + ' / ' + card.monsterType + ']'
                : '[' + getCardTypeLabel(card) + ']';
        const typePanel = makeCardText('div', 'card-detail__card-type', '');
        if (card.category === 'spell' || card.category === 'trap') {
          const ornament = document.createElement('canvas');
          ornament.className = 'card-detail__type-ornament';
          ornament.setAttribute('aria-hidden', 'true');
          typePanel.appendChild(ornament);
          typePanel.appendChild(makeCardText('span', 'card-detail__card-type-label', cardType));
          face.appendChild(typePanel);
          window.drawCardTypeOrnament(ornament, card.category);
        } else {
          typePanel.textContent = cardType;
          face.appendChild(typePanel);
        }

        if (isMonsterCard(card)) {
          const stats = document.createElement('div');
          stats.className = 'card-detail__stats';
          [['ATK', card.atk], ['DEF', card.def]].forEach(function (stat) {
            const cell = document.createElement('div');
            cell.appendChild(makeCardText('span', '', stat[0]));
            cell.appendChild(makeCardText('b', '', String(stat[1])));
            stats.appendChild(cell);
          });
          face.appendChild(stats);
        }
        return face;
      };

      const renderLibraryCard = function (card) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'library-card library-card--' + card.category;
        tile.dataset.cardId = card.id;
        tile.setAttribute('aria-label', 'Xem thông tin lá ' + card.name);
        if (card.image) {
          const image = document.createElement('img');
          image.className = 'library-card__image';
          image.src = card.image;
          image.alt = card.name;
          image.loading = 'lazy';
          tile.appendChild(image);
        } else {
          const placeholder = makeCardText(
            'span',
            'library-card__art-placeholder',
            card.category === 'fusion' ? '融合' :
              card.category === 'monster' ? '✦' : card.category === 'spell' ? '魔' : '罠'
          );
          placeholder.setAttribute('aria-hidden', 'true');
          tile.appendChild(placeholder);
        }
        return tile;
      };

      const openCardDetail = function (card, source) {
        previousCardFocus = source;
        cardDetail.querySelector('#cardDetailTitle').textContent = card.name;
        cardDetail.querySelector('[data-card-detail-type]').textContent = isMonsterCard(card)
          ? card.race + ' - ' + (card.category === 'fusion' ? 'Dung hợp - ' : '') + card.monsterType
          : getCardTypeLabel(card);
        cardDetail.querySelector('[data-card-detail-keyword]').textContent = card.keyword || '—';
        cardDetail.querySelector('[data-card-detail-description]').textContent = card.description;
        const descriptionSection = cardDetail.querySelector('[data-card-detail-description]')
          .closest('.card-detail__section');
        descriptionSection.hidden = card.category === 'spell' || card.category === 'trap';
        cardDetail.querySelector('[data-card-detail-limit]').textContent =
          'Trong cùng bộ bài được có tối đa ' + (card.maxCopies || 3) + ' lá';
        const skillsSection = cardDetail.querySelector('[data-card-detail-skills-section]');
        const skillsList = cardDetail.querySelector('[data-card-detail-skills]');
        skillsList.replaceChildren();
        skillsSection.querySelector('h3').textContent = 'Kỹ năng';
        skillsSection.hidden = !card.skills || card.skills.length === 0;
        (card.skills || []).forEach(function (skill) {
          const row = document.createElement('article');
          row.className = 'card-detail__skill';
          row.appendChild(makeCardText('span', 'card-detail__skill-icon', '✦'));
          const copy = document.createElement('div');
          copy.className = 'card-detail__skill-copy';
          copy.appendChild(makeCardText(
            'h4',
            '',
            card.category === 'spell' || card.category === 'trap' ? 'Kỹ năng' : skill.name
          ));
          if (skill.description) {
            copy.appendChild(makeCardText('p', '', skill.description));
          }
          if (Array.isArray(skill.effects)) {
            const effectsList = document.createElement('ol');
            effectsList.className = 'card-detail__effect-options';
            skill.effects.forEach(function (effect) {
              const option = document.createElement('li');
              option.className = 'card-detail__effect-option';
              option.appendChild(makeCardText('h5', '', effect.name));
              if (effect.condition) {
                option.appendChild(makeCardText('p', 'card-detail__effect-condition', effect.condition));
              }
              if (effect.description) {
                option.appendChild(makeCardText('p', '', effect.description));
              }
              if (effect.restriction) {
                option.appendChild(makeCardText('p', 'card-detail__effect-restriction', effect.restriction));
              }
              effectsList.appendChild(option);
            });
            copy.appendChild(effectsList);
          }
          row.appendChild(copy);
          skillsList.appendChild(row);
        });
        cardDetail.querySelector('.card-detail__card').replaceWith(createCardFace(card));
        cardDetail.querySelector('[data-card-detail-quantity]').textContent =
          String(card.quantity || 0);
        const fusion = cardDetail.querySelector('[data-card-detail-fusion]');
        fusion.replaceChildren();
        (card.fusion || []).forEach(function (recipe) {
          const row = document.createElement('div');
          row.className = 'card-detail__recipe';
          recipe.materials.forEach(function (name, index) {
            if (index > 0) row.appendChild(makeCardText('span', 'card-detail__operator', '+'));
            row.appendChild(makeCardText('span', 'card-detail__fusion-card', name));
          });
          row.appendChild(makeCardText('span', 'card-detail__operator', '='));
          row.appendChild(makeCardText('span', 'card-detail__fusion-card', recipe.result));
          fusion.appendChild(row);
        });
        if (!card.fusion || card.fusion.length === 0) {
          fusion.appendChild(makeCardText('span', 'card-detail__no-fusion', 'Chưa có công thức dung hợp.'));
        }
        cardDetail.querySelector('.card-detail__fusion').hidden = !isMonsterCard(card);
        cardDetail.classList.remove('is-closing');
        cardDetail.hidden = false;
        requestAnimationFrame(function () {
          const cardName = cardDetail.querySelector('.card-detail__card-name');
          if (cardName) fitCardName(cardName);
        });
        cardDetailDialog.focus();
      };

      window.addEventListener('resize', function () {
        if (cardDetail.hidden) return;
        const cardName = cardDetail.querySelector('.card-detail__card-name');
        if (cardName) fitCardName(cardName);
      });

      const closeCardDetail = function () {
        if (cardDetail.hidden || cardDetail.classList.contains('is-closing')) return;
        cardDetail.classList.add('is-closing');
      };

      cardDetailDialog.addEventListener('animationend', function (event) {
        if (event.target !== cardDetailDialog ||
            event.animationName !== 'shopCardDetailOut' ||
            !cardDetail.classList.contains('is-closing')) return;
        const openedFromShop = libraryModal.classList.contains('is-card-detail-only');
        cardDetail.hidden = true;
        cardDetail.classList.remove('is-closing');
        if (openedFromShop) {
          libraryModal.classList.remove('is-card-detail-only');
          libraryModal.hidden = true;
        } else if (previousCardFocus && previousCardFocus.closest('.shop-reveal')) {
          libraryModal.classList.remove('is-card-detail-only');
          libraryModal.hidden = true;
        }
        if (previousCardFocus && previousCardFocus.isConnected) previousCardFocus.focus();
        previousCardFocus = null;
      });

      window.libraryCardUI = Object.freeze({
        createCardFace: createCardFace,
        fitCardName: fitCardName,
        openCardDetail: function (card, source) {
          if (source && !source.closest('#libraryModal')) {
            libraryModal.classList.add('is-card-detail-only');
            libraryModal.hidden = false;
          } else {
            libraryModal.classList.remove('is-card-detail-only');
          }
          openCardDetail(card, source);
        }
      });

      const renderLibraryCards = function () {
        const cards = libraryCards.filter(function (card) {
          return card.category === activeLibraryCategory;
        });
        libraryGrid.replaceChildren();
        setLibraryCount(cards.length);

        if (cards.length === 0) {
          libraryGrid.appendChild(makeCardText('p', 'library-screen__empty', 'Danh mục này chưa có lá bài.'));
          return;
        }

        cards.forEach(function (card) {
          libraryGrid.appendChild(renderLibraryCard(card));
        });
      };

      const loadLibraryCards = function () {
        if (libraryCardsLoaded) {
          renderLibraryCards();
          return Promise.resolve();
        }
        if (libraryLoadPromise) return libraryLoadPromise;

        libraryGrid.replaceChildren(makeCardText('p', 'library-screen__empty', 'Đang tải dữ liệu bài...'));
        libraryLoadPromise = fetch('/api/cards')
          .then(function (response) {
            if (!response.ok) throw new Error('Không tải được danh mục bài (' + response.status + ').');
            return response.json();
          })
          .then(function (data) {
            if (!data || !Array.isArray(data.cards)) {
              throw new Error('Dữ liệu thư viện cần có thuộc tính cards dạng mảng.');
            }
            libraryCards = data.cards;
            libraryCardsLoaded = true;
            renderLibraryCards();
          })
          .catch(function (error) {
            console.error('Không thể tải dữ liệu thư viện bài:', error);
            libraryGrid.replaceChildren(makeCardText(
              'p',
              'library-screen__empty library-screen__empty--error',
              'Không tải được dữ liệu bài. Hãy kiểm tra máy chủ rồi mở lại thư viện.'
            ));
            libraryLoadPromise = null;
          });
        return libraryLoadPromise;
      };

      const closeLibrary = function () {
        libraryModal.hidden = true;
        libraryButton.focus();
      };

      libraryButton.addEventListener('click', function () {
        libraryModal.hidden = false;
        const selectedCategory = libraryModal.querySelector('[data-library-tab].is-selected') || libraryTabs[0];
        if (selectedCategory) selectedCategory.focus();
        loadLibraryCards();
      });

      libraryCloseButtons.forEach(function (button) {
        button.addEventListener('click', closeLibrary);
      });

      libraryGrid.addEventListener('click', function (event) {
        const tile = event.target.closest('[data-card-id]');
        if (!tile) return;
        const card = libraryCards.find(function (item) {
          return item.id === tile.dataset.cardId;
        });
        if (card) openCardDetail(card, tile);
      });

      cardDetail.querySelectorAll('[data-card-detail-close]').forEach(function (button) {
        button.addEventListener('click', closeCardDetail);
      });

      libraryTabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          libraryTabs.forEach(function (item) {
            const active = item === tab;
            item.classList.toggle('is-selected', active);
            item.setAttribute('aria-pressed', String(active));
          });
          activeLibraryCategory = tab.dataset.libraryTab;
          if (libraryCardsLoaded) renderLibraryCards();
        });
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !cardDetail.hidden) {
          event.preventDefault();
          closeCardDetail();
        } else if (event.key === 'Escape' && !libraryModal.hidden) {
          event.preventDefault();
          closeLibrary();
        }
      });

    }

    /* ---------- Chọn nhân vật ---------- */
    const characterPicker = document.getElementById('characterSelect');
    const characterButton = document.querySelector('[data-js="btn-characters"]');
    const characterBack = document.querySelector('[data-js="characters-back"]');
    const characterConfirm = document.querySelector('[data-js="characters-confirm"]');
    const characterPreview = document.getElementById('characterPreview');
    const characterPreviewName = document.getElementById('characterPreviewName');
    const characterOptions = document.querySelectorAll('[data-character-choice]');
    const characters = {
      'kaiba-seto': { name: 'Kaiba Seto', image: 'assets/images/hero/kaiba-seto.png' },
      'muto-yugi': { name: 'Muto Yugi', image: 'assets/images/hero/muto-yugi.png' },
      'jonouchi-katsuya': { name: 'Jonouchi Katsuya', image: 'assets/images/hero/jonouchi-katsuya.png' }
    };
    let activeCharacterId = 'jonouchi-katsuya';
    let pendingCharacterId = activeCharacterId;

    const renderCharacterPreview = function (characterId) {
      const character = characters[characterId];
      if (!character) return;
      pendingCharacterId = characterId;
      characterPreview.src = character.image;
      characterPreview.alt = character.name;
      characterPreviewName.textContent = character.name;
      characterOptions.forEach(function (option) {
        const selected = option.dataset.characterChoice === characterId;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
    };

    const duelistImage = document.getElementById('duelistImg');
    const duelistWind = document.getElementById('duelistWind');
    const applyDuelistCharacter = function (character) {
      if (duelistImage) {
        duelistImage.src = character.image;
        duelistImage.alt = character.name;
      }
      const profileCardAvatar = document.getElementById('profileCardAvatar');
      const profileAvatar = document.getElementById('profileAvatar');
      if (profileCardAvatar) profileCardAvatar.src = character.image;
      if (profileAvatar) profileAvatar.src = character.image;
      if (duelistWind) {
        const maskUrl = new URL(character.image, document.baseURI).href;
        duelistWind.style.setProperty('--duelist-mask-image', `url("${maskUrl}")`);
      }
    };
    applyDuelistCharacter(characters[activeCharacterId]);

    fetch('/api/session')
      .then(function (response) {
        if (!response.ok) throw new Error('Không thể tải nhân vật đã lưu.');
        return response.json();
      })
      .then(function (result) {
        const characterId = result && result.user && result.user.selected_character_id;
        if (!characters[characterId]) {
          throw new Error('Tài khoản chưa có nhân vật đại diện hợp lệ.');
        }
        activeCharacterId = characterId;
        renderCharacterPreview(activeCharacterId);
        applyDuelistCharacter(characters[activeCharacterId]);
      })
      .catch(function (error) {
        console.error('Could not load saved character:', error);
        toast('Không tải được nhân vật đã lưu. Vui lòng tải lại trang.');
      });

    if (characterPicker && characterButton && characterBack && characterConfirm) {
      const closeCharacterPicker = function () {
        characterPicker.hidden = true;
        characterButton.focus();
      };

      characterButton.addEventListener('click', function () {
        renderCharacterPreview(activeCharacterId);
        characterPicker.hidden = false;
        characterBack.focus();
      });
      characterBack.addEventListener('click', closeCharacterPicker);

      characterOptions.forEach(function (option) {
        option.addEventListener('click', function () {
          renderCharacterPreview(option.dataset.characterChoice);
        });
      });

      characterConfirm.addEventListener('click', async function () {
        const character = characters[pendingCharacterId];
        if (!character) return;
        characterConfirm.disabled = true;
        try {
          const response = await fetch('/api/profile/character', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: pendingCharacterId })
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || 'Không thể lưu nhân vật đã chọn.');
          }
          activeCharacterId = pendingCharacterId;
          applyDuelistCharacter(character);
          closeCharacterPicker();
          toast('Đã chọn ' + character.name);
        } catch (error) {
          console.error('Could not save selected character:', error);
          toast(error.message || 'Không thể lưu nhân vật đã chọn.');
        } finally {
          characterConfirm.disabled = false;
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !characterPicker.hidden) closeCharacterPicker();
      });
    }

    /* ---------- Đấu Trường -> bàn đấu ---------- */
    const duelBtn = document.querySelector('[data-js="btn-duel"]');
    if (duelBtn) {
      duelBtn.addEventListener('click', function () {
        window.location.href = 'duel.html';
      });
    }

    /* ---------- Ảnh nhân vật: hiện khung chờ nếu chưa có file ---------- */
    const dBox = document.getElementById('duelist');
    const dImg = document.getElementById('duelistImg');
    if (dBox && dImg) {
      const markEmpty = function () { dBox.classList.add('is-empty'); };
      const markReady = function () { dBox.classList.remove('is-empty'); };

      dImg.addEventListener('error', markEmpty);
      dImg.addEventListener('load',  markReady);

      // ảnh đã lỗi/tải xong trước khi script chạy
      if (dImg.complete) {
        if (dImg.naturalWidth === 0) markEmpty(); else markReady();
      }
    }

    /* ---------- Hồ sơ người chơi ---------- */
    const nameEl = document.querySelector('.pcard__name');
    const profileButton = document.querySelector('[data-js="profile-open"]');
    const profileModal = document.getElementById('profileModal');
    const profileInput = document.getElementById('profileNameInput');
    const profileNameForm = document.getElementById('profileNameForm');

    if (profileButton && profileModal && profileInput && nameEl) {
      const closeProfile = function () {
        profileModal.hidden = true;
        profileButton.focus();
      };

      profileButton.addEventListener('click', function () {
        profileInput.value = nameEl.textContent.trim();
        profileModal.hidden = false;
        profileInput.focus();
        profileInput.select();
      });
      profileModal.querySelectorAll('[data-profile-close]').forEach(function (button) {
        button.addEventListener('click', closeProfile);
      });

      profileNameForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const nextName = profileInput.value.trim();
        if (!nextName) {
          profileInput.focus();
          return;
        }
        const submitButton = profileNameForm.querySelector('[type="submit"]');
        submitButton.disabled = true;
        try {
          const response = await fetch('/api/profile/player-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_name: nextName })
          });
          const result = await response.json();
          if (!response.ok) {
            toast(result.error || 'Không thể cập nhật tên người chơi.');
            return;
          }
          nameEl.textContent = result.player_name;
          profileInput.value = result.player_name;
          toast('Đã cập nhật tên người chơi.');
        } catch (error) {
          console.error('Player name update failed:', error);
          toast('Không kết nối được máy chủ. Tên chưa được lưu.');
        } finally {
          submitButton.disabled = false;
        }
      });

      profileModal.querySelector('[data-profile-action="nickname"]').addEventListener('click', function () {
        profileInput.focus();
        profileInput.select();
      });
      profileModal.querySelectorAll('[data-profile-action]:not([data-profile-action="nickname"])').forEach(function (button) {
        button.addEventListener('click', function () {
          toast(button.textContent.trim() + ' – sắp ra mắt');
        });
      });

      const soundEffectsButton = document.getElementById('soundEffectsBtn');
      const soundEffectsState = soundEffectsButton.querySelector('[data-sound-state]');
      const soundEffectsKey = 'yugioh.sfx';
      let soundEffectsEnabled = true;
      try {
        soundEffectsEnabled = window.localStorage.getItem(soundEffectsKey) !== 'off';
      } catch (error) {}
      const renderSoundEffects = function () {
        soundEffectsButton.setAttribute('aria-pressed', String(soundEffectsEnabled));
        soundEffectsButton.classList.toggle('is-off', !soundEffectsEnabled);
        soundEffectsState.textContent = soundEffectsEnabled ? 'Đang bật' : 'Đang tắt';
      };
      renderSoundEffects();
      soundEffectsButton.addEventListener('click', function () {
        soundEffectsEnabled = !soundEffectsEnabled;
        try {
          window.localStorage.setItem(soundEffectsKey, soundEffectsEnabled ? 'on' : 'off');
        } catch (error) {}
        renderSoundEffects();
      });

      document.getElementById('profileLogout').addEventListener('click', async function () {
        if (!window.confirm('Đăng xuất khỏi tài khoản này?')) return;
        try {
          const response = await fetch('/api/logout', { method: 'POST' });
          if (!response.ok) throw new Error('Máy chủ từ chối đăng xuất.');
          try {
            window.sessionStorage.removeItem('yugioh.authenticatedTab');
          } catch (error) {
            console.error('Could not clear the authenticated tab state:', error);
          }
          try {
            window.localStorage.removeItem(profileNameKey);
          } catch (error) {
            console.error('Could not clear the saved local nickname:', error);
          }
          window.location.replace('/');
        } catch (error) {
          console.error('Logout failed:', error);
          toast('Không thể đăng xuất. Hãy kiểm tra kết nối máy chủ.');
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !profileModal.hidden) closeProfile();
      });
    }
  });
})();