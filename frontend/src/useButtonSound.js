import { useCallback } from 'react';

export function useButtonSound() {
  return useCallback((event) => {
    if (!event.nativeEvent.isTrusted) return;
    const button = event.target.closest('button');
    if (!button || button.disabled) return;

    const clickSound = new Audio('/assets/music/sfx/click.mp3');
    clickSound.preload = 'auto';
    clickSound.volume = 0.65;
    const playback = clickSound.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch((error) => console.error('Button click sound could not be played:', error));
    }
    clickSound.addEventListener('ended', () => {
      clickSound.removeAttribute('src');
      clickSound.load();
    }, { once: true });
  }, []);
}
