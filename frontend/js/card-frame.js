(function () {
  'use strict';

  const FRAME_WIDTH = 300;
  const FRAME_HEIGHT = 438;
  const palettes = {
    monster: {
      shadow: '#181808',
      dark: '#705c10',
      bronze: '#a88918',
      gold: '#d6b83a',
      bright: '#f4e58d',
      accent: '#a88918',
      accentLight: '#d6b83a',
      railTop: '#d6b83a',
      railMiddle: '#a88918',
      railBottom: '#705c10',
      header: '#201f08'
    },
    effect: {
      shadow: '#241306',
      dark: '#744018',
      bronze: '#ad6325',
      gold: '#e5a541',
      bright: '#ffe29a',
      accent: '#c47a2a',
      accentLight: '#ffd16a',
      railTop: '#e5a541',
      railMiddle: '#bb7028',
      railBottom: '#744018',
      header: '#28170b'
    },
    fusion: {
      shadow: '#100718',
      dark: '#382052',
      bronze: '#704391',
      gold: '#bd8bda',
      bright: '#f4dfff',
      accent: '#ae74e2',
      accentLight: '#f2caff',
      railTop: '#392345',
      railMiddle: '#201329',
      railBottom: '#0d0811'
    },
    spell: {
      shadow: '#061b0a',
      dark: '#087b32',
      bronze: '#19a848',
      gold: '#46e875',
      bright: '#c2ff9b',
      accent: '#20c957',
      accentLight: '#91ff9a',
      railTop: '#47ed5c',
      railMiddle: '#1ab844',
      railBottom: '#08712b',
      header: '#0a5228'
    },
    trap: {
      shadow: '#180818',
      dark: '#5a185f',
      bronze: '#8b288c',
      gold: '#c54bc5',
      bright: '#efa0ed',
      accent: '#8b288c',
      accentLight: '#c54bc5',
      railTop: '#c54bc5',
      railMiddle: '#8b288c',
      railBottom: '#5a185f',
      header: '#35103a'
    }
  };

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function metalGradient(context, palette, x1, y1, x2, y2) {
    const gradient = context.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, palette.shadow);
    gradient.addColorStop(0.13, palette.gold);
    gradient.addColorStop(0.27, palette.bright);
    gradient.addColorStop(0.39, palette.bronze);
    gradient.addColorStop(0.55, palette.dark);
    gradient.addColorStop(0.72, palette.gold);
    gradient.addColorStop(0.86, palette.bright);
    gradient.addColorStop(1, palette.shadow);
    return gradient;
  }

  function strokePath(context, points, color, width) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineJoin = 'miter';
    context.stroke();
  }

  function drawCorner(context, palette) {
    const plate = [
      [1, 34], [1, 9], [9, 1], [37, 1], [31, 7], [25, 12],
      [21, 20], [14, 27], [8, 34]
    ];
    context.beginPath();
    context.moveTo(plate[0][0], plate[0][1]);
    plate.slice(1).forEach(function (point) {
      context.lineTo(point[0], point[1]);
    });
    context.closePath();
    context.fillStyle = metalGradient(context, palette, 0, 0, 38, 34);
    context.fill();
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.95)';
    context.shadowBlur = 4;
    context.shadowOffsetX = 1.5;
    context.shadowOffsetY = 2;
    context.strokeStyle = '#080807';
    context.lineWidth = 5;
    context.stroke();
    context.restore();
    context.strokeStyle = palette.bright;
    context.lineWidth = 1.2;
    context.stroke();

    strokePath(context, [[4, 30], [4, 10], [10, 4], [32, 4]], palette.gold, 1.4);
    strokePath(context, [[8, 29], [8, 12], [12, 8], [27, 8]], palette.shadow, 1.1);
    strokePath(context, [[2, 27], [2, 9], [9, 2], [27, 2]], palette.accentLight, 0.8);
    strokePath(context, [[10, 32], [16, 26], [22, 22], [29, 14]], palette.shadow, 1.4);
    strokePath(context, [[13, 25], [18, 20], [21, 14], [27, 10]], palette.accentLight, 1);
    strokePath(context, [[3, 17], [7, 17], [7, 22]], palette.bright, 1);
    strokePath(context, [[17, 3], [17, 7], [22, 7]], palette.bright, 1);

    context.beginPath();
    context.moveTo(13, 10);
    context.lineTo(18, 13);
    context.lineTo(15, 18);
    context.lineTo(10, 15);
    context.closePath();
    context.fillStyle = palette.accent;
    context.fill();
    context.strokeStyle = palette.bright;
    context.lineWidth = 1;
    context.stroke();

    context.beginPath();
    context.arc(6, 6, 1.7, 0, Math.PI * 2);
    context.fillStyle = palette.bright;
    context.fill();
    context.beginPath();
    context.arc(8, 8, 0.8, 0, Math.PI * 2);
    context.fillStyle = palette.shadow;
    context.fill();

    context.beginPath();
    context.moveTo(23, 3);
    context.lineTo(35, 3);
    context.lineTo(30, 8);
    context.lineTo(26, 10);
    context.closePath();
    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    context.fill();
    strokePath(context, [[3, 33], [8, 33], [12, 29]], 'rgba(255, 255, 255, 0.52)', 0.9);
  }

  function drawMirroredCorners(context, palette) {
    [[0, 0, 1, 1], [FRAME_WIDTH, 0, -1, 1],
      [0, FRAME_HEIGHT, 1, -1], [FRAME_WIDTH, FRAME_HEIGHT, -1, -1]]
      .forEach(function (corner) {
        context.save();
        context.translate(corner[0], corner[1]);
        context.scale(corner[2], corner[3]);
        drawCorner(context, palette);
        context.restore();
      });
  }

  function drawSideMechanism(context, palette, y) {
    [[3, 1], [FRAME_WIDTH - 3, -1]].forEach(function (side) {
      context.save();
      context.translate(side[0], y);
      context.scale(side[1], 1);
      context.beginPath();
      context.moveTo(0, -15);
      context.lineTo(6, -11);
      context.lineTo(8, -5);
      context.lineTo(6, 0);
      context.lineTo(8, 6);
      context.lineTo(6, 12);
      context.lineTo(0, 15);
      context.closePath();
      context.fillStyle = metalGradient(context, palette, 0, -14, 12, 14);
      context.fill();
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.95)';
      context.shadowBlur = 3;
      context.shadowOffsetY = 1.5;
      context.strokeStyle = '#080807';
      context.lineWidth = 3;
      context.stroke();
      context.restore();
      context.strokeStyle = palette.bright;
      context.lineWidth = 0.9;
      context.stroke();
      strokePath(context, [[2, -10], [5, -6], [3, -2], [6, 2], [3, 7], [2, 10]],
        palette.accentLight, 1.1);
      strokePath(context, [[1, -4], [4, -2], [2, 1], [5, 4]], palette.shadow, 1);
      context.beginPath();
      context.arc(4, -10, 1.1, 0, Math.PI * 2);
      context.fillStyle = palette.bright;
      context.fill();
      context.restore();
    });
  }

  function drawCenterEmblems(context, palette) {
    [0, FRAME_HEIGHT].forEach(function (y, index) {
      context.save();
      context.translate(FRAME_WIDTH / 2, y);
      context.beginPath();
      context.moveTo(0, index === 0 ? 2 : -2);
      context.lineTo(10, index === 0 ? 12 : -12);
      context.lineTo(0, index === 0 ? 21 : -21);
      context.lineTo(-10, index === 0 ? 12 : -12);
      context.closePath();
      context.fillStyle = metalGradient(context, palette, -10, 0, 10, 0);
      context.fill();
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.9)';
      context.shadowBlur = 3;
      context.shadowOffsetY = index === 0 ? 2 : -2;
      context.strokeStyle = '#080807';
      context.lineWidth = 3;
      context.stroke();
      context.restore();
      context.strokeStyle = palette.bright;
      context.lineWidth = 0.8;
      context.stroke();
      context.restore();
    });
  }

  function drawBevelHighlights(context, palette) {
    strokePath(context, [[13, 6], [FRAME_WIDTH - 13, 6]], 'rgba(255, 255, 255, 0.62)', 0.8);
    strokePath(context, [[6, 16], [6, FRAME_HEIGHT - 16]], 'rgba(255, 255, 255, 0.48)', 0.8);
    strokePath(context, [[14, 12], [FRAME_WIDTH - 14, 12]], palette.gold, 0.7);
    strokePath(
      context,
      [[FRAME_WIDTH - 7, 18], [FRAME_WIDTH - 7, FRAME_HEIGHT - 18]],
      'rgba(0, 0, 0, 0.9)',
      1.4
    );
    strokePath(
      context,
      [[18, FRAME_HEIGHT - 7], [FRAME_WIDTH - 18, FRAME_HEIGHT - 7]],
      'rgba(0, 0, 0, 0.9)',
      1.4
    );
    strokePath(
      context,
      [[FRAME_WIDTH - 10, 20], [FRAME_WIDTH - 10, FRAME_HEIGHT - 20]],
      palette.shadow,
      0.9
    );
    strokePath(
      context,
      [[20, FRAME_HEIGHT - 10], [FRAME_WIDTH - 20, FRAME_HEIGHT - 10]],
      palette.shadow,
      0.9
    );
  }

  function drawUnifiedTopRail(context, palette, canvas, scaleX, scaleY) {
    const bounds = canvas.getBoundingClientRect();
    const header = canvas.parentElement.querySelector('.card-detail__card-header');
    const stars = canvas.parentElement.querySelector('.card-detail__card-stars');
    let x = 12;
    let y = 11;
    let width = FRAME_WIDTH - 24;
    let headerHeight = palette === palettes.spell || palette === palettes.trap ? 38 : 27;
    let starsHeight = FRAME_HEIGHT * 0.07 + 3;

    if (bounds.width && bounds.height && header && stars) {
      const headerBounds = header.getBoundingClientRect();
      const starsBounds = stars.getBoundingClientRect();
      if (headerBounds.width && headerBounds.height && starsBounds.height) {
        x = (headerBounds.left - bounds.left) * scaleX;
        y = (headerBounds.top - bounds.top) * scaleY;
        width = headerBounds.width * scaleX;
        headerHeight = headerBounds.height * scaleY;
        starsHeight = (starsBounds.bottom - headerBounds.bottom) * scaleY;
      }
    }

    const titleSurface = context.createLinearGradient(0, y, 0, y + headerHeight);
    titleSurface.addColorStop(0, '#080908');
    titleSurface.addColorStop(0.2, '#161713');
    titleSurface.addColorStop(0.56, '#090a08');
    titleSurface.addColorStop(1, '#020302');
    context.fillStyle = titleSurface;
    context.fillRect(x, y, width, headerHeight);

    const titleSheen = context.createLinearGradient(0, y, 0, y + Math.min(4, headerHeight * 0.16));
    titleSheen.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    titleSheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = titleSheen;
    context.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.min(4, headerHeight * 0.16));

    const titleBottom = y + headerHeight;
    context.fillStyle = palette.gold;
    context.fillRect(x, titleBottom, width, 0.8 * scaleY);
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(x, titleBottom + 0.8 * scaleY, width, 0.8 * scaleY);

    const starsTop = titleBottom + 1.6 * scaleY;
    const starsBottom = starsTop + starsHeight;
    const surface = context.createLinearGradient(0, starsTop, 0, starsBottom);
    surface.addColorStop(0, palette.railTop);
    surface.addColorStop(0.16, palette.dark);
    surface.addColorStop(0.52, palette.railMiddle);
    surface.addColorStop(0.86, palette.dark);
    surface.addColorStop(1, palette.railBottom);
    context.fillStyle = surface;
    context.fillRect(x, starsTop, width, starsHeight);

    const sheen = context.createLinearGradient(0, starsTop, 0, starsTop + Math.min(7, starsHeight * 0.2));
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = sheen;
    context.fillRect(x + 1, starsTop + 1, Math.max(0, width - 2), Math.min(7, starsHeight * 0.2));

    const lowerEdge = starsBottom;
    const shadow = context.createLinearGradient(0, lowerEdge - 2, 0, lowerEdge + 2);
    shadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shadow.addColorStop(0.55, 'rgba(0, 0, 0, 0.48)');
    shadow.addColorStop(1, 'rgba(255, 255, 255, 0.24)');
    context.fillStyle = shadow;
    context.fillRect(x + 1, lowerEdge - 2, Math.max(0, width - 2), 4);
    context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width, y);
    context.stroke();
  }

  function drawGoldOrnamentStroke(context, drawPath, width) {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = 'rgba(0, 0, 0, 0.95)';
    context.shadowBlur = 2.4;
    context.shadowOffsetX = 0.8;
    context.shadowOffsetY = 1.5;
    context.beginPath();
    drawPath(context);
    context.lineWidth = width + 2;
    context.strokeStyle = '#241405';
    context.stroke();
    context.shadowColor = 'transparent';
    context.beginPath();
    drawPath(context);
    context.lineWidth = width;
    const gold = context.createLinearGradient(0, 0, 0, 40);
    gold.addColorStop(0, '#fff2b2');
    gold.addColorStop(0.18, '#d5a33b');
    gold.addColorStop(0.42, '#fff0a0');
    gold.addColorStop(0.68, '#9d681c');
    gold.addColorStop(0.86, '#f3d36d');
    gold.addColorStop(1, '#754711');
    context.strokeStyle = gold;
    context.stroke();
    context.beginPath();
    drawPath(context);
    context.lineWidth = Math.max(0.55, width * 0.19);
    context.strokeStyle = 'rgba(255, 250, 207, 0.88)';
    context.stroke();
    context.restore();
  }

  function drawGoldOrnamentCorner(context) {
    context.save();
    context.beginPath();
    context.moveTo(2, 35);
    context.lineTo(2, 12);
    context.lineTo(12, 2);
    context.lineTo(39, 2);
    context.lineTo(31, 9);
    context.lineTo(25, 12);
    context.lineTo(21, 20);
    context.lineTo(14, 25);
    context.lineTo(12, 32);
    context.lineTo(6, 38);
    context.closePath();
    const plate = context.createLinearGradient(3, 2, 35, 37);
    plate.addColorStop(0, 'rgba(255, 247, 185, 0.95)');
    plate.addColorStop(0.2, 'rgba(183, 129, 38, 0.92)');
    plate.addColorStop(0.48, 'rgba(255, 225, 117, 0.94)');
    plate.addColorStop(0.72, 'rgba(113, 66, 14, 0.96)');
    plate.addColorStop(1, 'rgba(236, 190, 75, 0.92)');
    context.fillStyle = plate;
    context.shadowColor = 'rgba(0, 0, 0, 0.95)';
    context.shadowBlur = 3;
    context.shadowOffsetX = 1;
    context.shadowOffsetY = 2;
    context.fill();
    context.shadowColor = 'transparent';
    context.lineWidth = 1;
    context.strokeStyle = '#fff0a1';
    context.stroke();
    context.restore();

    drawGoldOrnamentStroke(context, function (path) {
      path.moveTo(4, 34);
      path.bezierCurveTo(5, 24, 5, 14, 14, 6);
      path.bezierCurveTo(20, 1, 29, 2, 33, 7);
      path.bezierCurveTo(37, 12, 32, 16, 27, 13);
      path.bezierCurveTo(22, 10, 24, 5, 29, 6);
    }, 2.8);
    drawGoldOrnamentStroke(context, function (path) {
      path.moveTo(7, 31);
      path.bezierCurveTo(9, 23, 11, 15, 18, 10);
      path.bezierCurveTo(23, 7, 28, 9, 28, 12);
      path.bezierCurveTo(27, 15, 23, 15, 22, 12);
    }, 1.8);
    drawGoldOrnamentStroke(context, function (path) {
      path.moveTo(5, 20);
      path.bezierCurveTo(10, 20, 13, 17, 14, 13);
      path.bezierCurveTo(15, 10, 12, 9, 10, 11);
      path.bezierCurveTo(8, 13, 10, 16, 13, 16);
      path.bezierCurveTo(17, 16, 19, 12, 21, 8);
    }, 1.5);
    drawGoldOrnamentStroke(context, function (path) {
      path.moveTo(8, 35);
      path.bezierCurveTo(12, 31, 17, 29, 21, 25);
      path.bezierCurveTo(24, 22, 24, 18, 21, 17);
      path.bezierCurveTo(18, 16, 16, 19, 18, 21);
      path.bezierCurveTo(20, 23, 23, 21, 26, 18);
      path.lineTo(31, 12);
    }, 1.9);

    const facets = [
      [[12, 3], [18, 3], [13, 8], [8, 8]],
      [[3, 13], [8, 8], [8, 14], [3, 19]],
      [[5, 27], [10, 22], [11, 26], [7, 31]],
      [[23, 3], [34, 3], [29, 8], [24, 9]]
    ];
    facets.forEach(function (points, index) {
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(function (point) {
        context.lineTo(point[0], point[1]);
      });
      context.closePath();
      context.fillStyle = index % 2 === 0
        ? 'rgba(255, 248, 194, 0.84)'
        : 'rgba(255, 218, 111, 0.72)';
      context.fill();
      context.strokeStyle = 'rgba(92, 53, 12, 0.88)';
      context.lineWidth = 0.65;
      context.stroke();
    });

    [[12, 12], [17, 7], [7, 23], [24, 27], [30, 19]].forEach(function (point, index) {
      context.beginPath();
      context.arc(point[0], point[1], index === 0 ? 1.45 : 0.85, 0, Math.PI * 2);
      const rivet = context.createRadialGradient(
        point[0] - 0.35, point[1] - 0.4, 0.1,
        point[0], point[1], index === 0 ? 1.5 : 0.9
      );
      rivet.addColorStop(0, '#fffbd0');
      rivet.addColorStop(0.48, '#f4d574');
      rivet.addColorStop(1, '#70410f');
      context.fillStyle = rivet;
      context.fill();
      context.strokeStyle = 'rgba(60, 34, 8, 0.9)';
      context.lineWidth = 0.55;
      context.stroke();
    });
  }

  function drawGoldTypeOrnaments(context, width, height) {
    const insetX = 3;
    const insetY = 2;
    const cornerWidth = Math.min(43, width * 0.23, height * 1.16);
    const cornerHeight = Math.min(37, height - insetY * 2, cornerWidth * 0.86);
    [
      [insetX, insetY, 1, 1],
      [width - insetX, insetY, -1, 1],
      [insetX, height - insetY, 1, -1],
      [width - insetX, height - insetY, -1, -1]
    ].forEach(function (corner) {
      context.save();
      context.translate(corner[0], corner[1]);
      context.scale(corner[2], corner[3]);
      context.scale(cornerWidth / 40, cornerHeight / 40);
      drawGoldOrnamentCorner(context);
      context.restore();
    });
  }

  function renderTypeOrnament(canvas) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    const renderKey = 'ornament:' + canvas.dataset.cardTypePalette + ':' + width + 'x' + height;
    if (renderedCanvasSizes.get(canvas) === renderKey) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available for card type ornaments.');
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    drawGoldTypeOrnaments(context, bounds.width, bounds.height);
    renderedCanvasSizes.set(canvas, renderKey);
  }

  function drawFrame(context, palette) {
    context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    const base = context.createLinearGradient(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    base.addColorStop(0, '#050505');
    base.addColorStop(0.18, palette.shadow);
    base.addColorStop(0.5, '#080908');
    base.addColorStop(0.82, palette.shadow);
    base.addColorStop(1, '#040404');
    roundedRect(context, 1, 1, FRAME_WIDTH - 2, FRAME_HEIGHT - 2, 10);
    context.fillStyle = base;
    context.fill();

    roundedRect(context, 3, 3, FRAME_WIDTH - 6, FRAME_HEIGHT - 6, 9);
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.95)';
    context.shadowBlur = 7;
    context.shadowOffsetY = 3;
    context.lineWidth = 5;
    context.strokeStyle = '#050505';
    context.stroke();
    context.restore();
    roundedRect(context, 4.5, 4.5, FRAME_WIDTH - 9, FRAME_HEIGHT - 9, 8);
    context.lineWidth = 4;
    context.strokeStyle = metalGradient(context, palette, 0, 0, FRAME_WIDTH, 0);
    context.stroke();
    roundedRect(context, 7, 7, FRAME_WIDTH - 14, FRAME_HEIGHT - 14, 6);
    context.lineWidth = 1.2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    context.stroke();
    roundedRect(context, 9, 9, FRAME_WIDTH - 18, FRAME_HEIGHT - 18, 5);
    context.lineWidth = 1.4;
    context.strokeStyle = metalGradient(context, palette, 0, 0, FRAME_WIDTH, 0);
    context.stroke();
    roundedRect(context, 15, 16, FRAME_WIDTH - 30, FRAME_HEIGHT - 32, 4);
    context.lineWidth = 0.8;
    context.strokeStyle = palette.accent;
    context.globalAlpha = 0.72;
    context.stroke();
    context.globalAlpha = 1;

    drawBevelHighlights(context, palette);
    const bounds = context.canvas.getBoundingClientRect();
    drawUnifiedTopRail(
      context,
      palette,
      context.canvas,
      bounds.width ? FRAME_WIDTH / bounds.width : 1,
      bounds.height ? FRAME_HEIGHT / bounds.height : 1
    );
    drawMirroredCorners(context, palette);
    drawSideMechanism(context, palette, 103);
    drawSideMechanism(context, palette, 334);
    drawCenterEmblems(context, palette);

    for (let index = 0; index < 4; index += 1) {
      const x = index % 2 === 0 ? 18 : FRAME_WIDTH - 18;
      const y = index < 2 ? 48 : FRAME_HEIGHT - 48;
      context.beginPath();
      context.arc(x, y, 2.1, 0, Math.PI * 2);
      context.fillStyle = palette.gold;
      context.fill();
      context.beginPath();
      context.arc(x, y, 0.85, 0, Math.PI * 2);
      context.fillStyle = palette.shadow;
      context.fill();
    }
  }

  function render(canvas, palette) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * pixelRatio);
    const height = Math.round(bounds.height * pixelRatio);
    const renderKey = 'frame:' + canvas.dataset.cardFramePalette + ':' + width + 'x' + height;
    if (renderedCanvasSizes.get(canvas) === renderKey) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available for the card frame.');
    context.setTransform(width / FRAME_WIDTH, 0, 0, height / FRAME_HEIGHT, 0, 0);
    drawFrame(context, palette);
    renderedCanvasSizes.set(canvas, renderKey);
  }

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.target.isConnected) {
          resizeObserver.unobserve(entry.target);
          return;
        }
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          if (entry.target.dataset.cardTypeOrnament === 'true') {
            renderTypeOrnament(entry.target);
          } else {
            render(entry.target, palettes[entry.target.dataset.cardFramePalette]);
          }
        }
      });
    })
    : null;
  const renderedCanvasSizes = new WeakMap();

  window.drawCardFrame = function (canvas, category, monsterType) {
    const paletteName = category === 'fusion'
      ? 'fusion'
      : category === 'spell' || category === 'trap'
        ? category
        : category === 'monster' && monsterType !== 'Thường'
          ? 'effect'
          : 'monster';
    const palette = palettes[paletteName];
    if (!palette) throw new Error('Unsupported card frame category: ' + category);

    canvas.dataset.cardFramePalette = paletteName;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) {
      render(canvas, palette);
    }
    if (resizeObserver) {
      resizeObserver.observe(canvas);
    } else if (!bounds.width || !bounds.height) {
      window.requestAnimationFrame(function () {
        if (!canvas.isConnected) return;
        render(canvas, palettes[canvas.dataset.cardFramePalette]);
      });
    }
  };

  window.drawCardTypeOrnament = function (canvas, category) {
    if (category !== 'spell' && category !== 'trap') {
      throw new Error('Card type ornaments only support spell and trap cards.');
    }
    canvas.dataset.cardTypeOrnament = 'true';
    canvas.dataset.cardTypePalette = category;
    renderTypeOrnament(canvas);
    if (resizeObserver) {
      resizeObserver.observe(canvas);
    } else {
      window.requestAnimationFrame(function () {
        if (!canvas.isConnected) return;
        renderTypeOrnament(canvas);
      });
    }
  };
})();
