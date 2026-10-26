import { useEffect, useRef, useState } from 'react';
import { useButtonSound } from '../useButtonSound.js';

const authenticatedTabKey = 'yugioh.authenticatedTab';
const loadingDurationMs = 5000;

async function followBackendProgress(signal, onStatus) {
  const response = await fetch('/api/game/load-progress', {
    headers: { Accept: 'text/event-stream' },
    signal
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
    const dataLine = eventText.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) return;

    const data = JSON.parse(dataLine.slice(6));
    if (data.error) throw new Error(data.error);
    if (!Number.isInteger(data.progress)) throw new Error('Máy chủ trả về tiến trình không hợp lệ.');

    onStatus(data.status || 'Đang tải dữ liệu từ máy chủ...');
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

function StartPage() {
  const [username, setUsername] = useState('Duelist');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Đang chờ máy chủ...');
  const [errorMessage, setErrorMessage] = useState('');
  const musicRef = useRef(null);
  const activeRequestRef = useRef(null);
  const playButtonSound = useButtonSound();

  useEffect(() => {
    document.body.className = 'start-page';
    document.title = 'Bắt đầu · Yu-Gi-Oh!';

    let authenticatedInThisTab = false;
    try {
      authenticatedInThisTab = window.sessionStorage.getItem(authenticatedTabKey) === 'true';
    } catch (error) {
      console.error('Could not read the authenticated tab state:', error);
    }
    if (!authenticatedInThisTab) {
      window.location.replace('/');
      return undefined;
    }

    const controller = new AbortController();
    fetch('/api/session', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Không thể kiểm tra phiên đăng nhập.');
        return response.json();
      })
      .then((result) => {
        if (!result.user) {
          window.location.replace('/');
          return;
        }
        setUsername(result.user.player_name || result.user.username);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Could not verify the signed-in user:', error);
        try {
          window.sessionStorage.removeItem(authenticatedTabKey);
        } catch (storageError) {
          console.error('Could not clear the authenticated tab state:', storageError);
        }
        window.location.replace('/');
      });

    return () => {
      controller.abort();
      activeRequestRef.current?.abort();
      musicRef.current?.pause();
    };
  }, []);

  async function startGame() {
    setIsLoading(true);
    setProgress(0);
    setLoadingStatus('Đang chờ máy chủ...');
    setErrorMessage('');

    const controller = new AbortController();
    activeRequestRef.current = controller;
    const music = musicRef.current;
    if (music) {
      music.currentTime = 0;
      music.play().catch((error) => console.error('Start music could not be played:', error));
    }

    const startedAt = performance.now();
    const progressTicker = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setProgress(Math.min(99, Math.floor((elapsed / loadingDurationMs) * 100)));
    }, 50);

    try {
      await Promise.all([
        followBackendProgress(controller.signal, setLoadingStatus).then(() => {
          setLoadingStatus('Máy chủ đã sẵn sàng. Đang vào game...');
        }),
        new Promise((resolve) => window.setTimeout(resolve, loadingDurationMs))
      ]);
      window.clearInterval(progressTicker);
      setProgress(100);
      music?.pause();
      window.location.replace('/index.html');
    } catch (error) {
      window.clearInterval(progressTicker);
      if (controller.signal.aborted) return;
      console.error('Game loading failed:', error);
      music?.pause();
      setIsLoading(false);
      setProgress(0);
      setErrorMessage(error.message || 'Không thể tải game. Hãy thử lại.');
    }
  }

  return (
    <main className={`start-screen${isLoading ? ' is-loading' : ''}`} onClickCapture={playButtonSound}>
      <div className="start-screen__backdrop" aria-hidden="true"></div>
      <div className="start-screen__glow" aria-hidden="true"></div>
      <img className="start-screen__duelist" src="/assets/images/hero/kaiba-seto.png" alt="" aria-hidden="true" />

      <header className="start-screen__brand">
        <span>DUELIST PORTAL</span>
        <h1>Yu-Gi-Oh!</h1>
      </header>

      <div className="start-screen__server">
        <span className="start-screen__status" aria-hidden="true"></span>
        <span>001 Server Production</span>
        <span className="start-screen__server-state">Đã kết nối</span>
      </div>

      <section
        className="start-screen__welcome"
        id="startWelcome"
        aria-labelledby="startGreeting"
        aria-hidden={isLoading}
        hidden={isLoading}
      >
        <p className="start-screen__eyebrow">SẴN SÀNG ĐẤU BÀI</p>
        <h2 id="startGreeting">Chào mừng, <span id="startUsername">{username}</span></h2>
        <p>Chuẩn bị bước vào đấu trường.</p>
        <button
          className="start-screen__button"
          id="startGame"
          type="button"
          onClick={startGame}
          disabled={isLoading}
        >
          <span>Bắt Đầu</span>
          <span className="start-screen__button-arrow" aria-hidden="true">➜</span>
        </button>
      </section>

      <section className="start-loading" id="startLoading" aria-labelledby="loadingTitle" hidden={!isLoading}>
        <p id="loadingTitle">Đang vào game</p>
        <span className="start-loading__status" id="loadingStatus" aria-live="polite">{loadingStatus}</span>
        <div
          className="start-loading__track"
          role="progressbar"
          aria-label="Đang vào game"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={progress}
        >
          <span className="start-loading__fill" id="loadingFill" style={{ width: `${progress}%` }}></span>
        </div>
        <span className="start-loading__percent" id="loadingPercent">{progress}%</span>
      </section>

      <p className="start-screen__version">Yu-Gi-Oh! · Duelist Portal</p>
      <audio ref={musicRef} id="startMusic" src="/assets/music/bgm/Start.mp3" preload="auto"></audio>
      <p className="start-screen__error" id="startError" role="status" aria-live="polite">{errorMessage}</p>
    </main>
  );
}

export default StartPage;
