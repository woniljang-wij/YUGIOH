import React, { useEffect, useRef } from 'react';

function traceMonsterFramePath(ctx, x, y, w, h, cut, apexW, apexH) {
  const cx = x + w / 2;
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(cx - apexW, y);
  ctx.lineTo(cx, y - apexH);
  ctx.lineTo(cx + apexW, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(cx + apexW, y + h);
  ctx.lineTo(cx, y + h + apexH);
  ctx.lineTo(cx - apexW, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function drawFourPointDiamond(ctx, cx, cy, rx, ry, glowColor = '#4de1ff') {
  ctx.save();
  const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry) * 2.4);
  aura.addColorStop(0, 'rgba(130, 238, 255, 0.72)');
  aura.addColorStop(0.45, 'rgba(56, 189, 248, 0.25)');
  aura.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(rx, ry) * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Outer gold/silver bezel
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry * 1.18);
  ctx.lineTo(cx + rx * 1.18, cy);
  ctx.lineTo(cx, cy + ry * 1.18);
  ctx.lineTo(cx - rx * 1.18, cy);
  ctx.closePath();
  const bezelGrad = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  bezelGrad.addColorStop(0, '#fff2bd');
  bezelGrad.addColorStop(0.5, '#d6a54a');
  bezelGrad.addColorStop(1, '#7c5316');
  ctx.fillStyle = bezelGrad;
  ctx.fill();

  // Inner glowing cyan crystal
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry * 0.88);
  ctx.lineTo(cx + rx * 0.88, cy);
  ctx.lineTo(cx, cy + ry * 0.88);
  ctx.lineTo(cx - rx * 0.88, cy);
  ctx.closePath();
  const gemGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  gemGrad.addColorStop(0, '#ffffff');
  gemGrad.addColorStop(0.45, '#9bf0ff');
  gemGrad.addColorStop(1, '#1b9ce8');
  ctx.fillStyle = gemGrad;
  ctx.fill();
  ctx.restore();
}

