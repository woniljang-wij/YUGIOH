import { useEffect, useRef } from 'react';

const colors = {
  screen: {
    cyan: 'rgba(113, 190, 255, 0.38)',
    gold: 'rgba(243, 211, 126, 0.28)'
  },
  pvp: {
    accent: 'rgba(243, 211, 126, 0.82)',
    bright: 'rgba(255, 238, 190, 0.72)',
    muted: 'rgba(211, 183, 132, 0.14)'
  },
  ai: {
    accent: 'rgba(163, 234, 255, 0.86)',
    bright: 'rgba(215, 247, 255, 0.72)',
    muted: 'rgba(117, 207, 255, 0.14)'
  }
};

function strokeDiamond(context, x, y, radius, color) {
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x + radius, y);
  context.lineTo(x, y + radius);
  context.lineTo(x - radius, y);
  context.closePath();
  context.strokeStyle = color;
  context.stroke();
}

function drawScreen(context, width, height) {
  const inset = Math.min(20, Math.max(10, width * 0.018));
  const corner = Math.min(48, Math.max(22, width * 0.055));
  context.lineWidth = 1;
  context.strokeStyle = colors.screen.cyan;
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  context.strokeStyle = colors.screen.gold;
  context.strokeRect(inset + 5, inset + 5, width - (inset + 5) * 2, height - (inset + 5) * 2);

  const corners = [
    [inset + 9, inset + 9, 1, 1],
    [width - inset - 9, inset + 9, -1, 1],
    [inset + 9, height - inset - 9, 1, -1],
    [width - inset - 9, height - inset - 9, -1, -1]
  ];
  corners.forEach(([x, y, dx, dy]) => {
    context.beginPath();
    context.moveTo(x + corner * dx, y);
    context.lineTo(x, y);
    context.lineTo(x, y + corner * dy);
    context.strokeStyle = colors.screen.cyan;
    context.stroke();
    strokeDiamond(context, x + corner * dx * 0.78, y + corner * dy * 0.78, 2.5, colors.screen.gold);
  });

  const sealX = width / 2;
  const sealY = height * 0.56;
  const radius = Math.min(width * 0.24, height * 0.36);
  context.save();
  context.strokeStyle = 'rgba(123, 184, 255, 0.07)';
  context.lineWidth = 1;
  [0.58, 0.76, 1].forEach((scale) => {
    context.beginPath();
    context.arc(sealX, sealY, radius * scale, 0, Math.PI * 2);
    context.stroke();
  });
  for (let mark = 0; mark < 24; mark += 1) {
    const angle = (mark / 24) * Math.PI * 2;
    const inner = radius * 0.91;
    const outer = radius * (mark % 3 === 0 ? 1 : 0.96);
    context.beginPath();
    context.moveTo(sealX + Math.cos(angle) * inner, sealY + Math.sin(angle) * inner);
    context.lineTo(sealX + Math.cos(angle) * outer, sealY + Math.sin(angle) * outer);
    context.stroke();
  }
  strokeDiamond(context, sealX, sealY, radius * 0.25, 'rgba(243, 211, 126, 0.08)');
  context.restore();

  const topRuleY = Math.max(72, height * 0.12);
  context.beginPath();
  context.moveTo(inset + corner, topRuleY);
  context.lineTo(width / 2 - 150, topRuleY);
  context.moveTo(width / 2 + 150, topRuleY);
  context.lineTo(width - inset - corner, topRuleY);
  context.strokeStyle = 'rgba(163, 205, 255, 0.12)';
  context.stroke();
}

