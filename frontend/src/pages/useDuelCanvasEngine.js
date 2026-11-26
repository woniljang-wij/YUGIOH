import { useEffect, useRef } from 'react';

function drawField(canvas, state) {
  if (!canvas || !state) return;
  const board = canvas.closest('.board');
  const boardWidth = board?.clientWidth || 960;
  const boardHeight = board?.clientHeight || 640;
  const designWidth = 960;
  const designHeight = Math.max(
    1,
    Math.round((designWidth * boardHeight) / Math.max(1, boardWidth))
  );

  if (canvas.width !== designWidth) canvas.width = designWidth;
  if (canvas.height !== designHeight) canvas.height = designHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = designWidth;
  const height = designHeight;
  ctx.clearRect(0, 0, width, height);

  const drawFrameRect = (x1, y1, x2, y2, fillStyle, strokeStyle) => {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    ctx.fillStyle = fillStyle;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
  };

  drawFrameRect(
    12,
    12,
    width - 12,
    height - 12,
    'rgba(4, 9, 25, 0.11)',
    'rgba(79, 227, 255, 0.33)'
  );
  drawFrameRect(
    36,
    38,
    width - 36,
    height / 2 - 8,
    'rgba(7, 16, 43, 0.10)',
    'rgba(96, 180, 255, 0.18)'
  );
  drawFrameRect(
    36,
    height / 2 + 8,
    width - 36,
    height - 38,
    'rgba(7, 16, 43, 0.10)',
    'rgba(96, 180, 255, 0.18)'
  );

  ctx.fillStyle = 'rgba(133, 203, 255, 0.15)';
  for (let index = 0; index < 18; index += 1) {
    const x = (index * 137 + 29) % width;
    const y = (index * 83 + 17) % height;
    const radius = index % 3 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function useDuelCanvasEngine(canvasRef, game, onError) {
  const currentGame = useRef(game);
  const errorCallback = useRef(onError);
  currentGame.current = game;
  errorCallback.current = onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const render = () => {
      try {
        drawField(canvas, currentGame.current);
      } catch (error) {
        console.error('[Duel canvas] Render failed:', error);
        errorCallback.current?.('Canvas bàn đấu gặp lỗi hiển thị. Bàn đấu sẽ dùng chế độ dự phòng.');
      }
    };

    render();

    const board = canvas.closest('.board');
    let observer = null;
    if (board && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(render);
      observer.observe(board);
    }
    window.addEventListener('resize', render);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawField(canvas, game);
  }, [canvasRef, game]);
}