function drawGoldCornerBracket(ctx, x, y, w, h, corner, inset, armLen, thickness) {
  ctx.save();
  // Mirror/flip around corner to draw identical ornate curved gold bracket
  const sx = corner.includes('right') ? -1 : 1;
  const sy = corner.includes('bottom') ? -1 : 1;
  const ox = corner.includes('right') ? x + w - inset : x + inset;
  const oy = corner.includes('bottom') ? y + h - inset : y + inset;

  ctx.translate(ox, oy);
  ctx.scale(sx, sy);

  const grad = ctx.createLinearGradient(0, 0, armLen, armLen);
  grad.addColorStop(0, '#fff4c4');
  grad.addColorStop(0.28, '#ecc167');
  grad.addColorStop(0.65, '#a87424');
  grad.addColorStop(1, '#f8dc92');

  ctx.beginPath();
  ctx.moveTo(0, armLen);
  ctx.lineTo(0, thickness * 1.15);
  ctx.lineTo(thickness * 1.15, 0);
  ctx.lineTo(armLen, 0);
  ctx.quadraticCurveTo(armLen * 0.56, thickness * 0.35, thickness * 1.55, thickness * 1.55);
  ctx.quadraticCurveTo(thickness * 0.35, armLen * 0.56, 0, armLen);
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 0.85;
  ctx.strokeStyle = 'rgba(255, 245, 200, 0.72)';
  ctx.stroke();

  // Inner dark-amber edge shadow for metallic depth
  ctx.beginPath();
  ctx.moveTo(armLen * 0.92, thickness * 0.22);
  ctx.quadraticCurveTo(armLen * 0.5, thickness * 0.45, thickness * 1.55, thickness * 1.55);
  ctx.quadraticCurveTo(thickness * 0.45, armLen * 0.5, thickness * 0.22, armLen * 0.92);
  ctx.strokeStyle = 'rgba(72, 42, 8, 0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawMonsterZoneCanvas(canvas, { occupied, hovered, attackTarget }) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padX = 5;
  const padY = 6;
  const x = padX;
  const y = padY;
  const w = Math.max(16, width - padX * 2);
  const h = Math.max(16, height - padY * 2);
  const cut = Math.min(w, h) * 0.12;
  const apexW = Math.min(w * 0.14, 15);
  const apexH = Math.min(h * 0.045, 4);

  // 1. Interior dark-blue translucent base + diagonal cyan sheen
  ctx.save();
  traceMonsterFramePath(ctx, x, y, w, h, cut, apexW, apexH);
  const bgGrad = ctx.createLinearGradient(x, y, x, y + h);
  bgGrad.addColorStop(0, 'rgba(5, 22, 52, 0.78)');
  bgGrad.addColorStop(0.55, 'rgba(6, 30, 68, 0.62)');
  bgGrad.addColorStop(1, 'rgba(4, 24, 58, 0.76)');
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.clip();

  // Subtle V-shaped bottom-up cyan energy glow inside the zone
  const beamLeft = ctx.createRadialGradient(x + w * 0.25, y + h * 0.96, 1, x + w * 0.28, y + h * 0.85, w * 0.68);
  beamLeft.addColorStop(0, 'rgba(68, 196, 255, 0.26)');
  beamLeft.addColorStop(0.55, 'rgba(38, 146, 232, 0.09)');
  beamLeft.addColorStop(1, 'rgba(10, 48, 108, 0)');
  ctx.fillStyle = beamLeft;
  ctx.fillRect(x, y, w, h);

  const beamRight = ctx.createRadialGradient(x + w * 0.75, y + h * 0.96, 1, x + w * 0.72, y + h * 0.85, w * 0.68);
  beamRight.addColorStop(0, 'rgba(68, 196, 255, 0.24)');
  beamRight.addColorStop(0.55, 'rgba(38, 146, 232, 0.08)');
  beamRight.addColorStop(1, 'rgba(10, 48, 108, 0)');
  ctx.fillStyle = beamRight;
  ctx.fillRect(x, y, w, h);

  // Faint center magic reticle when empty
  if (!occupied) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r1 = Math.min(w, h) * 0.21;
    const r2 = Math.min(w, h) * 0.31;

    ctx.strokeStyle = 'rgba(135, 208, 255, 0.14)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(135, 208, 255, 0.09)';
    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle crosshair hairlines
    ctx.beginPath();
    ctx.moveTo(cx - r2 * 1.15, cy);
    ctx.lineTo(cx + r2 * 1.15, cy);
    ctx.moveTo(cx, cy - r2 * 1.15);
    ctx.lineTo(cx, cy + r2 * 1.15);
    ctx.stroke();

    // Crisp 4-point center star
    const starR = Math.max(5.5, Math.min(w, h) * 0.085);
    const starInner = starR * 0.24;
    ctx.beginPath();
    ctx.moveTo(cx, cy - starR);
    ctx.lineTo(cx + starInner, cy - starInner);
    ctx.lineTo(cx + starR, cy);
    ctx.lineTo(cx + starInner, cy + starInner);
    ctx.lineTo(cx, cy + starR);
    ctx.lineTo(cx - starInner, cy + starInner);
    ctx.lineTo(cx - starR, cy);
    ctx.lineTo(cx - starInner, cy - starInner);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(204, 240, 255, 0.56)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = 'rgba(215, 245, 255, 0.22)';
    ctx.fill();
  }
  ctx.restore();

  // 2. Outer metallic silver-blue double frame
  ctx.save();
  traceMonsterFramePath(ctx, x, y, w, h, cut, apexW, apexH);
  ctx.strokeStyle = hovered
    ? 'rgba(255, 224, 130, 0.95)'
    : attackTarget
      ? 'rgba(255, 112, 138, 0.95)'
      : 'rgba(24, 72, 128, 0.95)';
  ctx.lineWidth = 3.2;
  ctx.stroke();

  const rimGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  rimGrad.addColorStop(0, '#c8eeff');
  rimGrad.addColorStop(0.25, '#59b2e8');
  rimGrad.addColorStop(0.5, '#eaf8ff');
  rimGrad.addColorStop(0.75, '#4da4de');
  rimGrad.addColorStop(1, '#b8e8ff');
  ctx.strokeStyle = hovered ? '#ffe394' : rimGrad;
  ctx.lineWidth = 1.45;
  ctx.stroke();

  // Inner crisp secondary bevel
  const inset = 3.2;
  traceMonsterFramePath(
    ctx,
    x + inset,
    y + inset,
    w - inset * 2,
    h - inset * 2,
    Math.max(4, cut - 1.8),
    Math.max(6, apexW - 2),
    Math.max(1.5, apexH - 1)
  );
  ctx.strokeStyle = 'rgba(170, 228, 255, 0.58)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();

  // 3. 4 ornate gold corner brackets
  const armLen = Math.min(w, h) * 0.27;
  const thickness = Math.max(3.5, Math.min(w, h) * 0.052);
  const cornerInset = 4.2;
  drawGoldCornerBracket(ctx, x, y, w, h, 'top-left', cornerInset, armLen, thickness);
  drawGoldCornerBracket(ctx, x, y, w, h, 'top-right', cornerInset, armLen, thickness);
  drawGoldCornerBracket(ctx, x, y, w, h, 'bottom-left', cornerInset, armLen, thickness);
  drawGoldCornerBracket(ctx, x, y, w, h, 'bottom-right', cornerInset, armLen, thickness);

  // 4. Glowing cyan neon vertical side streaks
  ctx.save();
  const barLen = h * 0.46;
  const barTop = y + (h - barLen) / 2;
  [x, x + w].forEach((edgeX) => {
    const streakGrad = ctx.createLinearGradient(edgeX, barTop, edgeX, barTop + barLen);
    streakGrad.addColorStop(0, 'rgba(77, 225, 255, 0)');
    streakGrad.addColorStop(0.22, 'rgba(120, 236, 255, 0.85)');
    streakGrad.addColorStop(0.5, '#ffffff');
    streakGrad.addColorStop(0.78, 'rgba(120, 236, 255, 0.85)');
    streakGrad.addColorStop(1, 'rgba(77, 225, 255, 0)');
    ctx.shadowColor = '#38d2ff';
    ctx.shadowBlur = 9;
    ctx.strokeStyle = streakGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(edgeX, barTop);
    ctx.lineTo(edgeX, barTop + barLen);
    ctx.stroke();
  });
  ctx.restore();

  // 5. Top-center & bottom-center cyan 4-point diamond gems
  const gemRx = Math.max(4.5, Math.min(w * 0.058, 6.2));
  const gemRy = Math.max(5.5, Math.min(h * 0.08, 7.2));
  drawFourPointDiamond(ctx, x + w / 2, y - apexH + 0.5, gemRx, gemRy);
  drawFourPointDiamond(ctx, x + w / 2, y + h + apexH - 0.5, gemRx, gemRy);
}

