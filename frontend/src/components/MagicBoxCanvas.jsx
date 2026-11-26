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

function metalGradient(context, x, y, width, height, bright = false) {
  const gradient = context.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, bright ? '#e5e9f4' : '#8993ae');
  gradient.addColorStop(0.12, '#525d7a');
  gradient.addColorStop(0.26, bright ? '#c8cfe1' : '#313c5d');
  gradient.addColorStop(0.52, '#78829d');
  gradient.addColorStop(0.72, '#3c4664');
  gradient.addColorStop(0.9, '#adb5c9');
  gradient.addColorStop(1, '#313951');
  return gradient;
}

function localRect(element, rootRect) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height
  };
}

function drawFrame(context, rect, radius = 8) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.72)';
  context.shadowBlur = 12;
  context.shadowOffsetY = 5;
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, radius);
  context.fillStyle = metalGradient(context, rect.x, rect.y, rect.width, rect.height);
  context.fill();
  context.restore();

  roundedRect(context, rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, Math.max(2, radius - 2));
  context.strokeStyle = 'rgba(226, 236, 255, 0.86)';
  context.lineWidth = 1;
  context.stroke();
  roundedRect(context, rect.x + 5, rect.y + 5, rect.width - 10, rect.height - 10, Math.max(2, radius - 4));
  context.strokeStyle = 'rgba(19, 28, 51, 0.9)';
  context.lineWidth = 2;
  context.stroke();
}

function drawPanel(context, root, rootRect) {
  const header = localRect(root.querySelector('.inventory-screen__topbar'), rootRect);
  const body = localRect(root.querySelector('.inventory-screen__body'), rootRect);
  if (header) {
    drawFrame(context, header, 5);
    const inset = 6;
    const gradient = context.createLinearGradient(0, header.y, 0, header.y + header.height);
    gradient.addColorStop(0, '#243452');
    gradient.addColorStop(0.52, '#111a30');
    gradient.addColorStop(1, '#080f21');
    context.fillStyle = gradient;
    context.fillRect(header.x + inset, header.y + inset, header.width - inset * 2, header.height - inset * 2);
    context.fillStyle = 'rgba(117, 200, 245, 0.5)';
    context.fillRect(header.x + inset, header.y + inset, header.width - inset * 2, 1);
    context.fillStyle = 'rgba(2, 6, 15, 0.9)';
    context.fillRect(header.x + inset, header.y + header.height - inset - 2, header.width - inset * 2, 2);
  }
  if (!body) return;

  drawFrame(context, body, 10);
  const sidebar = localRect(root.querySelector('.inventory-screen__sidebar'), rootRect);
  const content = localRect(root.querySelector('.inventory-screen__content'), rootRect);
  if (sidebar) {
    const gradient = context.createLinearGradient(0, sidebar.y, 0, sidebar.y + sidebar.height);
    gradient.addColorStop(0, '#172543');
    gradient.addColorStop(1, '#0c1428');
    context.fillStyle = gradient;
    context.fillRect(sidebar.x + 6, sidebar.y + 6, sidebar.width - 6, sidebar.height - 12);
  }
  if (content) {
    const gradient = context.createLinearGradient(content.x, content.y, content.x + content.width, content.y + content.height);
    gradient.addColorStop(0, '#303957');
    gradient.addColorStop(0.48, '#242d49');
    gradient.addColorStop(1, '#202943');
    context.fillStyle = gradient;
    context.fillRect(content.x, content.y + 6, content.width - 6, content.height - 12);
  }
  if (sidebar && content) {
    const divider = content.x;
    context.fillStyle = 'rgba(218, 228, 247, 0.55)';
    context.fillRect(divider - 1, body.y + 9, 1, body.height - 18);
    context.fillStyle = 'rgba(5, 10, 22, 0.72)';
    context.fillRect(divider, body.y + 9, 2, body.height - 18);
  }
}

