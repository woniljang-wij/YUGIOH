import { useEffect, useRef } from 'react';

function getControlPoint(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 12) {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const nx = -dy / distance;
  const ny = dx / distance;
  const curveSign = dx >= 0 ? -1 : 1;
  const arcOffset = Math.min(54, Math.max(12, distance * 0.14)) * curveSign;
  return {
    x: midX + nx * arcOffset,
    y: midY + ny * arcOffset
  };
}

function evalQuadratic(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
  };
}

function evalQuadraticTangent(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)
  };
}

export default function AttackArrowCanvas({
  start,
  end,
  locked = false
}) {
  const canvasRef = useRef(null);
  const coordsRef = useRef({ start, end, locked });

  useEffect(() => {
    coordsRef.current = { start, end, locked };
  }, [start, end, locked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let frameId = 0;
    const startedAt = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      return { dpr, width, height };
    };

    const drawFrame = (now) => {
      const { dpr, width, height } = resize();
      const { start: from, end: to, locked: isLocked } = coordsRef.current;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      if (from && to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= 4) {
          const control = getControlPoint(from, to);
          const tangent = evalQuadraticTangent(from, control, to, 1);
          const angle = Math.atan2(tangent.y, tangent.x);
          const headLength = Math.min(34, Math.max(20, distance * 0.16));
          const shaftEnd = {
            x: to.x - Math.cos(angle) * (headLength * 0.62),
            y: to.y - Math.sin(angle) * (headLength * 0.62)
          };
          const elapsed = (now - startedAt) / 1000;
          const pulse = 0.5 + 0.5 * Math.sin(elapsed * 8);

          // 1. Soft outer aura along the curve
          context.save();
          const auraGradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
          auraGradient.addColorStop(0, 'rgba(255, 166, 61, 0.28)');
          auraGradient.addColorStop(0.55, 'rgba(255, 58, 48, 0.52)');
          auraGradient.addColorStop(1, 'rgba(255, 36, 76, 0.72)');
          context.strokeStyle = auraGradient;
          context.lineWidth = isLocked ? 16 + pulse * 3 : 14;
          context.lineCap = 'round';
          context.shadowColor = 'rgba(255, 52, 46, 0.85)';
          context.shadowBlur = 18;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.quadraticCurveTo(control.x, control.y, shaftEnd.x, shaftEnd.y);
          context.stroke();
          context.restore();

          // 2. Main crimson-gold energy shaft with animated flow
          context.save();
          const shaftGradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
          shaftGradient.addColorStop(0, '#ffbe47');
          shaftGradient.addColorStop(0.45, '#ff4d2e');
          shaftGradient.addColorStop(1, '#ff1f45');
          context.strokeStyle = shaftGradient;
          context.lineWidth = isLocked ? 7.5 : 6.5;
          context.lineCap = 'round';
          context.setLineDash([18, 10]);
          context.lineDashOffset = -(elapsed * 95);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.quadraticCurveTo(control.x, control.y, shaftEnd.x, shaftEnd.y);
          context.stroke();
          context.restore();

          // 3. Bright inner core filament
          context.save();
          context.strokeStyle = 'rgba(255, 245, 204, 0.86)';
          context.lineWidth = 2.4;
          context.lineCap = 'round';
          context.setLineDash([12, 16]);
          context.lineDashOffset = -(elapsed * 95);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.quadraticCurveTo(control.x, control.y, shaftEnd.x, shaftEnd.y);
          context.stroke();
          context.restore();

          // 4. Flowing energy sparks along the curve
          context.save();
          for (let i = 0; i < 3; i += 1) {
            const t = ((elapsed * 1.15) + i / 3) % 1;
            const pt = evalQuadratic(from, control, shaftEnd, t);
            const alpha = Math.sin(t * Math.PI);
            context.fillStyle = `rgba(255, 244, 186, ${0.85 * alpha})`;
            context.shadowColor = 'rgba(255, 196, 72, 0.95)';
            context.shadowBlur = 10;
            context.beginPath();
            context.arc(pt.x, pt.y, 2.8 + alpha * 1.4, 0, Math.PI * 2);
            context.fill();
          }
          context.restore();

          // 5. Sleek arrowhead
          context.save();
          context.translate(to.x, to.y);
          context.rotate(angle);
          const halfSpread = headLength * 0.56;
          const notchX = -headLength * 0.72;

          context.shadowColor = 'rgba(255, 58, 48, 0.95)';
          context.shadowBlur = 16;

          const headGradient = context.createLinearGradient(-headLength, 0, 0, 0);
          headGradient.addColorStop(0, '#ff8e3c');
          headGradient.addColorStop(0.55, '#ff2d38');
          headGradient.addColorStop(1, '#fff3bf');

          context.beginPath();
          context.moveTo(2, 0);
          context.lineTo(-headLength, -halfSpread);
          context.lineTo(notchX, 0);
          context.lineTo(-headLength, halfSpread);
          context.closePath();
          context.fillStyle = headGradient;
          context.fill();

          context.lineWidth = 1.6;
          context.strokeStyle = '#ffd59e';
          context.lineJoin = 'round';
          context.stroke();
          context.restore();

          // 6. Target lock reticle ring when locked onto a monster or player
          if (isLocked) {
            context.save();
            const radius = 16 + pulse * 5;
            context.strokeStyle = `rgba(255, 224, 140, ${0.65 + pulse * 0.3})`;
            context.lineWidth = 2;
            context.shadowColor = 'rgba(255, 72, 54, 0.95)';
            context.shadowBlur = 14;
            context.beginPath();
            context.arc(to.x, to.y, radius, 0, Math.PI * 2);
            context.stroke();

            context.strokeStyle = 'rgba(255, 72, 62, 0.85)';
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(to.x, to.y, radius * 0.58, elapsed * 2.4, elapsed * 2.4 + Math.PI * 1.45);
            context.stroke();
            context.restore();
          }
        }
      }

      frameId = window.requestAnimationFrame(drawFrame);
    };

    frameId = window.requestAnimationFrame(drawFrame);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="duel-attack-arrow"
      aria-hidden="true"
    />
  );
}