function drawExCapsule(ctx, cx, cy, boxW, boxH, variant) {
  const halfW = boxW / 2;
  const halfH = boxH / 2;
  const point = Math.min(halfH * 0.85, 11);

  const tracePill = (expand = 0) => {
    const hw = halfW + expand;
    const hh = halfH + expand;
    const pt = point + expand * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - hw + pt, cy - hh);
    ctx.lineTo(cx + hw - pt, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw - pt, cy + hh);
    ctx.lineTo(cx - hw + pt, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  };

  ctx.save();
  // Outer shadow + gold rim
  ctx.shadowColor = variant === 'red' ? 'rgba(255, 58, 116, 0.48)' : 'rgba(42, 168, 255, 0.52)';
  ctx.shadowBlur = 12;
  tracePill(1.6);
  const goldGrad = ctx.createLinearGradient(cx - halfW, cy - halfH, cx + halfW, cy + halfH);
  goldGrad.addColorStop(0, '#fff3bf');
  goldGrad.addColorStop(0.35, '#dfae52');
  goldGrad.addColorStop(0.7, '#99671e');
  goldGrad.addColorStop(1, '#fbe098');
  ctx.fillStyle = goldGrad;
  ctx.fill();
  ctx.restore();

  // Inner capsule fill
  ctx.save();
  tracePill(-0.5);
  const fillGrad = ctx.createLinearGradient(cx, cy - halfH, cx, cy + halfH);
  if (variant === 'red') {
    fillGrad.addColorStop(0, '#a31849');
    fillGrad.addColorStop(0.5, '#760e34');
    fillGrad.addColorStop(1, '#44061e');
  } else {
    fillGrad.addColorStop(0, '#1062ad');
    fillGrad.addColorStop(0.5, '#093c74');
    fillGrad.addColorStop(1, '#041f46');
  }
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Subtle top glossy highlight inside pill
  ctx.strokeStyle = variant === 'red' ? 'rgba(255, 160, 195, 0.35)' : 'rgba(130, 215, 255, 0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Small gold wing tips on left & right of each EX capsule
  const wingLen = 10;
  [cx - halfW - 1, cx + halfW + 1].forEach((tipX, idx) => {
    const dir = idx === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(tipX, cy - 3.5);
    ctx.lineTo(tipX + dir * wingLen, cy);
    ctx.lineTo(tipX, cy + 3.5);
    ctx.closePath();
    ctx.fillStyle = '#e7bd65';
    ctx.fill();
  });

  // Crisp "E X" text
  ctx.fillStyle = '#f4fbff';
  ctx.font = `900 ${Math.round(boxH * 0.48)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 4;
  ctx.fillText('E  X', cx, cy + 0.8);
  ctx.restore();
}

function drawMidlineDividerCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Align divider geometry to the actual 5 monster zones on the board when present
  const boardEl = canvas.closest('.board');
  const monZones = boardEl?.querySelectorAll('.side--me .row--mon > .zone--mon');
  let cx = width / 2;
  let lineLeft = Math.max(14, width * 0.08);
  let lineRight = Math.min(width - 14, width * 0.92);
  let redExCx = cx - Math.max(100, width * 0.16);
  let blueExCx = cx + Math.max(100, width * 0.16);
  let boxW = Math.min(Math.max(88, width * 0.14), 132);

  if (monZones && monZones.length === 5) {
    const z0 = monZones[0].getBoundingClientRect();
    const z1 = monZones[1].getBoundingClientRect();
    const z2 = monZones[2].getBoundingClientRect();
    const z3 = monZones[3].getBoundingClientRect();
    const z4 = monZones[4].getBoundingClientRect();
    if (z2.width > 0 && z0.width > 0 && z4.width > 0) {
      cx = (z2.left + z2.width / 2) - rect.left;
      lineLeft = Math.max(8, z0.left - rect.left - 24);
      lineRight = Math.min(width - 8, z4.right - rect.left + 24);
      boxW = Math.min(Math.max(84, z2.width * 0.92), 132);
      redExCx = (z2.left - rect.left) - boxW / 2 - 6;
      blueExCx = (z2.right - rect.left) + boxW / 2 + 6;
    }
  }

  const cy = height / 2;

  // Crisp thin metallic silver-gold divider line (matching the reference image)
  ctx.save();
  const lineGrad = ctx.createLinearGradient(lineLeft, cy, lineRight, cy);
  lineGrad.addColorStop(0, 'rgba(218, 184, 112, 0)');
  lineGrad.addColorStop(0.08, 'rgba(224, 192, 120, 0.82)');
  lineGrad.addColorStop(0.28, 'rgba(182, 224, 248, 0.9)');
  lineGrad.addColorStop(0.5, '#ffffff');
  lineGrad.addColorStop(0.72, 'rgba(182, 224, 248, 0.9)');
  lineGrad.addColorStop(0.92, 'rgba(224, 192, 120, 0.82)');
  lineGrad.addColorStop(1, 'rgba(218, 184, 112, 0)');

  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(lineLeft, cy);
  ctx.lineTo(lineRight, cy);
  ctx.stroke();

  // Subtle small diamond finials at left & right ends
  [lineLeft + 10, lineRight - 10].forEach((tipX) => {
    ctx.beginPath();
    ctx.moveTo(tipX, cy - 2.6);
    ctx.lineTo(tipX + 4, cy);
    ctx.lineTo(tipX, cy + 2.6);
    ctx.lineTo(tipX - 4, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(235, 206, 134, 0.85)';
    ctx.fill();
  });
  ctx.restore();

  // Two EX capsules aligned symmetrically around the center monster zone
  const boxH = Math.min(Math.max(20, height * 0.56), 24);
  drawExCapsule(ctx, redExCx, cy, boxW, boxH, 'red');
  drawExCapsule(ctx, blueExCx, cy, boxW, boxH, 'blue');

  // Center glowing cyan diamond emblem in gold bezel
  drawFourPointDiamond(ctx, cx, cy, 10.5, 12.5);
}

export function MonsterZoneFrame({ occupied = false, hovered = false, attackTarget = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => drawMonsterZoneCanvas(canvas, { occupied, hovered, attackTarget });
    draw();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [occupied, hovered, attackTarget]);

  return (
    <canvas
      ref={canvasRef}
      className="zone-mon-canvas"
      aria-hidden="true"
    />
  );
}

export function MidlineExDivider() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => drawMidlineDividerCanvas(canvas);
    draw();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="midline-ex-canvas"
      aria-hidden="true"
    />
  );
}
