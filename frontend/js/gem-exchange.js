(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('gemExchange');
    const panel = modal && modal.querySelector('.gem-exchange__panel');
    const balanceLabel = modal && modal.querySelector('[data-exchange-balance]');
    const message = modal && modal.querySelector('[data-exchange-message]');
    const exchangeButtons = modal && Array.from(modal.querySelectorAll('[data-exchange-gems]'));
    if (!modal || !panel || !balanceLabel || !message || !exchangeButtons) return;

    const format = new Intl.NumberFormat('vi-VN');
    let currentGems = null;
    let isExchanging = false;
    let previousFocus = null;
    let closeTimer = 0;
    let closeTransitionHandler = null;
    let toastTimer = 0;
    let rewardAnimationTimer = 0;

    function showToast(text, state) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = text;
      toast.classList.remove('gem-exchange-toast--success', 'gem-exchange-toast--error');
      if (state === 'success') toast.classList.add('gem-exchange-toast--success');
      if (state === 'error') toast.classList.add('gem-exchange-toast--error');
      toast.classList.add('is-show');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toast.classList.remove('is-show');
        toast.classList.remove('gem-exchange-toast--success', 'gem-exchange-toast--error');
      }, 2600);
    }

    function setMessage(text, state) {
      message.textContent = text;
      message.classList.remove('is-visible', 'is-error', 'is-success');
      if (!text) return;
      window.requestAnimationFrame(function () {
        message.classList.add('is-visible');
        if (state === 'error') message.classList.add('is-error');
        if (state === 'success') message.classList.add('is-success');
      });
    }

    function renderWallet(wallet, animateReward) {
      currentGems = wallet.gems;
      balanceLabel.textContent = format.format(wallet.gems);
      document.querySelectorAll('[data-wallet-gold]').forEach(function (element) {
        element.textContent = format.format(wallet.gold);
      });
      document.querySelectorAll('[data-wallet-gems]').forEach(function (element) {
        element.textContent = format.format(wallet.gems);
      });
      if (animateReward) {
        window.clearTimeout(rewardAnimationTimer);
        const currencyItems = document.querySelectorAll('.currency__item');
        currencyItems.forEach(function (element) {
          element.classList.remove('is-updated');
        });
        window.requestAnimationFrame(function () {
          currencyItems.forEach(function (element) {
            element.classList.add('is-updated');
          });
        });
        rewardAnimationTimer = window.setTimeout(function () {
          currencyItems.forEach(function (element) {
            element.classList.remove('is-updated');
          });
        }, 720);
      }
      updateExchangeButtons();
    }

    function updateExchangeButtons() {
      exchangeButtons.forEach(function (button) {
        button.disabled = isExchanging || currentGems === null;
      });
    }

    function finishClose() {
      window.clearTimeout(closeTimer);
      if (closeTransitionHandler) {
        panel.removeEventListener('transitionend', closeTransitionHandler);
        closeTransitionHandler = null;
      }
      modal.hidden = true;
      modal.classList.remove('is-closing');
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      previousFocus = null;
    }

    function closeModal() {
      if (modal.hidden || modal.classList.contains('is-closing')) return;
      modal.classList.remove('is-open');
      modal.classList.add('is-closing');
      closeTransitionHandler = function (event) {
        if (event.target === panel && event.propertyName === 'transform') {
          finishClose();
        }
      };
      panel.addEventListener('transitionend', closeTransitionHandler);
      closeTimer = window.setTimeout(function () {
        finishClose();
      }, 500);
    }

    async function loadWallet() {
      const response = await fetch('/api/wallet', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Không tải được số dư gem.');
      renderWallet(result.wallet, true);
    }

    async function openModal(trigger) {
      window.clearTimeout(closeTimer);
      if (closeTransitionHandler) {
        panel.removeEventListener('transitionend', closeTransitionHandler);
        closeTransitionHandler = null;
      }
      previousFocus = trigger;
      modal.hidden = false;
      modal.classList.remove('is-closing');
      setMessage('', '');
      balanceLabel.textContent = 'Đang tải…';
      currentGems = null;
      updateExchangeButtons();
      window.requestAnimationFrame(function () {
        modal.classList.add('is-open');
      });
      const closeButton = modal.querySelector('[data-gem-exchange-close]:not(.gem-exchange__scrim)');
      if (closeButton) closeButton.focus();

      try {
        await loadWallet();
      } catch (error) {
        console.error('Could not load wallet for gem exchange:', error);
        setMessage(error.message || 'Không tải được số dư gem.', 'error');
        showToast(error.message || 'Không tải được số dư gem.', 'error');
      }
    }

    document.querySelectorAll('[data-gem-exchange-open]').forEach(function (button) {
      button.addEventListener('click', function () {
        openModal(button);
      });
    });

    modal.querySelectorAll('[data-gem-exchange-close]').forEach(function (button) {
      button.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });

    exchangeButtons.forEach(function (button) {
      button.addEventListener('click', async function () {
        const gems = Number(button.dataset.exchangeGems);
        isExchanging = true;
        updateExchangeButtons();
        setMessage('Đang xử lý giao dịch…', '');

        try {
          const response = await fetch('/api/wallet/exchange', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gems: gems })
          });
          const result = await response.json();
          if (!response.ok) {
            const errorMessage = result.error || 'Không thể đổi gem.';
            setMessage(errorMessage, 'error');
            showToast(response.status === 409 ? 'Không đủ gem để đổi mức này.' : errorMessage, 'error');
            return;
          }

          renderWallet(result.wallet);
          const successMessage = 'Đổi thành công! Bạn nhận được ' + format.format(result.exchange.gold) + ' vàng.';
          setMessage(successMessage, 'success');
          showToast(successMessage, 'success');
        } catch (error) {
          console.error('Gem exchange failed:', error);
          const errorMessage = 'Không kết nối được máy chủ. Giao dịch chưa được xác nhận.';
          setMessage(errorMessage, 'error');
          showToast(errorMessage, 'error');
        } finally {
          isExchanging = false;
          updateExchangeButtons();
        }
      });
    });
  });
})();
