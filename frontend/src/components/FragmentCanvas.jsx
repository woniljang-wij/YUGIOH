import { useEffect, useRef } from 'react';

function roundedRect(context, x, y, width, height, radius) {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(x + width - corner, y);
  context.quadraticCurveTo(x + width, y, x + width, y + corner);
  context.lineTo(x + width, y + height - corner);
  context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  context.lineTo(x + corner, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - corner);
  context.lineTo(x, y + corner);
  context.quadraticCurveTo(x, y, x + corner, y);
  context.closePath();
}

function beveledRect(context, x, y, width, height, cut = 8) {
  const corner = Math.min(cut, width / 3, height / 3);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(x + width - corner, y);
  context.lineTo(x + width, y + corner);
  context.lineTo(x + width, y + height - corner);
  context.lineTo(x + width - corner, y + height);
  context.lineTo(x + corner, y + height);
  context.lineTo(x, y + height - corner);
  context.lineTo(x, y + corner);
  context.closePath();
}

function elementRect(element, canvasRect) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - canvasRect.left,
    y: rect.top - canvasRect.top,
    width: rect.width,
    height: rect.height
  };
}

function drawItemPlate(context, rect, accent) {
  if (!rect || rect.width < 1 || rect.height < 1) return;
  const size = Math.min(rect.width, rect.height, 60) + 10;
  const x = rect.x + (rect.width - size) / 2;
  const y = rect.y + (rect.height - size) / 2;
  beveledRect(context, x, y, size, size, 9);
  context.fillStyle = 'rgba(5, 11, 25, 0.72)';
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.stroke();
  beveledRect(context, x + 3, y + 3, size - 6, size - 6, 7);
  context.strokeStyle = 'rgba(223, 233, 255, 0.18)';
  context.lineWidth = 1;
  context.stroke();
}

function drawPanel(context, canvas, rows) {
  const panel = canvas.closest('.fragment-modal__panel');
  if (!panel) return;
  const canvasRect = canvas.getBoundingClientRect();
  const width = canvasRect.width;
  const height = canvasRect.height;
  if (!width || !height) return;

  context.clearRect(0, 0, width, height);
  context.save();
  roundedRect(context, 1, 1, width - 2, height - 2, 15);
  context.clip();
  const glow = context.createRadialGradient(width * 0.18, 0, 5, width * 0.18, 0, width * 0.85);
  glow.addColorStop(0, 'rgba(78, 162, 255, 0.12)');
  glow.addColorStop(1, 'rgba(17, 34, 60, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 26; index += 1) {
    const x = (index * 149 + 31) % width;
    const y = (index * 89 + 43) % height;
    context.fillStyle = index % 4 === 0
      ? 'rgba(255, 221, 151, 0.34)'
      : 'rgba(129, 199, 255, 0.22)';
    context.fillRect(x, y, index % 4 === 0 ? 2 : 1, 1);
  }
  context.restore();

  roundedRect(context, 2, 2, width - 4, height - 4, 14);
  context.strokeStyle = 'rgba(203, 222, 251, 0.82)';
  context.lineWidth = 1.5;
  context.stroke();
  roundedRect(context, 6, 6, width - 12, height - 12, 11);
  context.strokeStyle = 'rgba(255, 209, 113, 0.62)';
  context.lineWidth = 1;
  context.stroke();

  const header = elementRect(panel.querySelector('.fragment-modal__header'), canvasRect);
  if (header) {
    const dividerY = header.y + header.height + 5;
    const divider = context.createLinearGradient(22, dividerY, width - 22, dividerY);
    divider.addColorStop(0, 'rgba(88, 174, 245, 0)');
    divider.addColorStop(0.18, 'rgba(110, 196, 255, 0.72)');
    divider.addColorStop(0.82, 'rgba(255, 216, 139, 0.7)');
    divider.addColorStop(1, 'rgba(255, 216, 139, 0)');
    context.fillStyle = divider;
    context.fillRect(22, dividerY, width - 44, 1);
    context.fillStyle = 'rgba(222, 239, 255, 0.62)';
    context.fillRect(22, dividerY + 2, width - 44, 1);
  }

  const rowElements = panel.querySelectorAll('[data-fragment-row]');
  rowElements.forEach((element, index) => {
    const rect = elementRect(element, canvasRect);
    if (!rect) return;
    const ready = rows[index]?.ready === true;
    const cut = Math.max(6, Math.min(12, rect.height * 0.12));
    const rowGradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    rowGradient.addColorStop(0, ready ? 'rgba(23, 68, 65, 0.94)' : 'rgba(23, 39, 62, 0.94)');
    rowGradient.addColorStop(0.56, 'rgba(14, 25, 43, 0.97)');
    rowGradient.addColorStop(1, 'rgba(17, 28, 48, 0.96)');
    beveledRect(context, rect.x, rect.y, rect.width, rect.height, cut);
    context.fillStyle = rowGradient;
    context.fill();
    context.strokeStyle = ready
      ? 'rgba(136, 255, 196, 0.84)'
      : 'rgba(147, 177, 219, 0.68)';
    context.lineWidth = ready ? 1.5 : 1;
    context.stroke();
    beveledRect(context, rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6, Math.max(3, cut - 3));
    context.strokeStyle = 'rgba(227, 238, 255, 0.14)';
    context.lineWidth = 1;
    context.stroke();

    const accent = ready ? 'rgba(117, 247, 177, 0.56)' : 'rgba(116, 167, 224, 0.52)';
    drawItemPlate(context, elementRect(element.querySelector('.fragment-row__item > img'), canvasRect), accent);
    drawItemPlate(context, elementRect(element.querySelector('.fragment-row__reward > img'), canvasRect), accent);

    if (ready) {
      const line = context.createLinearGradient(rect.x + 14, rect.y, rect.x + rect.width - 14, rect.y);
      line.addColorStop(0, 'rgba(119, 255, 185, 0)');
      line.addColorStop(0.5, 'rgba(119, 255, 185, 0.46)');
      line.addColorStop(1, 'rgba(119, 255, 185, 0)');
      context.fillStyle = line;
      context.fillRect(rect.x + 14, rect.y + 1, rect.width - 28, 1);
    }
  });

  const footer = elementRect(panel.querySelector('.fragment-modal__footer'), canvasRect);
  if (footer) {
    context.fillStyle = 'rgba(255, 218, 145, 0.24)';
    context.fillRect(footer.x, footer.y - 7, footer.width, 1);
  }
}

export default function FragmentCanvas({ rows, loading }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = canvas?.closest('.fragment-modal__panel');
    if (!canvas || !panel) return undefined;
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Canvas 2D is not available for the fragment merge interface.');
      return undefined;
    }

    let disposed = false;
    let animationFrame = 0;
    const draw = () => {
      animationFrame = 0;
      if (disposed) return;
      const width = panel.clientWidth;
      const height = Math.max(panel.clientHeight, panel.scrollHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawPanel(context, canvas, rows);
    };
    const scheduleDraw = () => {
      if (!disposed && !animationFrame) animationFrame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(panel);
    panel.querySelectorAll('.fragment-modal__header, .fragment-row, .fragment-modal__footer').forEach((element) => observer.observe(element));
    panel.addEventListener('scroll', scheduleDraw, { passive: true });
    scheduleDraw();

    return () => {
      disposed = true;
      observer.disconnect();
      panel.removeEventListener('scroll', scheduleDraw);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [rows, loading]);

  return <canvas className="fragment-canvas" ref={canvasRef} aria-hidden="true" />;
}
