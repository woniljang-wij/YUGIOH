(function () {
  'use strict';

  const MUSIC_PREFERENCE_KEY = 'yugioh.music';
  const tracks = [
    '/assets/music/bgm/duel1.mp3',
    '/assets/music/bgm/duel2.mp3'
  ];
  const audio = document.getElementById('duelMusic');
  if (!audio) throw new Error('Không tìm thấy trình phát nhạc nền trận đấu.');

  let trackIndex = Math.floor(Math.random() * tracks.length);
  let wantsPlayback = true;

  try {
    wantsPlayback = window.localStorage.getItem(MUSIC_PREFERENCE_KEY) !== 'off';
  } catch (error) {
    console.error('Không thể đọc tùy chọn nhạc nền:', error);
  }

  audio.preload = 'auto';
  audio.volume = 0.55;
  audio.src = tracks[trackIndex];

  function onUserGesture() {
    if (wantsPlayback && audio.paused) startPlayback();
  }

  function removeGestureListeners() {
    document.removeEventListener('pointerdown', onUserGesture, true);
    document.removeEventListener('keydown', onUserGesture, true);
  }

  function listenForUserGesture() {
    document.addEventListener('pointerdown', onUserGesture, true);
    document.addEventListener('keydown', onUserGesture, true);
  }

  function startPlayback() {
    const request = audio.play();
    if (!request || typeof request.then !== 'function') return;
    request.then(removeGestureListeners).catch(function (error) {
      console.warn('Nhạc nền duel đang chờ tương tác để phát:', error);
      listenForUserGesture();
    });
  }

  audio.addEventListener('ended', function () {
    trackIndex = (trackIndex + 1) % tracks.length;
    audio.src = tracks[trackIndex];
    if (wantsPlayback) startPlayback();
  });

  audio.addEventListener('error', function () {
    console.error('Không tải được nhạc nền duel:', audio.currentSrc || audio.src);
  });

  if (wantsPlayback) {
    listenForUserGesture();
    startPlayback();
  }
})();
