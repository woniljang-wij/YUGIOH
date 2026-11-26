import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const LOGICAL_W = 920;
const LOGICAL_H = 500;
const INTRO_DURATION_MS = 880;

const HIEROGLYPHS = ['𓂀', '𓏏', '𓆣', '𓋹', '𓁹', '𓊽', '𓅃', '𓇳', '𓏤', '𓎟', '𓌀', '𓉐'];

const DISPLAY_PAIR_KERNING_EM = {
  ẤT: -0.09,
  AT: -0.09,
  HẤ: -0.026,
  HẮ: -0.026,
  TH: -0.018,
  BẠ: -0.03,
  ẠI: -0.026,
  ẮN: -0.022,
  ẾN: -0.016
};

function drawDisplayTitleText(ctx, rawText, cx, cy, fontPx, mode = 'fill') {
  const chars = Array.from(String(rawText || '').normalize('NFC'));
  if (!chars.length) return;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';

  const advances = chars.map((ch, idx) => {
    const w = ctx.measureText(ch).width;
    if (idx === chars.length - 1) return w;
    const pair = ch + chars[idx + 1];
    const kern = (DISPLAY_PAIR_KERNING_EM[pair] || 0) * fontPx;
    return w + kern;
  });
  const totalWidth = advances.reduce((sum, v) => sum + v, 0);
  let cursorX = cx - totalWidth / 2;

  for (let i = 0; i < chars.length; i += 1) {
    if (mode === 'stroke') {
      ctx.strokeText(chars[i], cursorX, cy);
    } else {
      ctx.fillText(chars[i], cursorX, cy);
    }
    cursorX += advances[i];
  }
  ctx.textAlign = prevAlign;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

function easeOutBack(t) {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

function drawHexPath(ctx, cx, cy, w, h, pointW = 28) {
  const hw = w / 2;
  const hh = h / 2;
  const p = Math.min(pointW, hw * 0.45);
  ctx.beginPath();
  ctx.moveTo(cx - hw + p, cy - hh);
  ctx.lineTo(cx + hw - p, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx + hw - p, cy + hh);
  ctx.lineTo(cx - hw + p, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

function drawMiniCardBack(ctx, w, h) {
  const hw = w / 2;
  const hh = h / 2;

  const borderGrad = ctx.createLinearGradient(-hw, -hh, hw, hh);
  borderGrad.addColorStop(0, '#f3d18c');
  borderGrad.addColorStop(0.5, '#b68236');
  borderGrad.addColorStop(1, '#714815');
  ctx.fillStyle = borderGrad;
  ctx.beginPath();
  ctx.roundRect(-hw, -hh, w, h, 4);
  ctx.fill();

  const pad = Math.max(3, w * 0.075);
  const innerGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, Math.max(w, h) * 0.65);
  innerGrad.addColorStop(0, '#6c3424');
  innerGrad.addColorStop(0.6, '#3e1a12');
  innerGrad.addColorStop(1, '#1d0a07');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(-hw + pad, -hh + pad, w - pad * 2, h - pad * 2);

  ctx.strokeStyle = 'rgba(236, 189, 114, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-hw + pad + 1.5, -hh + pad + 1.5, w - (pad + 1.5) * 2, h - (pad + 1.5) * 2);

  // Iconic dark oval vortex center
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.22, h * 0.27, -0.18, 0, Math.PI * 2);
  const vortexGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, h * 0.28);
  vortexGrad.addColorStop(0, '#120d10');
  vortexGrad.addColorStop(0.65, '#2f1d19');
  vortexGrad.addColorStop(1, '#8c5334');
  ctx.fillStyle = vortexGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(242, 198, 122, 0.42)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();
}

function drawMillenniumCrest(ctx, cx, topY, scale, elapsedSec, isWin) {
  ctx.save();
  const bobY = Math.sin(elapsedSec * 2.3) * 2.8;
  ctx.translate(cx, topY + bobY);
  ctx.scale(scale, scale);

  // Side golden wing spikes for Defeat crest (matching Lose reference image)
  if (!isWin) {
    [-1, 1].forEach((dir) => {
      ctx.save();
      ctx.scale(dir, 1);
      const wingGrad = ctx.createLinearGradient(25, 16, 108, 62);
      wingGrad.addColorStop(0, '#fff3be');
      wingGrad.addColorStop(0.45, '#daa53c');
      wingGrad.addColorStop(1, '#784e10');
      ctx.fillStyle = wingGrad;
      ctx.beginPath();
      ctx.moveTo(36, 30);
      ctx.lineTo(96, 8);
      ctx.lineTo(74, 48);
      ctx.lineTo(106, 44);
      ctx.lineTo(54, 68);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a2004';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    });
  }

  // Outer stepped crown tabs behind inverted triangle
  const outerGrad = ctx.createLinearGradient(-90, 0, 90, 128);
  outerGrad.addColorStop(0, '#fff4c2');
  outerGrad.addColorStop(0.32, '#eab94f');
  outerGrad.addColorStop(0.68, '#9b6919');
  outerGrad.addColorStop(1, '#f7d983');

  ctx.shadowColor = isWin ? 'rgba(255, 204, 72, 0.55)' : 'rgba(255, 165, 52, 0.42)';
  ctx.shadowBlur = 18;

  // Top stepped bar
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.moveTo(-36, 0);
  ctx.lineTo(36, 0);
  ctx.lineTo(44, 12);
  ctx.lineTo(-44, 12);
  ctx.closePath();
  ctx.fill();

  // Main inverted pyramid
  const triW = isWin ? 86 : 68;
  const triH = isWin ? 124 : 98;
  ctx.beginPath();
  ctx.moveTo(-triW, 10);
  ctx.lineTo(triW, 10);
  ctx.lineTo(0, 10 + triH);
  ctx.closePath();
  ctx.fillStyle = outerGrad;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#4e2f06';
  ctx.stroke();

  // Inner recessed dark-bronze triangle
  ctx.shadowBlur = 0;
  const inW = triW * 0.76;
  const inH = triH * 0.74;
  ctx.beginPath();
  ctx.moveTo(-inW, 20);
  ctx.lineTo(inW, 20);
  ctx.lineTo(0, 20 + inH);
  ctx.closePath();
  const recessGrad = ctx.createLinearGradient(0, 20, 0, 20 + inH);
  recessGrad.addColorStop(0, '#3b2407');
  recessGrad.addColorStop(0.55, '#6d4712');
  recessGrad.addColorStop(1, '#291703');
  ctx.fillStyle = recessGrad;
  ctx.fill();
  ctx.strokeStyle = '#ffe596';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Millennium Eye (Eye of Wdjat) with live pulsing glow
  const eyeY = isWin ? 54 : 47;
  const eyeScale = isWin ? 1 : 0.82;
  const eyePulse = 0.65 + 0.35 * Math.sin(elapsedSec * 3.6);
  ctx.save();
  ctx.translate(0, eyeY);
  ctx.scale(eyeScale, eyeScale);

  ctx.shadowColor = `rgba(255, 232, 132, ${0.85 * eyePulse})`;
  ctx.shadowBlur = 12 * eyePulse;
  ctx.strokeStyle = '#ffeb9c';
  ctx.fillStyle = '#f5ca63';
  ctx.lineWidth = 2.6;

  // Brow arc
  ctx.beginPath();
  ctx.arc(0, 4, 28, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // Eye almond contour
  ctx.beginPath();
  ctx.moveTo(-26, 2);
  ctx.quadraticCurveTo(0, -14, 26, 2);
  ctx.quadraticCurveTo(0, 16, -26, 2);
  ctx.closePath();
  ctx.stroke();

  // Glowing golden iris
  ctx.beginPath();
  ctx.arc(0, 1, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff7cc';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 1, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#3b2104';
  ctx.fill();

  // Wdjat lower spiral & vertical tear markings
  ctx.beginPath();
  ctx.moveTo(-4, 10);
  ctx.lineTo(-8, 28);
  ctx.moveTo(5, 10);
  ctx.quadraticCurveTo(16, 22, 8, 30);
  ctx.arc(5, 27, 3.5, 0, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();

  // Live specular glint sweeping across pyramid
  const sweepPos = ((elapsedSec * 0.55) % 2.4) - 0.7;
  if (sweepPos >= -0.4 && sweepPos <= 1.4) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-triW, 10);
    ctx.lineTo(triW, 10);
    ctx.lineTo(0, 10 + triH);
    ctx.closePath();
    ctx.clip();
    const sx = (sweepPos - 0.5) * triW * 2.4;
    const glint = ctx.createLinearGradient(sx - 26, 0, sx + 26, 40);
    glint.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glint.addColorStop(0.5, 'rgba(255, 252, 220, 0.55)');
    glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glint;
    ctx.fillRect(-triW, 0, triW * 2, triH + 20);
    ctx.restore();
  }

  ctx.restore();
}

function drawLaurelWreath(ctx, cx, cy, side, elapsedSec, openProgress) {
  ctx.save();
  const sway = Math.sin(elapsedSec * 2.1 + (side === -1 ? 0 : 1.2)) * 0.035;
  ctx.translate(cx, cy);
  ctx.scale(side * openProgress, openProgress);
  ctx.rotate(sway);

  // Curved golden stem
  ctx.strokeStyle = '#d9a13b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 68);
  ctx.bezierCurveTo(-18, 48, -38, -8, -6, -74);
  ctx.stroke();

  const leaves = 9;
  for (let i = 0; i < leaves; i += 1) {
    const t = i / (leaves - 1);
    const u = 1 - t;
    // Cubic bezier point along stem
    const bx = u ** 3 * 32 + 3 * u ** 2 * t * -18 + 3 * u * t ** 2 * -38 + t ** 3 * -6;
    const by = u ** 3 * 68 + 3 * u ** 2 * t * 48 + 3 * u * t ** 2 * -8 + t ** 3 * -74;
    const baseAngle = -1.9 + t * 1.15;
    const leafLen = 24 - t * 5;
    const leafWid = 8.2 - t * 1.6;

    [-0.42, 0.44].forEach((spread, pairIdx) => {
      if (i === leaves - 1 && pairIdx === 1) return;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(baseAngle + spread);
      const lGrad = ctx.createLinearGradient(0, -leafWid, leafLen, leafWid);
      lGrad.addColorStop(0, '#fff2b6');
      lGrad.addColorStop(0.45, '#e5af42');
      lGrad.addColorStop(1, '#936014');
      ctx.fillStyle = lGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(leafLen * 0.48, -leafWid, leafLen, 0);
      ctx.quadraticCurveTo(leafLen * 0.48, leafWid, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(92, 54, 8, 0.65)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    });
  }
  ctx.restore();
}

function drawScrollingHieroglyphs(ctx, x, y, w, h, elapsedSec, isWin) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Subtle vertical stone column lines
  ctx.strokeStyle = isWin ? 'rgba(155, 175, 225, 0.14)' : 'rgba(56, 138, 235, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2, y);
  ctx.lineTo(x + 2, y + h);
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.5, y + h);
  ctx.moveTo(x + w - 2, y);
  ctx.lineTo(x + w - 2, y + h);
  ctx.stroke();

  const cellH = 30;
  const scroll = (elapsedSec * 14) % (HIEROGLYPHS.length * cellH);
  ctx.font = '600 18px "Segoe UI Symbol", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let col = 0; col < 2; col += 1) {
    const cx = x + (col === 0 ? w * 0.26 : w * 0.74);
    const dir = col === 0 ? -1 : 1;
    for (let row = -2; row < Math.ceil(h / cellH) + 3; row += 1) {
      const idx = ((row + col * 5) % HIEROGLYPHS.length + HIEROGLYPHS.length) % HIEROGLYPHS.length;
      const py = y + row * cellH + ((dir * scroll) % cellH);
      const glow = 0.45 + 0.55 * Math.sin(elapsedSec * 2.4 + row * 0.7 + col * 1.9);
      ctx.fillStyle = isWin
        ? `rgba(175, 196, 242, ${0.12 + 0.14 * glow})`
        : `rgba(68, 162, 255, ${0.16 + 0.22 * glow})`;
      ctx.fillText(HIEROGLYPHS[idx], cx, py);
    }
  }
  ctx.restore();
}

function drawActionPlaque(ctx, rect, variant, label, hovered, elapsedSec, isWinModal) {
  const { cx, cy, w, h } = rect;
  ctx.save();
  const hoverScale = hovered ? 1.035 : 1;
  ctx.translate(cx, cy);
  ctx.scale(hoverScale, hoverScale);

  // Drop shadow + hover aura
  ctx.shadowColor = hovered
    ? (variant === 'gold' ? 'rgba(255, 214, 92, 0.75)' : 'rgba(72, 178, 255, 0.78)')
    : 'rgba(0, 0, 0, 0.62)';
  ctx.shadowBlur = hovered ? 22 : 14;
  ctx.shadowOffsetY = 4;

  // Outer metallic bezel (silver for Win modal; gold/silver-blue tech bezel for Lose modal)
  if (!isWinModal) {
    // Tech accent tabs on top-left and bottom edges matching Lose reference
    ctx.fillStyle = variant === 'gold' ? '#f3c65f' : '#9cc8ff';
    ctx.fillRect(-w / 2 + 34, -h / 2 - 4, 34, 5);
    ctx.fillRect(w / 2 - 74, h / 2 - 1, 36, 5);
  }
  drawHexPath(ctx, 0, 0, w, h, 30);
  const outerGrad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  if (!isWinModal && variant === 'gold') {
    outerGrad.addColorStop(0, '#fff3be');
    outerGrad.addColorStop(0.5, '#d19b34');
    outerGrad.addColorStop(1, '#6f480c');
  } else {
    outerGrad.addColorStop(0, '#f4f8ff');
    outerGrad.addColorStop(0.48, '#9aaac4');
    outerGrad.addColorStop(1, '#4c5972');
  }
  ctx.fillStyle = outerGrad;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(255, 255, 255, 0.65)';
  ctx.stroke();

  // Inner colored plaque
  const pad = 6.5;
  drawHexPath(ctx, 0, 0, w - pad * 2, h - pad * 2, 25);
  const innerGrad = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  if (variant === 'gold') {
    innerGrad.addColorStop(0, '#fbe088');
    innerGrad.addColorStop(0.35, '#f6c851');
    innerGrad.addColorStop(0.68, '#d49626');
    innerGrad.addColorStop(1, '#f8dc7e');
  } else {
    innerGrad.addColorStop(0, '#1c6fe3');
    innerGrad.addColorStop(0.45, '#0c41a6');
    innerGrad.addColorStop(0.8, '#082972');
    innerGrad.addColorStop(1, '#1a5fd4');
  }
  ctx.fillStyle = innerGrad;
  ctx.fill();

  // Clip inside inner plaque for watermark rings & periodic metallic sheen
  ctx.save();
  ctx.clip();

  // Faint concentric vortex rings on left & right of button
  ctx.strokeStyle = variant === 'gold'
    ? 'rgba(130, 78, 8, 0.16)'
    : 'rgba(145, 212, 255, 0.15)';
  ctx.lineWidth = 1.2;
  [-w * 0.28, w * 0.28].forEach((ox) => {
    [16, 26, 36].forEach((r) => {
      ctx.beginPath();
      ctx.arc(ox, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  });

  // Periodic diagonal sheen sweep
  const cycle = ((elapsedSec * 0.65 + (variant === 'gold' ? 0 : 0.9)) % 2.8) - 0.6;
  if (cycle >= -0.3 && cycle <= 1.3) {
    const sx = (cycle - 0.5) * w * 1.4;
    const sheen = ctx.createLinearGradient(sx - 34, -h / 2, sx + 34, h / 2);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(0.5, variant === 'gold' ? 'rgba(255, 255, 235, 0.5)' : 'rgba(185, 232, 255, 0.36)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();

  // Inner bevel stroke
  drawHexPath(ctx, 0, 0, w - pad * 2, h - pad * 2, 25);
  ctx.strokeStyle = variant === 'gold' ? 'rgba(110, 65, 6, 0.7)' : 'rgba(145, 212, 255, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Icon + Label
  const iconX = -64;
  if (variant === 'gold') {
    // Crisp circular refresh arrows
    ctx.save();
    ctx.translate(iconX, 0);
    const arrowColor = isWinModal ? '#1e2433' : '#1658b8';
    ctx.strokeStyle = arrowColor;
    ctx.fillStyle = arrowColor;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 14, -Math.PI * 0.82, Math.PI * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 3);
    ctx.lineTo(8, -4);
    ctx.lineTo(19, -5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 14, Math.PI * 0.18, Math.PI * 1.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, -3);
    ctx.lineTo(-8, 4);
    ctx.lineTo(-19, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#141824';
    ctx.fillText(label, iconX + 28, 1);
  } else {
    // Crisp house icon (dark roof on Win, red roof on Lose matching reference!)
    ctx.save();
    ctx.translate(iconX, 1);
    // Walls
    ctx.fillStyle = '#f5f8ff';
    ctx.strokeStyle = '#12254a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-13, -3, 26, 18, 2.5);
    ctx.fill();
    ctx.stroke();
    // Door & window
    ctx.fillStyle = '#1b56b5';
    ctx.fillRect(-8, 4, 6, 11);
    ctx.fillRect(2, 3, 6, 6);
    // Roof
    ctx.beginPath();
    ctx.moveTo(-18, -1);
    ctx.lineTo(0, -17);
    ctx.lineTo(18, -1);
    ctx.lineTo(13, -1);
    ctx.lineTo(0, -12);
    ctx.lineTo(-13, -1);
    ctx.closePath();
    ctx.fillStyle = isWinModal ? '#1c2438' : '#d92638';
    ctx.fill();
    ctx.strokeStyle = isWinModal ? '#eef4ff' : '#ffd5dc';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 8, 28, 0.78)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#f8fbff';
    ctx.fillText(label, iconX + 28, 1);
  }

  ctx.restore();
}

function drawWinFrameAndScene(ctx, elapsedSec, introT, lpText, hoveredBtn, titleText) {
  const frameLeft = 64;
  const frameTop = 58;
  const frameW = LOGICAL_W - frameLeft * 2;
  const frameH = 396;
  const frameRight = frameLeft + frameW;
  const frameBottom = frameTop + frameH;
  const cx = LOGICAL_W / 2;

  // 1. Interior dark royal-indigo panel
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frameLeft + 14, frameTop + 14, frameW - 28, frameH - 28, 8);
  const bgGrad = ctx.createRadialGradient(cx, frameTop + 165, 20, cx, frameTop + 200, 430);
  bgGrad.addColorStop(0, '#2b3254');
  bgGrad.addColorStop(0.55, '#17203d');
  bgGrad.addColorStop(1, '#0d1429');
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.clip();

  // Scrolling Egyptian hieroglyph columns on left & right
  drawScrollingHieroglyphs(ctx, frameLeft + 24, frameTop + 20, 62, frameH - 40, elapsedSec, true);
  drawScrollingHieroglyphs(ctx, frameRight - 86, frameTop + 20, 62, frameH - 40, elapsedSec, true);

  // Rotating golden volumetric sunbeams behind fanned cards
  const rayProgress = clamp01((introT - 0.18) / 0.55);
  if (rayProgress > 0) {
    ctx.save();
    ctx.translate(cx, frameTop + 166);
    ctx.globalAlpha = rayProgress;
    const aura = ctx.createRadialGradient(0, 0, 12, 0, 0, 225);
    aura.addColorStop(0, 'rgba(255, 240, 165, 0.85)');
    aura.addColorStop(0.38, 'rgba(255, 192, 68, 0.34)');
    aura.addColorStop(1, 'rgba(255, 160, 36, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 225, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(elapsedSec * 0.24);
    const rayCount = 16;
    for (let i = 0; i < rayCount; i += 1) {
      const a = (i / rayCount) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      const rGrad = ctx.createLinearGradient(0, 0, 230, 0);
      rGrad.addColorStop(0, 'rgba(255, 236, 152, 0.42)');
      rGrad.addColorStop(0.65, 'rgba(255, 198, 78, 0.12)');
      rGrad.addColorStop(1, 'rgba(255, 198, 78, 0)');
      ctx.fillStyle = rGrad;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(230, -22);
      ctx.lineTo(230, 22);
      ctx.lineTo(0, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // 5 Fanned Yu-Gi-Oh! Card Backs
  const fanProgress = easeOutBack(clamp01((introT - 0.22) / 0.52));
  if (fanProgress > 0) {
    const baseAngles = [-0.46, -0.23, 0, 0.23, 0.46];
    baseAngles.forEach((ang, idx) => {
      const breathe = Math.sin(elapsedSec * 2.2 + idx * 0.7) * 0.022;
      const curAngle = ang * fanProgress + breathe;
      const arcX = Math.sin(curAngle) * 112;
      const arcY = (1 - Math.cos(curAngle)) * 68 + Math.cos(elapsedSec * 2.0 + idx) * 1.8;
      ctx.save();
      ctx.translate(cx + arcX, frameTop + 154 + arcY);
      ctx.rotate(curAngle);
      ctx.scale(fanProgress, fanProgress);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 10;
      drawMiniCardBack(ctx, 64, 92);
      ctx.restore();
    });
  }

  // Golden laurel wreaths on left & right
  const wreathProgress = easeOutBack(clamp01((introT - 0.28) / 0.5));
  if (wreathProgress > 0) {
    drawLaurelWreath(ctx, cx - 238, frameTop + 162, 1, elapsedSec, wreathProgress);
    drawLaurelWreath(ctx, cx + 238, frameTop + 162, -1, elapsedSec, wreathProgress);
  }
  ctx.restore();

  // 2. Outer Silver-Crimson-Gold Stepped Architectural Frame
  ctx.save();
  // Crimson corner & side recessed inlays
  ctx.fillStyle = '#7e1020';
  ctx.strokeStyle = '#3a060e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(frameLeft, frameTop, frameW, frameH, 6);
  ctx.rect(frameLeft + 18, frameTop + 16, frameW - 36, frameH - 32);
  ctx.fill('evenodd');

  // Silver metallic main frame rails + stepped corner plates
  const silverGrad = ctx.createLinearGradient(frameLeft, frameTop, frameRight, frameBottom);
  silverGrad.addColorStop(0, '#f4f8ff');
  silverGrad.addColorStop(0.28, '#b8c5da');
  silverGrad.addColorStop(0.52, '#eff5ff');
  silverGrad.addColorStop(0.78, '#77859e');
  silverGrad.addColorStop(1, '#d9e3f2');

  ctx.strokeStyle = silverGrad;
  ctx.lineWidth = 11;
  ctx.strokeRect(frameLeft + 7, frameTop + 7, frameW - 14, frameH - 14);

  // Inner thin gold-red accent trim along top shoulders
  const goldTrim = ctx.createLinearGradient(cx - 260, frameTop, cx + 260, frameTop + 34);
  goldTrim.addColorStop(0, '#d59d38');
  goldTrim.addColorStop(0.5, '#fff0b5');
  goldTrim.addColorStop(1, '#b87d1e');
  ctx.strokeStyle = goldTrim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(frameLeft + 140, frameTop + 14);
  ctx.lineTo(cx - 98, frameTop + 14);
  ctx.lineTo(cx - 72, frameTop + 32);
  ctx.lineTo(cx + 72, frameTop + 32);
  ctx.lineTo(cx + 98, frameTop + 14);
  ctx.lineTo(frameRight - 140, frameTop + 14);
  ctx.stroke();

  // 4 Stepped silver corner armor brackets
  [
    [frameLeft, frameTop, 1, 1],
    [frameRight, frameTop, -1, 1],
    [frameLeft, frameBottom, 1, -1],
    [frameRight, frameBottom, -1, -1]
  ].forEach(([ox, oy, sx, sy]) => {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(sx, sy);
    ctx.fillStyle = silverGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(96, 0);
    ctx.lineTo(76, 18);
    ctx.lineTo(18, 18);
    ctx.lineTo(18, 76);
    ctx.lineTo(0, 96);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#33415c';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Crimson corner gem inlay
    ctx.fillStyle = '#991426';
    ctx.beginPath();
    ctx.moveTo(22, 6);
    ctx.lineTo(68, 6);
    ctx.lineTo(56, 15);
    ctx.lineTo(22, 15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Bottom center crimson-silver trapezoid notch
  ctx.fillStyle = silverGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 64, frameBottom - 12);
  ctx.lineTo(cx + 64, frameBottom - 12);
  ctx.lineTo(cx + 46, frameBottom + 8);
  ctx.lineTo(cx - 46, frameBottom + 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#344056';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.fillStyle = '#8d1122';
  ctx.beginPath();
  ctx.moveTo(cx - 42, frameBottom - 7);
  ctx.lineTo(cx + 42, frameBottom - 7);
  ctx.lineTo(cx + 30, frameBottom + 3);
  ctx.lineTo(cx - 30, frameBottom + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 3. Top Millennium Pyramid Crest
  const crestScale = easeOutBack(clamp01((introT - 0.16) / 0.5));
  if (crestScale > 0) {
    drawMillenniumCrest(ctx, cx, 10, crestScale, elapsedSec, true);
  }

  // 4. Bold 3D Metallic Gold-Red "CHIẾN THẮNG!" Title
  const titleProgress = easeOutBack(clamp01((introT - 0.34) / 0.44));
  if (titleProgress > 0) {
    ctx.save();
    const titleScale = 1.28 - 0.28 * titleProgress;
    ctx.translate(cx, frameTop + 172);
    ctx.scale(titleScale, titleScale);
    ctx.globalAlpha = clamp01((introT - 0.34) / 0.22);
    const winFontPx = 64;
    ctx.font = `italic bold ${winFontPx}px "Cambria", "Palatino Linotype", "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Deep crimson/mahogany 3D extrusion layers
    ctx.fillStyle = '#3b070c';
    for (let d = 6; d >= 1; d -= 1) {
      drawDisplayTitleText(ctx, titleText, d * 0.6, d * 1.15, winFontPx, 'fill');
    }

    // Outer cream-gold rim
    ctx.lineWidth = 6.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f9cf6b';
    drawDisplayTitleText(ctx, titleText, 0, 0, winFontPx, 'stroke');

    // Rich crimson-to-gold metallic fill
    const textGrad = ctx.createLinearGradient(0, -34, 0, 32);
    textGrad.addColorStop(0, '#fff7d1');
    textGrad.addColorStop(0.35, '#f6b94d');
    textGrad.addColorStop(0.68, '#b5231c');
    textGrad.addColorStop(1, '#ffd978');
    ctx.fillStyle = textGrad;
    drawDisplayTitleText(ctx, titleText, 0, 0, winFontPx, 'fill');

    // Periodic bright shimmer highlight across letters
    const shimmer = ((elapsedSec * 0.52) % 2.6) - 0.5;
    if (shimmer >= -0.2 && shimmer <= 1.2) {
      const sx = (shimmer - 0.5) * 520;
      const sGrad = ctx.createLinearGradient(sx - 40, -30, sx + 40, 30);
      sGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      sGrad.addColorStop(0.5, 'rgba(255, 255, 240, 0.65)');
      sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sGrad;
      drawDisplayTitleText(ctx, titleText, 0, 0, winFontPx, 'fill');
    }
    ctx.restore();
  }

  // 5. LP Sub-Banner ("LP còn lại: ...")
  const lpProgress = easeOutCubic(clamp01((introT - 0.48) / 0.36));
  if (lpProgress > 0) {
    ctx.save();
    ctx.globalAlpha = lpProgress;
    const lpY = frameTop + 252 + (1 - lpProgress) * 14;
    drawHexPath(ctx, cx, lpY, 356, 48, 22);
    const lpBg = ctx.createLinearGradient(cx - 178, lpY - 24, cx + 178, lpY + 24);
    lpBg.addColorStop(0, 'rgba(13, 19, 42, 0.94)');
    lpBg.addColorStop(0.5, 'rgba(24, 32, 64, 0.96)');
    lpBg.addColorStop(1, 'rgba(13, 19, 42, 0.94)');
    ctx.fillStyle = lpBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e5b354';
    ctx.stroke();

    ctx.font = '700 25px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f7ff';
    ctx.fillText(lpText, cx, lpY + 1);
    ctx.restore();
  }

  // 6. Two Hexagonal Action Buttons ("Đấu lại" & "Về sảnh")
  const btnProgress = easeOutBack(clamp01((introT - 0.56) / 0.38));
  if (btnProgress > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01((introT - 0.56) / 0.24);
    const offsetY = (1 - btnProgress) * 20;
    drawActionPlaque(
      ctx,
      { cx: cx - 166, cy: frameTop + 334 + offsetY, w: 294, h: 74 },
      'gold',
      'Đấu lại',
      hoveredBtn === 'rematch',
      elapsedSec,
      true
    );
    drawActionPlaque(
      ctx,
      { cx: cx + 166, cy: frameTop + 334 + offsetY, w: 294, h: 74 },
      'blue',
      'Về sảnh',
      hoveredBtn === 'exit',
      elapsedSec,
      true
    );
    ctx.restore();
  }
}

function drawLoseFrameAndScene(ctx, elapsedSec, introT, lpText, hoveredBtn) {
  const frameLeft = 64;
  const frameTop = 58;
  const frameW = LOGICAL_W - frameLeft * 2;
  const frameH = 396;
  const frameRight = frameLeft + frameW;
  const frameBottom = frameTop + frameH;
  const cx = LOGICAL_W / 2;

  // 1. Interior Abyssal Navy Panel + Counter-Rotating Arcane Blue Magic Circles
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frameLeft + 14, frameTop + 14, frameW - 28, frameH - 28, 6);
  const bgGrad = ctx.createRadialGradient(cx, frameTop + 185, 16, cx, frameTop + 195, 430);
  bgGrad.addColorStop(0, '#0b1838');
  bgGrad.addColorStop(0.6, '#060e24');
  bgGrad.addColorStop(1, '#030714');
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.clip();

  // Counter-rotating arcane blue rune seals
  const sealAlpha = clamp01((introT - 0.14) / 0.5);
  if (sealAlpha > 0) {
    const sealCy = frameTop + 198;
    ctx.save();
    ctx.translate(cx, sealCy);
    ctx.globalAlpha = sealAlpha * 0.34;
    ctx.strokeStyle = '#2d82e8';

    // Outer clockwise ring + rune ticks
    ctx.save();
    ctx.rotate(elapsedSec * 0.18);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 174, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 156, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 156, Math.sin(a) * 156);
      ctx.lineTo(Math.cos(a) * 174, Math.sin(a) * 174);
      ctx.stroke();
    }
    ctx.restore();

    // Inner counter-clockwise geometric hexagram + ring
    ctx.save();
    ctx.rotate(-elapsedSec * 0.25);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, 126, 0, Math.PI * 2);
    ctx.stroke();
    for (let t = 0; t < 2; t += 1) {
      ctx.beginPath();
      for (let k = 0; k < 3; k += 1) {
        const a = t * (Math.PI / 3) + (k / 3) * Math.PI * 2;
        const px = Math.cos(a) * 124;
        const py = Math.sin(a) * 124;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  // Scrolling glowing blue Egyptian hieroglyph columns on left & right
  drawScrollingHieroglyphs(ctx, frameLeft + 24, frameTop + 20, 62, frameH - 40, elapsedSec, false);
  drawScrollingHieroglyphs(ctx, frameRight - 86, frameTop + 20, 62, frameH - 40, elapsedSec, false);

  // Pulsing crimson horizontal laser flare behind "THẤT BẠI"
  const laserProgress = clamp01((introT - 0.26) / 0.42);
  if (laserProgress > 0) {
    const laserY = frameTop + 136;
    const pulse = 0.78 + 0.22 * Math.sin(elapsedSec * 5.2);
    ctx.save();
    const darkCrimsonAura = ctx.createRadialGradient(cx, laserY, 8, cx, laserY, 240);
    darkCrimsonAura.addColorStop(0, `rgba(185, 16, 38, ${0.52 * laserProgress * pulse})`);
    darkCrimsonAura.addColorStop(0.55, `rgba(98, 8, 22, ${0.24 * laserProgress})`);
    darkCrimsonAura.addColorStop(1, 'rgba(20, 2, 8, 0)');
    ctx.fillStyle = darkCrimsonAura;
    ctx.fillRect(frameLeft + 40, laserY - 80, frameW - 80, 160);

    const span = (frameW * 0.44) * easeOutCubic(laserProgress);
    const lGrad = ctx.createLinearGradient(cx - span, laserY, cx + span, laserY);
    lGrad.addColorStop(0, 'rgba(255, 32, 62, 0)');
    lGrad.addColorStop(0.25, `rgba(255, 38, 68, ${0.85 * pulse})`);
    lGrad.addColorStop(0.5, '#ffd4dc');
    lGrad.addColorStop(0.75, `rgba(255, 38, 68, ${0.85 * pulse})`);
    lGrad.addColorStop(1, 'rgba(255, 32, 62, 0)');
    ctx.shadowColor = '#ff1e42';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = lGrad;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(cx - span, laserY);
    ctx.lineTo(cx + span, laserY);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 2. Angular Gold-Crimson Outer Frame + 4 Tilted Card-Back Corner Plates
  ctx.save();
  // Crimson side & top shoulder channels
  ctx.fillStyle = '#7c0c1c';
  ctx.beginPath();
  ctx.roundRect(frameLeft, frameTop, frameW, frameH, 4);
  ctx.rect(frameLeft + 18, frameTop + 18, frameW - 36, frameH - 36);
  ctx.fill('evenodd');

  const goldGrad = ctx.createLinearGradient(frameLeft, frameTop, frameRight, frameBottom);
  goldGrad.addColorStop(0, '#fff2bc');
  goldGrad.addColorStop(0.25, '#dda840');
  goldGrad.addColorStop(0.5, '#8c5d14');
  goldGrad.addColorStop(0.75, '#f0c362');
  goldGrad.addColorStop(1, '#9d6b19');

  ctx.strokeStyle = goldGrad;
  ctx.lineWidth = 10;
  ctx.strokeRect(frameLeft + 5, frameTop + 5, frameW - 10, frameH - 10);

  // Top crimson-gold shoulder bar under crest
  ctx.fillStyle = '#7d0e1e';
  ctx.beginPath();
  ctx.moveTo(cx - 210, frameTop + 6);
  ctx.lineTo(cx + 210, frameTop + 6);
  ctx.lineTo(cx + 186, frameTop + 28);
  ctx.lineTo(cx - 186, frameTop + 28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = goldGrad;
  ctx.lineWidth = 2.8;
  ctx.stroke();

  // Bottom-center pointed gold diamond notch (matching Lose reference image)
  ctx.fillStyle = goldGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 32, frameBottom - 6);
  ctx.lineTo(cx, frameBottom + 18);
  ctx.lineTo(cx + 32, frameBottom - 6);
  ctx.lineTo(cx, frameBottom - 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3b2304';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 4 Tilted Yu-Gi-Oh! Card-Back Corner Plates with Gold Corner Brackets
  const cornerCardSpecs = [
    { x: frameLeft + 30, y: frameTop + 38, rot: -0.36, sx: 1, sy: 1, bx: frameLeft, by: frameTop },
    { x: frameRight - 30, y: frameTop + 38, rot: 0.36, sx: -1, sy: 1, bx: frameRight, by: frameTop },
    { x: frameLeft + 30, y: frameBottom - 38, rot: 0.36, sx: 1, sy: -1, bx: frameLeft, by: frameBottom },
    { x: frameRight - 30, y: frameBottom - 38, rot: -0.36, sx: -1, sy: -1, bx: frameRight, by: frameBottom }
  ];
  cornerCardSpecs.forEach(({ x, y, rot, sx, sy, bx, by }) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(sx, sy);
    ctx.fillStyle = goldGrad;
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.lineTo(74, -2);
    ctx.lineTo(60, 12);
    ctx.lineTo(12, 12);
    ctx.lineTo(12, 60);
    ctx.lineTo(-2, 74);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3b2204';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 8;
    drawMiniCardBack(ctx, 48, 68);
    ctx.restore();
  });
  ctx.restore();

  // 3. Top Spiked Millennium Crest
  const crestScale = easeOutBack(clamp01((introT - 0.16) / 0.5));
  if (crestScale > 0) {
    drawMillenniumCrest(ctx, cx, 12, crestScale, elapsedSec, false);
  }

  // 4. Sharp Spiked Silver-Crimson "THẤT BẠI" Title
  const titleProgress = easeOutBack(clamp01((introT - 0.32) / 0.44));
  if (titleProgress > 0) {
    ctx.save();
    const shudderX = introT < 0.68 ? Math.sin(introT * 55) * (1 - introT / 0.68) * 4 : 0;
    const scale = 1.24 - 0.24 * titleProgress;
    ctx.translate(cx + shudderX, frameTop + 136);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp01((introT - 0.32) / 0.22);
    const loseFontPx = 70;
    ctx.font = `italic bold ${loseFontPx}px "Cambria", "Palatino Linotype", "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Deep blood-crimson 3D bevel + glow
    ctx.shadowColor = 'rgba(235, 24, 52, 0.72)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#4e0610';
    for (let d = 6; d >= 1; d -= 1) {
      drawDisplayTitleText(ctx, 'THẤT BẠI', d * 0.65, d * 1.2, loseFontPx, 'fill');
    }

    ctx.shadowBlur = 0;
    ctx.lineWidth = 5.5;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = '#a81426';
    drawDisplayTitleText(ctx, 'THẤT BẠI', 0, 0, loseFontPx, 'stroke');

    const loseTextGrad = ctx.createLinearGradient(0, -36, 0, 34);
    loseTextGrad.addColorStop(0, '#ffffff');
    loseTextGrad.addColorStop(0.48, '#e8edf7');
    loseTextGrad.addColorStop(0.82, '#f2b8c0');
    loseTextGrad.addColorStop(1, '#ffffff');
    ctx.fillStyle = loseTextGrad;
    drawDisplayTitleText(ctx, 'THẤT BẠI', 0, 0, loseFontPx, 'fill');
    ctx.restore();
  }

  // 5. Glowing Blue Stepped-Tech LP Banner ("LP còn lại: ...")
  const lpProgress = easeOutCubic(clamp01((introT - 0.46) / 0.36));
  if (lpProgress > 0) {
    ctx.save();
    ctx.globalAlpha = lpProgress;
    const lpY = frameTop + 232 + (1 - lpProgress) * 14;
    const hw = 192;
    const hh = 24;
    ctx.beginPath();
    ctx.moveTo(cx - hw + 26, lpY - hh);
    ctx.lineTo(cx + hw - 26, lpY - hh);
    ctx.lineTo(cx + hw - 10, lpY - 4);
    ctx.lineTo(cx + hw, lpY - 4);
    ctx.lineTo(cx + hw - 18, lpY + hh);
    ctx.lineTo(cx - hw + 18, lpY + hh);
    ctx.lineTo(cx - hw, lpY - 4);
    ctx.lineTo(cx - hw + 10, lpY - 4);
    ctx.closePath();
    const lpBg = ctx.createLinearGradient(cx - hw, lpY, cx + hw, lpY);
    lpBg.addColorStop(0, 'rgba(7, 22, 56, 0.92)');
    lpBg.addColorStop(0.5, 'rgba(13, 38, 88, 0.95)');
    lpBg.addColorStop(1, 'rgba(7, 22, 56, 0.92)');
    ctx.fillStyle = lpBg;
    ctx.fill();
    ctx.shadowColor = 'rgba(64, 158, 255, 0.55)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#3b8ef3';
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.font = '700 25px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eef6ff';
    ctx.fillText(lpText, cx, lpY + 1);
    ctx.restore();
  }

  // 6. Two Hexagonal Tech Action Buttons ("Đấu lại" & "Về sảnh")
  const btnProgress = easeOutBack(clamp01((introT - 0.56) / 0.38));
  if (btnProgress > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01((introT - 0.56) / 0.24);
    const offsetY = (1 - btnProgress) * 20;
    drawActionPlaque(
      ctx,
      { cx: cx - 166, cy: frameTop + 324 + offsetY, w: 294, h: 74 },
      'gold',
      'Đấu lại',
      hoveredBtn === 'rematch',
      elapsedSec,
      false
    );
    drawActionPlaque(
      ctx,
      { cx: cx + 166, cy: frameTop + 324 + offsetY, w: 294, h: 74 },
      'blue',
      'Về sảnh',
      hoveredBtn === 'exit',
      elapsedSec,
      false
    );
    ctx.restore();
  }
}

export default function DuelResultModal({
  open,
  winner,
  lpText,
  onRematch,
  onExit
}) {
  const threeCanvasRef = useRef(null);
  const uiCanvasRef = useRef(null);
  const hoveredBtnRef = useRef(null);
  const [hoveredBtn, setHoveredBtn] = useState(null);

  hoveredBtnRef.current = hoveredBtn;
  const isWin = winner === 'me' || winner !== 'opp';
  const titleText = winner === 'me' ? 'CHIẾN THẮNG!' : winner === 'opp' ? 'THẤT BẠI' : 'HÒA ĐẤU!';

  // Three.js 3D Void Rift & Live Floating Motes Layer
  useEffect(() => {
    if (!open) return undefined;
    const canvas = threeCanvasRef.current;
    if (!canvas) return undefined;

    let disposed = false;
    let rafId = 0;
    let renderer = null;
    let removeResize = null;
    const disposables = [];

    (async () => {
      let THREE = null;
      try {
        const importMap = document.querySelector('script[type="importmap"]');
        const threeUrl = importMap
          ? JSON.parse(importMap.textContent || '{}').imports?.three
          : null;
        if (threeUrl) {
          THREE = await import(/* @vite-ignore */ threeUrl);
        }
      } catch {
        THREE = null;
      }
      if (!THREE || disposed) return;

      try {
        const width = Math.max(320, window.innerWidth);
        const height = Math.max(240, window.innerHeight);
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 60);
        camera.position.set(0, 0, 9);

        // Soft glowing particle sprite texture
        const dotCanvas = document.createElement('canvas');
        dotCanvas.width = 64;
        dotCanvas.height = 64;
        const dctx = dotCanvas.getContext('2d');
        const dGrad = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        if (winner === 'opp') {
          dGrad.addColorStop(0, 'rgba(255, 220, 230, 1)');
          dGrad.addColorStop(0.35, 'rgba(255, 58, 92, 0.78)');
          dGrad.addColorStop(0.72, 'rgba(42, 130, 255, 0.28)');
          dGrad.addColorStop(1, 'rgba(10, 24, 64, 0)');
        } else {
          dGrad.addColorStop(0, 'rgba(255, 255, 240, 1)');
          dGrad.addColorStop(0.38, 'rgba(255, 212, 92, 0.85)');
          dGrad.addColorStop(1, 'rgba(255, 160, 32, 0)');
        }
        dctx.fillStyle = dGrad;
        dctx.fillRect(0, 0, 64, 64);
        const dotTex = new THREE.CanvasTexture(dotCanvas);
        disposables.push(dotTex);

        // Void rift shockwave ring at t = 0..0.75s
        const ringGeom = new THREE.RingGeometry(0.65, 1.05, 48);
        disposables.push(ringGeom);
        const ringMat = new THREE.MeshBasicMaterial({
          color: winner === 'opp' ? 0xff2e54 : 0xffcf58,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        disposables.push(ringMat);
        const riftRing = new THREE.Mesh(ringGeom, ringMat);
        scene.add(riftRing);

        // 52 floating 3D energy motes
        const motes = Array.from({ length: 52 }, (_, i) => {
          const mat = new THREE.SpriteMaterial({
            map: dotTex,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          });
          disposables.push(mat);
          const sprite = new THREE.Sprite(mat);
          const baseScale = 0.1 + (i % 5) * 0.048;
          sprite.scale.set(baseScale, baseScale, 1);
          const spreadX = ((i * 73) % 100 / 100 - 0.5) * 11;
          const spreadY = ((i * 41) % 100 / 100 - 0.5) * 6.5;
          const spreadZ = ((i * 29) % 100 / 100 - 0.5) * 3;
          sprite.position.set(spreadX, spreadY, spreadZ);
          scene.add(sprite);
          return {
            sprite,
            mat,
            baseX: spreadX,
            baseY: spreadY,
            speedY: (winner === 'opp' ? 0.22 : 0.42) + (i % 4) * 0.12,
            swayPhase: i * 1.1,
            baseScale
          };
        });

        const onResize = () => {
          if (!renderer || disposed) return;
          const w = Math.max(320, window.innerWidth);
          const h = Math.max(240, window.innerHeight);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        };
        window.addEventListener('resize', onResize);
        removeResize = () => window.removeEventListener('resize', onResize);

        const start = performance.now();
        const animate = (now) => {
          if (disposed) return;
          const elapsed = (now - start) / 1000;

          if (elapsed < 0.78) {
            const rt = elapsed / 0.78;
            const eased = 1 - (1 - rt) ** 3;
            riftRing.scale.set(0.3 + eased * 6.2, 0.14 + eased * 3.6, 1);
            ringMat.opacity = Math.max(0, (1 - rt) * 0.88);
          } else {
            riftRing.visible = false;
          }

          const fadeIn = Math.min(1, elapsed / 0.6);
          motes.forEach((m, idx) => {
            const ySpan = 7.2;
            const yOffset = ((elapsed * m.speedY) % ySpan);
            let y = m.baseY + yOffset;
            if (y > 3.6) y -= ySpan;
            const x = m.baseX + Math.sin(elapsed * 1.4 + m.swayPhase) * 0.35;
            m.sprite.position.x = x;
            m.sprite.position.y = y;
            const twinkle = 0.45 + 0.55 * Math.sin(elapsed * 3.1 + idx);
            m.mat.opacity = fadeIn * twinkle * 0.78;
          });

          renderer.render(scene, camera);
          rafId = window.requestAnimationFrame(animate);
        };
        rafId = window.requestAnimationFrame(animate);
      } catch {
        // graceful no-op if WebGL fails; 2D Canvas modal renders independently
      }
    })();

    return () => {
      disposed = true;
      removeResize?.();
      if (rafId) window.cancelAnimationFrame(rafId);
      disposables.forEach((item) => item?.dispose?.());
      renderer?.dispose?.();
    };
  }, [open, winner]);

  // High-DPI 2D Canvas Modal Frame, Rift Materialization & Live 60fps Idle Animation
  useEffect(() => {
    if (!open) return undefined;
    const canvas = uiCanvasRef.current;
    if (!canvas) return undefined;

    let rafId = 0;
    const startTime = performance.now();

    const render = (now) => {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scaleX = (cssW / LOGICAL_W) * dpr;
      const scaleY = (cssH / LOGICAL_H) * dpr;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      const elapsedMs = now - startTime;
      const elapsedSec = elapsedMs / 1000;
      const introT = clamp01(elapsedMs / INTRO_DURATION_MS);

      // Stage 1: Dimensional void slit burst at center (0 -> 0.42)
      if (introT < 0.45) {
        const riftP = introT / 0.45;
        const riftAlpha = riftP < 0.35 ? riftP / 0.35 : 1 - (riftP - 0.35) / 0.65;
        const slitHalfW = 430 * easeOutCubic(Math.min(1, riftP * 1.4));
        const slitHalfH = 26 * (1 - riftP * 0.6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const rGrad = ctx.createRadialGradient(
          LOGICAL_W / 2, LOGICAL_H / 2, 2,
          LOGICAL_W / 2, LOGICAL_H / 2, Math.max(20, slitHalfW)
        );
        if (winner === 'opp') {
          rGrad.addColorStop(0, `rgba(255, 235, 242, ${0.95 * riftAlpha})`);
          rGrad.addColorStop(0.35, `rgba(255, 48, 86, ${0.78 * riftAlpha})`);
          rGrad.addColorStop(0.7, `rgba(42, 132, 255, ${0.42 * riftAlpha})`);
          rGrad.addColorStop(1, 'rgba(10, 24, 68, 0)');
        } else {
          rGrad.addColorStop(0, `rgba(255, 255, 240, ${0.98 * riftAlpha})`);
          rGrad.addColorStop(0.38, `rgba(255, 210, 82, ${0.82 * riftAlpha})`);
          rGrad.addColorStop(1, 'rgba(255, 148, 24, 0)');
        }
        ctx.fillStyle = rGrad;
        ctx.beginPath();
        ctx.ellipse(LOGICAL_W / 2, LOGICAL_H / 2, slitHalfW, Math.max(4, slitHalfH), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Stage 2: Unfold modal out of the void rift
      const frameUnfold = clamp01((introT - 0.06) / 0.56);
      if (frameUnfold > 0) {
        const sx = 0.42 + 0.58 * easeOutBack(frameUnfold);
        const sy = 0.08 + 0.92 * easeOutBack(frameUnfold);
        ctx.save();
        ctx.translate(LOGICAL_W / 2, LOGICAL_H / 2);
        ctx.scale(sx, sy);
        ctx.translate(-LOGICAL_W / 2, -LOGICAL_H / 2);
        ctx.globalAlpha = clamp01(frameUnfold * 1.8);

        if (isWin) {
          drawWinFrameAndScene(ctx, elapsedSec, introT, lpText, hoveredBtnRef.current, titleText);
        } else {
          drawLoseFrameAndScene(ctx, elapsedSec, introT, lpText, hoveredBtnRef.current);
        }
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [open, isWin, winner, lpText, titleText]);

  if (!open) return null;

  const btnTopPct = isWin ? (58 + 334 - 37) / LOGICAL_H * 100 : (58 + 324 - 37) / LOGICAL_H * 100;
  const btnHeightPct = (74 / LOGICAL_H) * 100;
  const btnWidthPct = (294 / LOGICAL_W) * 100;
  const rematchLeftPct = ((LOGICAL_W / 2 - 166 - 147) / LOGICAL_W) * 100;
  const exitLeftPct = ((LOGICAL_W / 2 + 166 - 147) / LOGICAL_W) * 100;

  return createPortal(
    <div
      className="result is-open duel-result-v2"
      data-js="result"
      role="dialog"
      aria-modal="true"
      aria-label={titleText}
    >
      <canvas ref={threeCanvasRef} className="duel-result-v2__three" aria-hidden="true" />
      <div className="duel-result-v2__stage">
        <canvas ref={uiCanvasRef} className="duel-result-v2__canvas" aria-hidden="true" />
        <span className="duel-result-v2__sr" data-js="result-title">{titleText}</span>
        <span className="duel-result-v2__sr" data-js="result-lp">{lpText}</span>
        <button
          type="button"
          className="duel-result-v2__hit"
          data-js="btn-rematch"
          aria-label="Đấu lại"
          style={{
            left: `${rematchLeftPct}%`,
            top: `${btnTopPct}%`,
            width: `${btnWidthPct}%`,
            height: `${btnHeightPct}%`
          }}
          onMouseEnter={() => setHoveredBtn('rematch')}
          onMouseLeave={() => setHoveredBtn((prev) => (prev === 'rematch' ? null : prev))}
          onFocus={() => setHoveredBtn('rematch')}
          onBlur={() => setHoveredBtn((prev) => (prev === 'rematch' ? null : prev))}
          onClick={onRematch}
        >
          <span className="duel-result-v2__sr">Đấu lại</span>
        </button>
        <button
          type="button"
          className="duel-result-v2__hit"
          data-js="btn-exit"
          aria-label="Về sảnh"
          style={{
            left: `${exitLeftPct}%`,
            top: `${btnTopPct}%`,
            width: `${btnWidthPct}%`,
            height: `${btnHeightPct}%`
          }}
          onMouseEnter={() => setHoveredBtn('exit')}
          onMouseLeave={() => setHoveredBtn((prev) => (prev === 'exit' ? null : prev))}
          onFocus={() => setHoveredBtn('exit')}
          onBlur={() => setHoveredBtn((prev) => (prev === 'exit' ? null : prev))}
          onClick={onExit}
        >
          <span className="duel-result-v2__sr">Về sảnh</span>
        </button>
      </div>
    </div>,
    document.body
  );
}