function drawPanel(context, width, height, palette) {
  const inset = Math.max(7, Math.min(13, width * 0.025));
  const cut = Math.min(26, Math.max(12, width * 0.045));
  const x = inset;
  const y = inset;
  const right = width - inset;
  const bottom = height - inset;
  const frame = [
    [x + cut, y], [right - cut, y], [right, y + cut],
    [right, bottom - cut], [right - cut, bottom], [x + cut, bottom],
    [x, bottom - cut], [x, y + cut], [x + cut, y]
  ];

  context.save();
  context.beginPath();
  context.moveTo(frame[0][0], frame[0][1]);
  frame.slice(1).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY));
  context.strokeStyle = palette.accent;
  context.lineWidth = 1.15;
  context.stroke();

  const inner = inset + 5;
  const innerCut = Math.max(8, cut - 5);
  context.beginPath();
  context.moveTo(inner + innerCut, inner);
  context.lineTo(width - inner - innerCut, inner);
  context.lineTo(width - inner, inner + innerCut);
  context.lineTo(width - inner, height - inner - innerCut);
  context.lineTo(width - inner - innerCut, height - inner);
  context.lineTo(inner + innerCut, height - inner);
  context.lineTo(inner, height - inner - innerCut);
  context.lineTo(inner, inner + innerCut);
  context.closePath();
  context.strokeStyle = palette.muted;
  context.lineWidth = 1;
  context.stroke();

  const corners = [
    [x + 5, y + 5, 1, 1],
    [right - 5, y + 5, -1, 1],
    [x + 5, bottom - 5, 1, -1],
    [right - 5, bottom - 5, -1, -1]
  ];
  corners.forEach(([cornerX, cornerY, dx, dy]) => {
    const arm = Math.min(28, Math.max(14, width * 0.05));
    context.beginPath();
    context.moveTo(cornerX + arm * dx, cornerY);
    context.lineTo(cornerX, cornerY);
    context.lineTo(cornerX, cornerY + arm * dy);
    context.strokeStyle = palette.bright;
    context.lineWidth = 1;
    context.stroke();
    strokeDiamond(context, cornerX + arm * dx * 0.72, cornerY + arm * dy * 0.72, 2.2, palette.accent);
  });

  const sealX = width / 2;
  const sealY = height * 0.48;
  const radius = Math.min(width * 0.22, height * 0.25);
  context.strokeStyle = palette.muted;
  context.lineWidth = 1;
  [0.68, 1].forEach((scale) => {
    context.beginPath();
    context.arc(sealX, sealY, radius * scale, 0, Math.PI * 2);
    context.stroke();
  });
  for (let mark = 0; mark < 16; mark += 1) {
    const angle = (mark / 16) * Math.PI * 2;
    context.beginPath();
    context.moveTo(sealX + Math.cos(angle) * radius * 0.88, sealY + Math.sin(angle) * radius * 0.88);
    context.lineTo(sealX + Math.cos(angle) * radius, sealY + Math.sin(angle) * radius);
    context.stroke();
  }
  strokeDiamond(context, sealX, sealY, radius * 0.3, palette.muted);

  context.beginPath();
  context.moveTo(width * 0.34, y + 1);
  context.lineTo(width * 0.46, y + 1);
  context.moveTo(width * 0.54, y + 1);
  context.lineTo(width * 0.66, y + 1);
  context.strokeStyle = palette.accent;
  context.stroke();
  strokeDiamond(context, sealX, y + 1, 4, palette.bright);
  context.restore();
}

function drawPerson(context, x, y, color, size = 1) {
  context.beginPath();
  context.arc(x, y, 5.2 * size, Math.PI, Math.PI * 2);
  context.lineTo(x + 5.2 * size, y + 4 * size);
  context.arc(x, y + 4 * size, 5.2 * size, 0, Math.PI);
  context.strokeStyle = color;
  context.stroke();

  context.beginPath();
  context.moveTo(x - 11 * size, y + 30 * size);
  context.quadraticCurveTo(x - 10 * size, y + 14 * size, x, y + 13 * size);
  context.quadraticCurveTo(x + 10 * size, y + 14 * size, x + 11 * size, y + 30 * size);
  context.stroke();
}

