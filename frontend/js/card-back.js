const CARD_BACK_WIDTH = 265;
const CARD_BACK_HEIGHT = 357;

function drawCardBack(canvas){
  const size = window.getComputedStyle(canvas);
  const width = parseFloat(size.width);
  const height = parseFloat(size.height);
  if (!width || !height) return;

  const pixelRatio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available for card backs.');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);

  const scale = Math.min(pixelWidth / CARD_BACK_WIDTH, pixelHeight / CARD_BACK_HEIGHT);
  const offsetX = (pixelWidth - CARD_BACK_WIDTH * scale) / 2;
  const offsetY = (pixelHeight - CARD_BACK_HEIGHT * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  ctx.fillStyle = '#d6ae7a';
  ctx.fillRect(0, 0, CARD_BACK_WIDTH, CARD_BACK_HEIGHT);
  ctx.strokeStyle = '#21120d';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, CARD_BACK_WIDTH - 1.5, CARD_BACK_HEIGHT - 1.5);

  ctx.fillStyle = '#28150f';
  ctx.fillRect(9.5, 8.5, 246, 340);

  ctx.save();
  ctx.beginPath();
  ctx.rect(12, 11, 241, 335);
  ctx.clip();
  ctx.fillStyle = '#764131';
  ctx.fillRect(12, 11, 241, 335);
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#4b4c46';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(132.5, 178.5, 50, 88, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#100c09';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawCardBacks(root = document){
  root.querySelectorAll('.card__back-canvas').forEach(drawCardBack);
}

window.addEventListener('resize', () => drawCardBacks());
