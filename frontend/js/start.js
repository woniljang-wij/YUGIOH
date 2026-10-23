(function () {
  'use strict';

  const LOADING_DURATION_MS = 5000;
  const screen = document.querySelector('.start-screen');
  const welcome = document.getElementById('startWelcome');
  const loading = document.getElementById('startLoading');
  const startButton = document.getElementById('startGame');
  const usernameElement = document.getElementById('startUsername');
  const progressbar = loading.querySelector('[role="progressbar"]');
  const progressFill = document.getElementById('loadingFill');
  const progressPercent = document.getElementById('loadingPercent');
  const loadingStatus = document.getElementById('loadingStatus');
  const errorMessage = document.getElementById('startError');
  const music = document.getElementById('startMusic');
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
      if (!response.ok) throw new Error('Không thể kiểm tra phiên đăng nhập.');
      return response.json();
    })
    .then(function (result) {
      if (!result.user) {
        window.location.replace('/');
        return;
      }
      usernameElement.textContent = result.user.player_name || result.user.username;
    })
    .catch(function (error) {
      console.error('Could not verify the signed-in user:', error);
      try {
        window.sessionStorage.removeItem(authenticatedTabKey);
      } catch (storageError) {
        console.error('Could not clear the authenticated tab state:', storageError);
      }
      window.location.replace('/');
    });

  async function followBackendProgress() {
    const response = await fetch('/api/game/load-progress', {
      headers: { Accept: 'text/event-stream' }
    });
    if (!response.ok) {
      throw new Error(response.status === 401
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        : 'Máy chủ không thể bắt đầu tải game.');
    }
    if (!response.body) throw new Error('Trình duyệt không hỗ trợ theo dõi tiến trình máy chủ.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gameReady = false;

    function handleEvent(eventText) {
      const dataLine = eventText.split('\n').find(function (line) {
        return line.startsWith('data: ');
      });
      if (!dataLine) return;

      const data = JSON.parse(dataLine.slice(6));
      if (data.error) throw new Error(data.error);
      if (!Number.isInteger(data.progress)) throw new Error('Máy chủ trả về tiến trình không hợp lệ.');

      loadingStatus.textContent = data.status || 'Đang tải dữ liệu từ máy chủ...';
      if (data.progress === 100 && data.user) gameReady = true;
    }

    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      events.forEach(handleEvent);

      if (chunk.done) break;
    }

    if (buffer.trim()) handleEvent(buffer);
    if (!gameReady) throw new Error('Kết nối máy chủ kết thúc trước khi game sẵn sàng.');
  }

  function setProgress(progress) {
    progressFill.style.width = progress + '%';
    progressbar.setAttribute('aria-valuenow', String(progress));
    progressPercent.textContent = progress + '%';
  }

  startButton.addEventListener('click', async function () {
    startButton.disabled = true;
    screen.classList.add('is-loading');
    welcome.setAttribute('aria-hidden', 'true');
    loading.hidden = false;

    setProgress(0);
    music.currentTime = 0;
    music.play().catch(function (error) {
      console.error('Start music could not be played:', error);
    });
    const startedAt = performance.now();
    const progressTicker = window.setInterval(function () {
      const elapsed = performance.now() - startedAt;
      setProgress(Math.min(99, Math.floor((elapsed / LOADING_DURATION_MS) * 100)));
    }, 50);

    try {
      await Promise.all([
        followBackendProgress().then(function () {
          loadingStatus.textContent = 'Máy chủ đã sẵn sàng. Đang vào game...';
        }),
        new Promise(function (resolve) {
          window.setTimeout(resolve, LOADING_DURATION_MS);
        })
      ]);
      window.clearInterval(progressTicker);
      setProgress(100);
      music.pause();
      window.location.replace('/index.html');
    } catch (error) {
      console.error('Game loading failed:', error);
      window.clearInterval(progressTicker);
      music.pause();
      screen.classList.remove('is-loading');
      welcome.removeAttribute('aria-hidden');
      loading.hidden = true;
      startButton.disabled = false;
      setProgress(0);
      errorMessage.textContent = error.message || 'Không thể tải game. Hãy thử lại.';
    }
  });
})();