function drawModeIcon(context, width, height, ai) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.46;
  const palette = ai ? colors.ai : colors.pvp;

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = palette.muted;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.84, 0, Math.PI * 2);
  context.stroke();

  for (let mark = 0; mark < 16; mark += 1) {
    const angle = (mark / 16) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centerX + Math.cos(angle) * radius * 0.9, centerY + Math.sin(angle) * radius * 0.9);
    context.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    context.strokeStyle = palette.accent;
    context.stroke();
  }

  const iconScale = Math.min(width / 112, height / 68);
  drawPerson(context, centerX - 20 * iconScale, centerY - 16 * iconScale, palette.bright, iconScale);
  if (ai) {
    const boxX = centerX + 16 * iconScale;
    const boxY = centerY - 25 * iconScale;
    const boxSize = 23 * iconScale;
    context.strokeStyle = palette.bright;
    context.strokeRect(boxX, boxY, boxSize, boxSize * 0.82);
    context.beginPath();
    context.moveTo(boxX + boxSize * 0.28, boxY + boxSize * 0.32);
    context.lineTo(boxX + boxSize * 0.34, boxY + boxSize * 0.32);
    context.moveTo(boxX + boxSize * 0.66, boxY + boxSize * 0.32);
    context.lineTo(boxX + boxSize * 0.72, boxY + boxSize * 0.32);
    context.moveTo(boxX + boxSize * 0.3, boxY + boxSize * 0.58);
    context.lineTo(boxX + boxSize * 0.7, boxY + boxSize * 0.58);
    context.stroke();
  } else {
    drawPerson(context, centerX + 20 * iconScale, centerY - 16 * iconScale, palette.bright, iconScale);
  }

  strokeDiamond(context, centerX, centerY + 1, 6 * iconScale, palette.accent);
  context.restore();
}

