(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const shop = document.getElementById('cardShop');
    const shopButton = document.querySelector('[data-js="btn-store"]');
    const shopBack = document.querySelector('[data-js="shop-back"]');
    const shopContent = shop && shop.querySelector('.card-shop__content');
    const detail = document.getElementById('shopPackDetail');
    const cardGrid = shop && shop.querySelector('[data-shop-card-grid]');
    const previousPageButton = shop && shop.querySelector('[data-shop-page-prev]');
    const nextPageButton = shop && shop.querySelector('[data-shop-page-next]');
    const asidePack = shop && shop.querySelector('[data-shop-aside-pack]');
    const reveal = document.getElementById('shopReveal');
    const resetDialog = document.getElementById('shopResetConfirm');
    if (!shop || !shopButton || !shopBack || !shopContent || !detail || !reveal || !resetDialog) return;

    const revealPack = reveal.querySelector('[data-reveal-pack]');
    const revealCard = reveal.querySelector('[data-reveal-card]');
    const revealCardInner = revealCard.querySelector('.shop-reveal__card-inner');
    const reveal3d = reveal.querySelector('[data-reveal-3d]');
    const reveal3dStage = reveal.querySelector('[data-reveal-3d-stage]');
    const revealZoomIn = reveal.querySelector('[data-reveal-zoom-in]');
    const revealZoomOut = reveal.querySelector('[data-reveal-zoom-out]');
    const revealResetView = reveal.querySelector('[data-reveal-reset-view]');
    const revealNext = reveal.querySelector('[data-reveal-next]');
    const revealFront = reveal.querySelector('[data-reveal-front]');
    const revealMagic = reveal.querySelector('[data-reveal-magic]');
    const revealMessage = reveal.querySelector('[data-reveal-message]');
    const revealPackArt = reveal.querySelector('[data-reveal-pack-art]');
    const revealQuickOpen = reveal.querySelector('[data-reveal-quick-open]');
    const revealBulk = reveal.querySelector('[data-reveal-bulk]');
    const revealBulkTitle = reveal.querySelector('[data-reveal-bulk-title]');
    const revealBulkGrid = reveal.querySelector('[data-reveal-bulk-grid]');
    const revealConfirm = reveal.querySelector('[data-reveal-confirm]');
    const revealQuickCancel = reveal.querySelector('[data-reveal-quick-cancel]');
    const revealQuickConfirm = reveal.querySelector('[data-reveal-quick-confirm]');
    const resetButton = detail.querySelector('[data-shop-reset]');
    const resetConfirmButton = resetDialog.querySelector('[data-shop-reset-confirm]');
    const resetCancelButtons = resetDialog.querySelectorAll('[data-shop-reset-cancel]');
    let shopState = null;
    let activePack = null;
    let cardPage = 0;
    let revealRewards = [];
    let revealIndex = 0;
    let revealStage = 'closed';
    let noticeTimer = null;
    let card3dViewer = null;
    let renderedPageSize = 10;
    let revealFlipCleanup = null;
    let reveal3dTransitionCleanup = null;

    function formatCurrency(value) {
      return new Intl.NumberFormat('vi-VN').format(value);
    }

    function getPageSize() {
      if (window.matchMedia('(max-width: 940px) and (max-height: 500px)').matches) return 4;
      if (window.matchMedia('(min-width: 941px) and (max-width: 1024px) and (max-height: 500px)').matches) {
        return 5;
      }
      return 10;
    }

    function updateWallet(wallet) {
      document.querySelectorAll('[data-wallet-gold]').forEach(function (element) {
        element.textContent = formatCurrency(wallet.gold);
      });
      document.querySelectorAll('[data-wallet-gems]').forEach(function (element) {
        element.textContent = formatCurrency(wallet.gems);
      });
    }

    function notify(message) {
      const element = document.getElementById('toast');
      if (!element) return;
      element.textContent = message;
      element.classList.add('is-show');
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(function () {
        element.classList.remove('is-show');
      }, 2200);
    }

    async function fetchShopState() {
      const response = await fetch('/api/shop', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Không tải được tiệm bài.');
      shopState = result;
      updateWallet(result.wallet);
      if (activePack) {
        activePack = result.packs.find(function (pack) {
          return pack.id === activePack.id;
        }) || null;
        if (activePack) renderPackDetail();
      }
    }

    function openShop() {
      shop.hidden = false;
      shopBack.focus();
      fetchShopState().catch(function (error) {
        notify(error.message);
      });
    }

    function closeShop() {
      shop.hidden = true;
      activePack = null;
      asidePack.hidden = true;
      detail.hidden = true;
      shopContent.classList.remove('is-detail');
      shop.querySelector('.card-shop__sidebar').classList.remove('is-pack-detail');
      shopButton.focus();
    }

    function goBack() {
      if (!activePack) {
        closeShop();
        return;
      }
      activePack = null;
      detail.hidden = true;
      shopContent.classList.remove('is-detail');
      shop.querySelector('.card-shop__sidebar').classList.remove('is-pack-detail');
      asidePack.hidden = true;
      shopBack.focus();
    }

    function selectPack(packId) {
      if (!shopState) {
        fetchShopState().then(function () {
          selectPack(packId);
        }).catch(function (error) {
          notify(error.message);
        });
        return;
      }
      activePack = shopState.packs.find(function (pack) {
        return pack.id === packId;
      });
      if (!activePack) return;
      cardPage = 0;
      shopContent.classList.add('is-detail');
      shop.querySelector('.card-shop__sidebar').classList.add('is-pack-detail');
      detail.hidden = false;
      renderPackDetail();
      shopBack.focus();
    }

    function renderPackDetail() {
      if (!activePack || !shopState) return;
      detail.querySelector('[data-shop-pack-owner]').textContent = activePack.owner;
      detail.querySelector('[data-shop-pack-title]').textContent = activePack.name;
      detail.querySelector('[data-shop-pack-description]').textContent = activePack.description;
      detail.querySelector('[data-shop-pack-count]').textContent = activePack.cards.length + ' lá trong gói';
      const asideImage = asidePack.querySelector('[data-shop-aside-image]');
      const packArt = {
        kaiba: 'assets/images/hero/kaiba-seto.png',
        yugi: 'assets/images/hero/muto-yugi.png',
        jonouchi: 'assets/images/hero/jonouchi-katsuya.png'
      }[activePack.id];
      asideImage.src = packArt;
      asideImage.alt = activePack.owner;
      asidePack.querySelector('[data-shop-aside-owner]').textContent = activePack.owner;
      asidePack.querySelector('[data-shop-aside-title]').textContent = activePack.name;
      asidePack.hidden = false;
      cardGrid.replaceChildren();

      let ownedKinds = 0;
      let ownedCopies = 0;
      let remainingCopies = 0;
      const pageSize = getPageSize();
      if (pageSize !== renderedPageSize) {
        cardPage = Math.floor((cardPage * renderedPageSize) / pageSize);
        renderedPageSize = pageSize;
      }
      const pageCount = Math.max(1, Math.ceil(activePack.cards.length / pageSize));
      cardPage = Math.min(cardPage, pageCount - 1);
      const firstCardIndex = cardPage * pageSize;
      activePack.cards.slice(firstCardIndex, firstCardIndex + pageSize).forEach(function (card) {
        const maxCopies = Number(card.maxCopies) || 3;
        const quantity = Number(card.ownedQuantity) || 0;
        const copiesRemaining = Math.max(0, maxCopies - quantity);
        if (quantity > 0) ownedKinds += 1;
        ownedCopies += quantity;
        remainingCopies += copiesRemaining;

        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'shop-card' + (copiesRemaining === 0 ? ' shop-card--exhausted' : '');
        tile.dataset.cardId = card.id;
        tile.setAttribute('aria-label', 'Xem thông tin lá ' + card.name + ', còn ' +
          copiesRemaining + ' trên ' + maxCopies + ' bản');
        const cardFace = window.libraryCardUI.createCardFace(card);
        cardFace.classList.add('shop-card__face');
        tile.appendChild(cardFace);
        const quantityLabel = document.createElement('span');
        quantityLabel.className = 'shop-card__quantity';
        quantityLabel.textContent = copiesRemaining + '/' + maxCopies;
        tile.appendChild(quantityLabel);
        cardGrid.appendChild(tile);
      });

      detail.querySelector('[data-shop-collection-count]').textContent =
        'Đã sở hữu ' + ownedKinds + '/' + activePack.cards.length + ' loại · ' + ownedCopies +
        ' bản · Còn ' + remainingCopies + ' bản';
      previousPageButton.disabled = cardPage === 0;
      nextPageButton.disabled = cardPage >= pageCount - 1;
      previousPageButton.setAttribute('aria-label', pageSize + ' lá trước');
      nextPageButton.setAttribute('aria-label', pageSize + ' lá tiếp theo');
      detail.querySelector('[data-shop-page-status]').textContent = 'Trang ' +
        (cardPage + 1) + ' / ' + pageCount + ' · Lá ' + (firstCardIndex + 1) + '–' +
        Math.min(firstCardIndex + pageSize, activePack.cards.length);
      cardGrid.dataset.page = String(cardPage + 1);
      cardGrid.setAttribute('aria-label', 'Lá bài ' + (firstCardIndex + 1) + ' đến ' +
        Math.min(firstCardIndex + pageSize, activePack.cards.length) + ' trên ' + activePack.cards.length);
      detail.querySelectorAll('[data-shop-buy]').forEach(function (button) {
        const count = Number(button.dataset.shopBuy);
        const cost = count === 50 ? 30000 : count;
        const balance = count === 50 ? shopState.wallet.gold : shopState.wallet.gems;
        button.disabled = remainingCopies < count || balance < cost;
      });
      window.requestAnimationFrame(function () {
        cardGrid.querySelectorAll('.card-detail__card-name').forEach(function (name) {
          window.libraryCardUI.fitCardName(name);
        });
      });
    }

    function renderRevealReward(card) {
      revealFront.replaceChildren();
      const cardFace = window.libraryCardUI.createCardFace(card);
      cardFace.classList.add('shop-reveal__card-face');
      revealFront.appendChild(cardFace);
      revealCard.setAttribute('aria-label', 'Lật lá ' + card.name);
    }

    function destroyCard3DViewer() {
      if (reveal3dTransitionCleanup) reveal3dTransitionCleanup();
      if (card3dViewer) {
        card3dViewer.destroy();
        card3dViewer = null;
      }
      reveal3d.classList.remove('is-entering');
      reveal3d.hidden = true;
      reveal.classList.remove('has-3d-view');
    }

    function finishCard3DTransition() {
      if (reveal3dTransitionCleanup) reveal3dTransitionCleanup();
    }

    function openRevealedCardDetails() {
      const reward = revealRewards[revealIndex];
      const ownedCard = activePack && activePack.cards.find(function (card) {
        return card.id === reward.id;
      });
      window.libraryCardUI.openCardDetail(Object.assign({}, reward, {
        quantity: Number(ownedCard && ownedCard.ownedQuantity) || 0
      }), revealNext);
    }

    function showCard3DViewer() {
      const cardFace = revealFront.querySelector('.shop-reveal__card-face');
      if (!window.Card3DViewer || !cardFace) {
        console.error('The 3D card viewer is unavailable; keeping the standard card view.');
        return;
      }
      const cardName = cardFace.querySelector('.card-detail__card-name');
      if (cardName) window.libraryCardUI.fitCardName(cardName);
      const bounds = cardFace.getBoundingClientRect();
      reveal3d.hidden = false;
      reveal.classList.add('has-3d-view');
      try {
        card3dViewer = window.Card3DViewer.create({
          stage: reveal3dStage,
          cardFace: cardFace,
          width: bounds.width,
          height: bounds.height,
          zoomInButton: revealZoomIn,
          zoomOutButton: revealZoomOut,
          resetButton: revealResetView,
          onActivate: openRevealedCardDetails
        });
        reveal3d.classList.add('is-entering');
        revealCard.classList.add('is-transitioning-to-3d');
        function onCardExit(event) {
          if (event.target !== revealCard || event.animationName !== 'shopCard3DExit') return;
          finishCard3DTransition();
        }
        revealCard.addEventListener('animationend', onCardExit);
        const transitionTimer = window.setTimeout(finishCard3DTransition, 650);
        reveal3dTransitionCleanup = function () {
          window.clearTimeout(transitionTimer);
          revealCard.removeEventListener('animationend', onCardExit);
          revealCard.classList.remove('is-transitioning-to-3d');
          reveal3d.classList.remove('is-entering');
          revealCard.hidden = true;
          reveal3dTransitionCleanup = null;
        };
        card3dViewer.playEntryTransition();
      } catch (error) {
        destroyCard3DViewer();
        revealCard.hidden = false;
        console.error('Could not initialize the 3D card viewer:', error);
      }
    }

    function showRewardBack(index) {
      if (revealFlipCleanup) revealFlipCleanup();
      destroyCard3DViewer();
      revealCard.classList.add('is-resetting');
      revealIndex = index;
      revealStage = 'back';
      revealNext.hidden = true;
      revealQuickOpen.hidden = revealRewards.length <= 1;
      revealNext.textContent = index + 1 < revealRewards.length ? 'Lá tiếp theo' : 'Trở về';
      revealCard.classList.remove('is-revealed');
      revealCard.classList.remove('is-flipping');
      renderRevealReward(revealRewards[index]);
      revealCard.hidden = false;
      window.drawCardBacks(revealCard);
      revealCard.tabIndex = 0;
      revealCard.setAttribute('aria-label', 'Lật lá ' + revealRewards[index].name);
      void revealCard.offsetWidth;
      revealCard.classList.remove('is-resetting');
      revealCard.focus();
    }

    function flipRewardToFront() {
      if (revealStage !== 'back') return;
      if (revealFlipCleanup) revealFlipCleanup();
      revealStage = 'front';
      revealCard.tabIndex = 0;
      let fallbackTimer = null;
      function cleanupFlipWait() {
        revealCardInner.removeEventListener('transitionend', finishFlip);
        window.clearTimeout(fallbackTimer);
        if (revealFlipCleanup === cleanupFlipWait) revealFlipCleanup = null;
      }
      function finishFlip(event) {
        if (event && (event.target !== revealCardInner || event.propertyName !== 'transform')) return;
        cleanupFlipWait();
        if (reveal.hidden || revealStage !== 'front') return;
        revealCard.classList.remove('is-flipping');
        showCard3DViewer();
        revealNext.hidden = false;
        revealNext.focus();
      }
      revealFlipCleanup = cleanupFlipWait;
      revealCardInner.addEventListener('transitionend', finishFlip);
      revealCard.classList.add('is-revealed');
      revealCard.classList.add('is-flipping');
      revealCard.setAttribute('aria-label', 'Xem thông tin lá ' + revealRewards[revealIndex].name);
      const transition = window.getComputedStyle(revealCardInner);
      function parseTime(value) {
        const time = parseFloat(value);
        return value.trim().endsWith('ms') ? time : time * 1000;
      }
      const durations = transition.transitionDuration.split(',').map(parseTime);
      const delays = transition.transitionDelay.split(',').map(parseTime);
      const transitionTime = Math.max.apply(null, durations.map(function (duration, index) {
        return duration + delays[index % delays.length];
      }));
      fallbackTimer = window.setTimeout(finishFlip, transitionTime + 50);
    }

    function playMagicBurst() {
      revealMagic.classList.remove('is-active');
      reveal.classList.remove('is-bursting');
      void revealMagic.offsetWidth;
      revealMagic.classList.add('is-active');
      reveal.classList.add('is-bursting');
      window.setTimeout(function () {
        revealMagic.classList.remove('is-active');
        reveal.classList.remove('is-bursting');
      }, 1300);
    }

    function showFirstRewardBack() {
      revealStage = 'burst';
      revealNext.hidden = true;
      revealCard.hidden = true;
      revealQuickOpen.hidden = revealRewards.length <= 1;
      window.setTimeout(function () {
        if (reveal.hidden || revealStage !== 'burst') return;
        showRewardBack(0);
      }, 280);
    }

    function showBulkRewards() {
      revealStage = 'bulk';
      revealConfirm.hidden = true;
      reveal.classList.add('is-bulk');
      revealPack.hidden = true;
      revealCard.hidden = true;
      revealQuickOpen.hidden = true;
      revealBulkTitle.textContent = 'Nhận được ' + revealRewards.length + ' lá bài';
      revealBulkGrid.replaceChildren();

      revealRewards.forEach(function (reward) {
        const item = document.createElement('div');
        item.className = 'shop-reveal__bulk-item';
        const cardFace = window.libraryCardUI.createCardFace(reward);
        cardFace.classList.add('shop-reveal__bulk-card-face');
        item.appendChild(cardFace);
        const quantity = document.createElement('span');
        quantity.className = 'shop-reveal__bulk-quantity';
        quantity.textContent = '×1';
        item.appendChild(quantity);
        revealBulkGrid.appendChild(item);
      });

      revealBulk.hidden = false;
      window.requestAnimationFrame(function () {
        revealBulkGrid.querySelectorAll('.card-detail__card-name').forEach(function (name) {
          window.libraryCardUI.fitCardName(name);
        });
      });
      revealNext.hidden = false;
      revealNext.textContent = 'Trở về';
      revealNext.focus();
    }

    function openQuickRevealConfirmation() {
      if (!['cover', 'back', 'front'].includes(revealStage) || revealRewards.length <= 1) return;
      revealConfirm.hidden = false;
      revealQuickConfirm.focus();
    }

    function closeQuickRevealConfirmation() {
      revealConfirm.hidden = true;
      revealQuickOpen.focus();
    }

    function finishPackOpening() {
      if (reveal.hidden || revealStage !== 'opening') return;
      revealPack.hidden = true;
      reveal.classList.remove('is-tearing');
      showFirstRewardBack();
    }

    function startReveal(rewards, pack, packCount) {
      if (!rewards.length) return;
      destroyCard3DViewer();
      revealRewards = rewards;
      revealIndex = 0;
      revealStage = 'rising';
      reveal.hidden = false;
      revealCard.hidden = true;
      revealCard.classList.remove('is-revealed');
      revealCard.classList.remove('is-flipping');
      revealNext.hidden = true;
      revealQuickOpen.hidden = true;
      revealBulk.hidden = true;
      revealConfirm.hidden = true;
      revealBulkGrid.replaceChildren();
      revealMagic.classList.remove('is-active');
      reveal.classList.remove('is-tearing', 'is-bursting', 'is-bulk');
      revealPack.hidden = false;
      revealPack.disabled = true;
      revealQuickOpen.disabled = true;
      revealPack.classList.remove('is-opening');
      revealMessage.textContent = 'Đã mở ' + packCount + ' gói bài · nhận ' + rewards.length + ' lá';
      reveal.querySelector('[data-reveal-sigil]').textContent = pack.id === 'kaiba' ? 'KC' : pack.id === 'yugi' ? '千' : '城';
      reveal.querySelector('[data-reveal-pack-title]').textContent = pack.name;
      const packArt = {
        kaiba: 'assets/images/hero/kaiba-seto.png',
        yugi: 'assets/images/hero/muto-yugi.png',
        jonouchi: 'assets/images/hero/jonouchi-katsuya.png'
      }[pack.id];
      revealPackArt.src = packArt;
      revealPackArt.alt = pack.owner;
      revealPack.style.setProperty('--reveal-pack-art', 'url("' + revealPackArt.src + '")');
      revealPack.className = 'shop-reveal__pack shop-pack--' + pack.id;
      void revealCard.offsetWidth;
      revealPack.focus();
      window.setTimeout(function () {
        if (reveal.hidden || revealStage !== 'rising') return;
        revealStage = 'cover';
        revealPack.disabled = false;
        revealQuickOpen.disabled = false;
        revealQuickOpen.hidden = revealRewards.length <= 1;
      }, 1450);
    }

    async function buyPack(button) {
      if (!activePack) return;
      const packCount = Number(button.dataset.shopBuy);
      shop.querySelectorAll('[data-shop-buy]').forEach(function (item) {
        item.disabled = true;
      });
      try {
        const response = await fetch('/api/shop/purchase', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack_id: activePack.id, pack_count: packCount })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không mua được gói bài.');
        shopState = result;
        updateWallet(result.wallet);
        activePack = result.packs.find(function (pack) {
          return pack.id === activePack.id;
        });
        renderPackDetail();
        startReveal(result.rewards, activePack, packCount);
      } catch (error) {
        notify(error.message);
        renderPackDetail();
      }
    }

    function closeReveal() {
      if (revealFlipCleanup) revealFlipCleanup();
      destroyCard3DViewer();
      reveal.hidden = true;
      revealStage = 'closed';
      revealConfirm.hidden = true;
      revealBulk.hidden = true;
      revealMagic.classList.remove('is-active');
      reveal.classList.remove('is-tearing', 'is-bursting', 'is-bulk');
      if (!shop.hidden) shopBack.focus();
    }

    function closeResetDialog() {
      if (resetDialog.hidden || resetDialog.classList.contains('is-closing')) return;
      resetDialog.classList.add('is-closing');
    }

    async function resetPack() {
      if (!activePack) return;
      resetConfirmButton.disabled = true;
      try {
        const response = await fetch('/api/shop/reset', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack_id: activePack.id })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không thể tạo lại gói bài.');
        shopState = result;
        activePack = result.packs.find(function (pack) {
          return pack.id === activePack.id;
        }) || null;
        updateWallet(result.wallet);
        renderPackDetail();
        closeResetDialog();
        notify('Đã tạo lại gói bài. Các lá bài đã trở về trạng thái ban đầu.');
      } catch (error) {
        notify(error.message);
      } finally {
        resetConfirmButton.disabled = false;
      }
    }

    shopButton.addEventListener('click', openShop);
    shopBack.addEventListener('click', goBack);
    shop.querySelectorAll('[data-pack-select]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectPack(button.dataset.packSelect);
      });
    });
    previousPageButton.addEventListener('click', function () {
      if (cardPage === 0) return;
      cardPage -= 1;
      renderPackDetail();
    });
    nextPageButton.addEventListener('click', function () {
      if (!activePack) return;
      const pageCount = Math.ceil(activePack.cards.length / getPageSize());
      if (cardPage >= pageCount - 1) return;
      cardPage += 1;
      renderPackDetail();
    });
    window.addEventListener('resize', function () {
      if (activePack && getPageSize() !== renderedPageSize) renderPackDetail();
    });
    cardGrid.addEventListener('click', function (event) {
      const tile = event.target.closest('.shop-card[data-card-id]');
      if (!tile || !activePack) return;
      const card = activePack.cards.find(function (item) {
        return item.id === tile.dataset.cardId;
      });
      if (!card) return;
      window.libraryCardUI.openCardDetail(Object.assign({}, card, {
        quantity: Number(card.ownedQuantity) || 0
      }), tile);
    });
    shop.querySelectorAll('[data-shop-buy]').forEach(function (button) {
      button.addEventListener('click', function () {
        buyPack(button);
      });
    });
    resetButton.addEventListener('click', function () {
      resetDialog.classList.remove('is-closing');
      resetDialog.hidden = false;
      resetConfirmButton.focus();
    });
    resetDialog.addEventListener('animationend', function (event) {
      if (event.target !== resetDialog.querySelector('.shop-reset-confirm__panel') ||
          event.animationName !== 'shopResetDialogOut' ||
          !resetDialog.classList.contains('is-closing')) return;
      resetDialog.hidden = true;
      resetDialog.classList.remove('is-closing');
      resetButton.focus();
    });
    resetConfirmButton.addEventListener('click', resetPack);
    resetCancelButtons.forEach(function (button) {
      button.addEventListener('click', closeResetDialog);
    });
    revealPack.addEventListener('click', function () {
      if (revealStage !== 'cover') return;
      revealStage = 'opening';
      revealPack.disabled = true;
      revealQuickOpen.hidden = true;
      revealPack.classList.add('is-opening');
      reveal.classList.add('is-tearing');
      window.setTimeout(function () {
        if (reveal.hidden || revealStage !== 'opening') return;
        playMagicBurst();
      }, 260);
      window.setTimeout(function () {
        finishPackOpening();
      }, 1250);
    });
    revealQuickOpen.addEventListener('click', openQuickRevealConfirmation);
    revealQuickCancel.addEventListener('click', closeQuickRevealConfirmation);
    revealQuickConfirm.addEventListener('click', showBulkRewards);
    revealPack.addEventListener('animationend', function (event) {
      if (event.animationName === 'packTearOpen') finishPackOpening();
    });
    revealCard.addEventListener('click', function () {
      if (revealStage === 'back') {
        revealCard.focus();
        flipRewardToFront();
      }
    });
    revealCard.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && revealStage === 'back') {
        event.preventDefault();
        flipRewardToFront();
      }
    });
    revealNext.addEventListener('click', function () {
      if (revealStage === 'bulk') {
        closeReveal();
        return;
      }
      if (revealIndex + 1 < revealRewards.length) {
        showRewardBack(revealIndex + 1);
      } else {
        closeReveal();
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented) return;
      if (event.key !== 'Escape') return;
      if (!resetDialog.hidden) closeResetDialog();
      else if (!revealConfirm.hidden) closeQuickRevealConfirmation();
      else if (!reveal.hidden) closeReveal();
      else if (!shop.hidden) goBack();
    });
  });
})();