function drawCategory(context, root, rootRect) {
  const title = localRect(root.querySelector('.inventory-screen__sidebar h2'), rootRect);
  if (title) {
    const gradient = context.createLinearGradient(0, title.y, 0, title.y + title.height);
    gradient.addColorStop(0, '#238ee1');
    gradient.addColorStop(1, '#0750a2');
    context.fillStyle = gradient;
    context.fillRect(title.x, title.y, title.width, title.height);
    context.fillStyle = 'rgba(154, 224, 255, 0.8)';
    context.fillRect(title.x, title.y, title.width, 1);
    context.fillStyle = 'rgba(6, 25, 59, 0.85)';
    context.fillRect(title.x, title.y + title.height - 2, title.width, 2);
  }

  const tab = localRect(root.querySelector('.inventory-screen__category'), rootRect);
  if (!tab) return;
  context.save();
  context.shadowColor = 'rgba(77, 188, 255, 0.32)';
  context.shadowBlur = 9;
  beveledRect(context, tab.x, tab.y, tab.width, tab.height, 9);
  const gradient = context.createLinearGradient(tab.x, tab.y, tab.x + tab.width, tab.y + tab.height);
  gradient.addColorStop(0, '#137dac');
  gradient.addColorStop(0.55, '#164875');
  gradient.addColorStop(1, '#172746');
  context.fillStyle = gradient;
  context.fill();
  context.restore();
  beveledRect(context, tab.x + 1, tab.y + 1, tab.width - 2, tab.height - 2, 8);
  context.strokeStyle = 'rgba(122, 209, 250, 0.8)';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = 'rgba(204, 239, 255, 0.72)';
  context.fillRect(tab.x + 9, tab.y + 5, Math.max(0, tab.width - 18), 1);
}