function drawSeal(context, x, y, radius, accent, muted) {
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = muted;
  [0.66, 0.84, 1].forEach((scale) => {
    context.beginPath();
    context.arc(x, y, radius * scale, 0, Math.PI * 2);
    context.stroke();
  });
  for (let mark = 0; mark < 24; mark += 1) {
    const angle = (mark / 24) * Math.PI * 2;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * radius * 0.9, y + Math.sin(angle) * radius * 0.9);
    context.lineTo(x + Math.cos(angle) * radius * (mark % 3 === 0 ? 1 : 0.96), y + Math.sin(angle) * radius * (mark % 3 === 0 ? 1 : 0.96));
    context.stroke();
  }
  context.beginPath();
  for (let side = 0; side < 6; side += 1) {
    const angle = (side / 6) * Math.PI * 2 - Math.PI / 2;
    const pointX = x + Math.cos(angle) * radius * 0.46;
    const pointY = y + Math.sin(angle) * radius * 0.46;
    if (side === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.strokeStyle = accent;
  context.stroke();
  strokeDiamond(context, x, y, radius * 0.18, muted);
  context.restore();
}

function drawArenaStage(context, width, height) {
  const playerX = width * 0.27;
  const cpuX = width * 0.73;
  const sealY = height * 0.53;
  const radius = Math.min(width * 0.105, height * 0.22);

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(163, 234, 255, 0.18)';
  context.beginPath();
  context.moveTo(width * 0.12, height * 0.18);
  context.lineTo(width * 0.35, height * 0.18);
  context.lineTo(width * 0.41, height * 0.23);
  context.moveTo(width * 0.59, height * 0.23);
  context.lineTo(width * 0.65, height * 0.18);
  context.lineTo(width * 0.88, height * 0.18);
  context.moveTo(width * 0.08, height * 0.83);
  context.lineTo(width * 0.42, height * 0.83);
  context.moveTo(width * 0.58, height * 0.83);
  context.lineTo(width * 0.92, height * 0.83);
  context.stroke();

  drawSeal(
    context,
    playerX,
    sealY,
    radius,
    'rgba(255, 218, 132, 0.28)',
    'rgba(255, 218, 132, 0.16)'
  );
  drawSeal(
    context,
    cpuX,
    sealY,
    radius,
    'rgba(163, 234, 255, 0.34)',
    'rgba(117, 207, 255, 0.19)'
  );
  drawSeal(
    context,
    width / 2,
    height * 0.51,
    Math.min(width * 0.07, height * 0.16),
    'rgba(255, 228, 158, 0.38)',
    'rgba(163, 234, 255, 0.13)'
  );

  context.setLineDash([4, 8]);
  context.beginPath();
  context.moveTo(playerX + radius, sealY);
  context.lineTo(width * 0.44, sealY);
  context.moveTo(width * 0.56, sealY);
  context.lineTo(cpuX - radius, sealY);
  context.strokeStyle = 'rgba(163, 234, 255, 0.24)';
  context.stroke();
  context.setLineDash([]);

  [playerX, cpuX].forEach((x, index) => {
    context.beginPath();
    context.arc(x, height * 0.87, 2.5, 0, Math.PI * 2);
    context.fillStyle = index ? 'rgba(163, 234, 255, 0.68)' : 'rgba(255, 218, 132, 0.72)';
    context.fill();
  });
  context.restore();
}

function drawPortrait(context, width, height, isCpu) {
  const centerX = width / 2;
  const accent = isCpu ? 'rgba(115, 229, 255, 0.96)' : 'rgba(255, 218, 132, 0.96)';
  const soft = isCpu ? 'rgba(77, 184, 255, 0.17)' : 'rgba(248, 203, 96, 0.15)';
  const halo = context.createRadialGradient(centerX, height * 0.48, 4, centerX, height * 0.48, height * 0.48);
  halo.addColorStop(0, soft);
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);

  drawSeal(
    context,
    centerX,
    height * 0.42,
    Math.min(width * 0.34, height * 0.31),
    isCpu ? 'rgba(115, 229, 255, 0.28)' : 'rgba(255, 218, 132, 0.26)',
    isCpu ? 'rgba(115, 229, 255, 0.12)' : 'rgba(255, 218, 132, 0.11)'
  );

  context.save();
  context.lineWidth = Math.max(1.7, width * 0.012);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = accent;
  context.fillStyle = isCpu ? 'rgba(10, 36, 61, 0.78)' : 'rgba(42, 34, 41, 0.78)';

  if (isCpu) {
    const headWidth = width * 0.43;
    const headHeight = height * 0.32;
    const headX = centerX - headWidth / 2;
    const headY = height * 0.18;
    const radius = Math.min(12, headWidth * 0.15);
    context.beginPath();
    context.moveTo(headX + radius, headY);
    context.lineTo(headX + headWidth - radius, headY);
    context.quadraticCurveTo(headX + headWidth, headY, headX + headWidth, headY + radius);
    context.lineTo(headX + headWidth, headY + headHeight - radius);
    context.quadraticCurveTo(headX + headWidth, headY + headHeight, headX + headWidth - radius, headY + headHeight);
    context.lineTo(headX + radius, headY + headHeight);
    context.quadraticCurveTo(headX, headY + headHeight, headX, headY + headHeight - radius);
    context.lineTo(headX, headY + radius);
    context.quadraticCurveTo(headX, headY, headX + radius, headY);
    context.closePath();
    context.fill();
    context.stroke();

    context.beginPath();
    context.moveTo(centerX - headWidth * 0.27, headY + headHeight * 0.38);
    context.lineTo(centerX - headWidth * 0.18, headY + headHeight * 0.38);
    context.moveTo(centerX + headWidth * 0.18, headY + headHeight * 0.38);
    context.lineTo(centerX + headWidth * 0.27, headY + headHeight * 0.38);
    context.moveTo(centerX - headWidth * 0.2, headY + headHeight * 0.66);
    context.lineTo(centerX + headWidth * 0.2, headY + headHeight * 0.66);
    context.stroke();

    context.beginPath();
    context.moveTo(centerX, headY - 10);
    context.lineTo(centerX, headY);
    context.moveTo(centerX - headWidth * 0.64, headY + headHeight * 0.3);
    context.lineTo(headX, headY + headHeight * 0.3);
    context.moveTo(headX + headWidth, headY + headHeight * 0.3);
    context.lineTo(centerX + headWidth * 0.64, headY + headHeight * 0.3);
    context.stroke();
  } else {
    const headY = height * 0.25;
    const headWidth = width * 0.38;
    const headHeight = height * 0.34;
    context.beginPath();
    context.moveTo(centerX - headWidth * 0.48, headY + headHeight * 0.05);
    context.lineTo(centerX - headWidth * 0.25, headY - headHeight * 0.22);
    context.lineTo(centerX + headWidth * 0.02, headY + headHeight * 0.02);
    context.lineTo(centerX + headWidth * 0.37, headY - headHeight * 0.25);
    context.lineTo(centerX + headWidth * 0.55, headY + headHeight * 0.12);
    context.lineTo(centerX + headWidth * 0.5, headY + headHeight * 0.7);
    context.quadraticCurveTo(centerX, headY + headHeight * 1.28, centerX - headWidth * 0.52, headY + headHeight * 0.62);
    context.closePath();
    context.fill();
    context.stroke();

    context.beginPath();
    context.moveTo(centerX - headWidth * 0.26, headY + headHeight * 0.48);
    context.lineTo(centerX - headWidth * 0.08, headY + headHeight * 0.52);
    context.moveTo(centerX + headWidth * 0.08, headY + headHeight * 0.52);
    context.lineTo(centerX + headWidth * 0.26, headY + headHeight * 0.48);
    context.moveTo(centerX - headWidth * 0.1, headY + headHeight * 0.77);
    context.lineTo(centerX + headWidth * 0.12, headY + headHeight * 0.77);
    context.stroke();
  }

  const shoulderY = height * 0.69;
  context.beginPath();
  context.moveTo(width * 0.18, height * 0.98);
  context.lineTo(width * 0.23, shoulderY + 10);
  context.quadraticCurveTo(centerX, shoulderY - 14, width * 0.77, shoulderY + 10);
  context.lineTo(width * 0.82, height * 0.98);
  context.closePath();
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(centerX - width * 0.13, shoulderY + 6);
  context.lineTo(centerX, height * 0.87);
  context.lineTo(centerX + width * 0.13, shoulderY + 6);
  context.strokeStyle = isCpu ? 'rgba(115, 229, 255, 0.65)' : 'rgba(255, 218, 132, 0.65)';
  context.stroke();
  context.restore();
}

