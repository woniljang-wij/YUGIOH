(function () {
  'use strict';

  document.addEventListener('click', function (event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!button || button.disabled) return;

    const clickSound = new Audio('assets/music/sfx/click.mp3');
    clickSound.preload = 'auto';
    clickSound.volume = 0.65;
    const playback = clickSound.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(function (error) {
        console.error('Button click sound could not be played:', error);
      });
    }
    clickSound.addEventListener('ended', function () {
      clickSound.removeAttribute('src');
      clickSound.load();
    }, { once: true });
  }, true);
})();
