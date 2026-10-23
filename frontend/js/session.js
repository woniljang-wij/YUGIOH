(function () {
  'use strict';

  const authenticatedTabKey = 'yugioh.authenticatedTab';
  let authenticatedInThisTab = false;
  try {
    authenticatedInThisTab = window.sessionStorage.getItem(authenticatedTabKey) === 'true';
  } catch (error) {
    console.error('Could not read the authenticated tab state:', error);
  }

  if (!authenticatedInThisTab) {
    window.location.replace('/');
    return;
  }

  fetch('/api/session')
    .then(function (response) {
      if (!response.ok) throw new Error('Không thể xác thực phiên đăng nhập.');
      return response.json();
    })
    .then(function (result) {
      if (!result || !result.user) {
        window.location.replace('/');
        return;
      }
      const name = document.querySelector('.pcard__name');
      const profileName = document.getElementById('profileNameInput');
      const playerName = result.user.player_name || result.user.username;
      if (name) name.textContent = playerName;
      if (profileName) profileName.value = playerName;

      return fetch('/api/wallet')
        .then(function (response) {
          return response.json().then(function (walletResult) {
            if (!response.ok) {
              throw new Error(walletResult.error || 'Không tải được số dư tài khoản.');
            }
            return walletResult.wallet;
          });
        })
        .then(function (wallet) {
          const format = new Intl.NumberFormat('vi-VN');
          document.querySelectorAll('[data-wallet-gold]').forEach(function (element) {
            element.textContent = format.format(wallet.gold);
          });
          document.querySelectorAll('[data-wallet-gems]').forEach(function (element) {
            element.textContent = format.format(wallet.gems);
          });
        })
        .catch(function (error) {
          console.error('Wallet loading failed:', error);
          document.querySelectorAll('[data-wallet-gold], [data-wallet-gems]').forEach(function (element) {
            element.textContent = '—';
          });
        });
    })
    .catch(function (error) {
      console.error('Session validation failed:', error);
      try {
        window.sessionStorage.removeItem(authenticatedTabKey);
      } catch (storageError) {
        console.error('Could not clear the authenticated tab state:', storageError);
      }
      window.location.replace('/');
    });
})();