function drawControls(context, width, height) {
  const inset = 12;
  const edge = context.createLinearGradient(0, 0, width, 0);
  edge.addColorStop(0, 'rgba(255, 218, 132, 0.52)');
  edge.addColorStop(0.5, 'rgba(163, 234, 255, 0.64)');
  edge.addColorStop(1, 'rgba(255, 218, 132, 0.52)');
  context.strokeStyle = edge;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(inset, 1);
  context.lineTo(width - inset, 1);
  context.moveTo(inset, height - 1);
  context.lineTo(width - inset, height - 1);
  context.stroke();

  const cornerSize = Math.min(28, height * 0.24);
  context.strokeStyle = 'rgba(163, 234, 255, 0.72)';
  [
    [inset, 12, 1, 1],
    [width - inset, 12, -1, 1],
    [inset, height - 12, 1, -1],
    [width - inset, height - 12, -1, -1]
  ].forEach(([x, y, dx, dy]) => {
    context.beginPath();
    context.moveTo(x + cornerSize * dx, y);
    context.lineTo(x, y);
    context.lineTo(x, y + cornerSize * dy);
    context.stroke();
    strokeDiamond(context, x + cornerSize * dx * 0.7, y + cornerSize * dy * 0.7, 2, 'rgba(255, 218, 132, 0.72)');
  });
}

function drawCanvas(canvas, variant) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    console.error('Không thể khởi tạo Canvas sảnh đấu trường.');
    return;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  if (variant === 'screen') {
    drawScreen(context, bounds.width, bounds.height);
  } else if (variant === 'pvp' || variant === 'ai') {
    drawPanel(context, bounds.width, bounds.height, colors[variant]);
  } else if (variant === 'ai-stage') {
    drawArenaStage(context, bounds.width, bounds.height);
  } else if (variant === 'duelist-portrait' || variant === 'cpu-portrait') {
    drawPortrait(context, bounds.width, bounds.height, variant === 'cpu-portrait');
  } else if (variant === 'controls') {
    drawControls(context, bounds.width, bounds.height);
  } else {
    drawModeIcon(context, bounds.width, bounds.height, variant === 'ai-icon');
  }
}

export default function ArenaModeCanvas({ variant, className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return undefined;

    const draw = () => drawCanvas(canvas, variant);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(draw);
      observer.observe(host);
      draw();
      return () => observer.disconnect();
    }

    window.addEventListener('resize', draw);
    draw();
    return () => window.removeEventListener('resize', draw);
  }, [variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true"></canvas>;
}