function drawItemSlot(context, rect, item, image, selected, hovered) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const { x, y, width, height } = rect;
  const cut = Math.max(5, Math.min(12, width * 0.055));
  context.save();
  context.shadowColor = selected || hovered ? 'rgba(100, 222, 255, 0.72)' : 'rgba(0, 0, 0, 0.62)';
  context.shadowBlur = selected || hovered ? 14 : 8;
  context.shadowOffsetY = 4;
  beveledRect(context, x, y, width, height, cut);
  context.fillStyle = metalGradient(context, x, y, width, height, selected || hovered);
  context.fill();
  context.restore();

  beveledRect(context, x + 4, y + 4, width - 8, height - 8, Math.max(3, cut - 3));
  const panel = context.createLinearGradient(x, y, x, y + height);
  panel.addColorStop(0, selected ? '#4387ec' : '#3869bd');
  panel.addColorStop(0.65, '#234a92');
  panel.addColorStop(1, '#132e69');
  context.fillStyle = panel;
  context.fill();
  context.strokeStyle = 'rgba(221, 234, 255, 0.88)';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = 'rgba(154, 202, 255, 0.3)';
  context.fillRect(x + 9, y + 7, Math.max(0, width - 18), 1);

  const iconSize = Math.min(width * 0.56, height * 0.55);
  const iconX = x + (width - iconSize) / 2;
  const iconY = y + height * 0.1;
  const iconPad = Math.max(3, width * 0.035);
  const iconRect = { x: iconX - iconPad, y: iconY - iconPad, width: iconSize + iconPad * 2, height: iconSize + iconPad * 2 };
  context.save();
  context.shadowColor = 'rgba(1, 5, 17, 0.8)';
  context.shadowBlur = 7;
  beveledRect(context, iconRect.x, iconRect.y, iconRect.width, iconRect.height, Math.max(4, cut - 2));
  const iconPanel = context.createLinearGradient(iconRect.x, iconRect.y, iconRect.x + iconRect.width, iconRect.y + iconRect.height);
  iconPanel.addColorStop(0, '#070d1d');
  iconPanel.addColorStop(0.5, '#141d33');
  iconPanel.addColorStop(1, '#080d1a');
  context.fillStyle = iconPanel;
  context.fill();
  context.restore();
  beveledRect(context, iconRect.x + 1, iconRect.y + 1, iconRect.width - 2, iconRect.height - 2, Math.max(3, cut - 4));
  context.strokeStyle = 'rgba(134, 172, 223, 0.9)';
  context.lineWidth = 1.5;
  context.stroke();

  if (image?.complete && image.naturalWidth > 0) {
    const ratio = Math.min(iconSize / image.naturalWidth, iconSize / image.naturalHeight);
    const drawWidth = image.naturalWidth * ratio;
    const drawHeight = image.naturalHeight * ratio;
    context.save();
    beveledRect(context, iconRect.x + 2, iconRect.y + 2, iconRect.width - 4, iconRect.height - 4, Math.max(2, cut - 5));
    context.clip();
    context.shadowColor = 'rgba(35, 198, 255, 0.32)';
    context.shadowBlur = 12;
    context.drawImage(image, x + (width - drawWidth) / 2, iconY + (iconSize - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
  }

  const count = formatQuantity(item.quantity);
  const countFont = Math.max(11, Math.min(15, width * 0.09));
  context.font = `800 ${countFont}px Arial, sans-serif`;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  const countWidth = context.measureText(count).width + 10;
  const countX = iconRect.x + iconRect.width - 3;
  const countY = iconRect.y + iconRect.height - 4;
  roundedRect(context, countX - countWidth, countY - countFont * 0.72, countWidth, countFont * 1.4, 4);
  context.fillStyle = 'rgba(5, 10, 20, 0.9)';
  context.fill();
  context.fillStyle = '#fff';
  context.fillText(count, countX - 4, countY);

  const label = item.name || '';
  const labelFont = Math.max(10, Math.min(13, width * 0.085));
  context.font = `700 ${labelFont}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(6, 12, 30, 0.68)';
  context.fillRect(x + 7, y + height * 0.77, width - 14, height * 0.18);
  context.fillStyle = '#fff2c9';
  context.shadowColor = '#08132b';
  context.shadowBlur = 3;
  context.fillText(label, x + width / 2, y + height * 0.86, width - 18);
  context.restore();
}

function formatQuantity(quantity) {
  return new Intl.NumberFormat('vi-VN').format(quantity ?? 0);
}

function drawCurrencies(context, root, rootRect) {
  root.querySelectorAll('.inventory-screen__currencies .currency__item').forEach((element) => {
    const rect = localRect(element, rootRect);
    if (!rect) return;
    drawFrame(context, rect, 7);
    const gradient = context.createLinearGradient(0, rect.y + 4, 0, rect.y + rect.height - 4);
    gradient.addColorStop(0, '#19243d');
    gradient.addColorStop(0.55, '#080e1b');
    gradient.addColorStop(1, '#1a2742');
    roundedRect(context, rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8, 5);
    context.fillStyle = gradient;
    context.fill();
  });
}

export default function MagicBoxCanvas({ items, hoveredItemId, selectedItemId, visible }) {
  const canvasRef = useRef(null);
  const iconCache = useRef(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest('#inventoryModal');
    if (!canvas || !root || !visible || root.hidden) return undefined;
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('Canvas 2D is not available for the Magic Box interface.');
      return undefined;
    }

    let animationFrame = 0;
    let disposed = false;
    const getIcon = (item) => {
      if (!iconCache.current.has(item.image)) {
        const image = new Image();
        image.src = item.image;
        iconCache.current.set(item.image, image);
      }
      const image = iconCache.current.get(item.image);
      image.onload = scheduleDraw;
      image.onerror = () => {
        if (!disposed) console.error(`Could not load Magic Box item icon: ${item.image}`);
      };
      return image;
    };

    const draw = () => {
      animationFrame = 0;
      if (disposed || root.hidden) return;
      const bounds = root.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(bounds.width * ratio));
      const pixelHeight = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const currentRootRect = root.getBoundingClientRect();
      drawPanel(context, root, currentRootRect);
      drawCategory(context, root, currentRootRect);
      drawCurrencies(context, root, currentRootRect);
      root.querySelectorAll('.inventory-item[data-inventory-item]').forEach((element, index) => {
        const item = items[index];
        if (!item) return;
        drawItemSlot(
          context,
          localRect(element, currentRootRect),
          item,
          getIcon(item),
          selectedItemId === item.id,
          hoveredItemId === item.id
        );
      });
    };

    function scheduleDraw() {
      if (!disposed && !animationFrame) animationFrame = window.requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(scheduleDraw);
    const content = root.querySelector('.inventory-screen__content');
    observer.observe(root);
    root.querySelectorAll('.inventory-screen__topbar, .inventory-screen__body, .inventory-screen__content, .inventory-screen__heading, .inventory-grid, .inventory-item, .inventory-screen__category').forEach((element) => observer.observe(element));
    content?.addEventListener('scroll', scheduleDraw, { passive: true });
    scheduleDraw();

    return () => {
      disposed = true;
      observer.disconnect();
      content?.removeEventListener('scroll', scheduleDraw);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [items, hoveredItemId, selectedItemId, visible]);

  return <canvas className="inventory-screen__canvas" ref={canvasRef} aria-hidden="true" />;
}
