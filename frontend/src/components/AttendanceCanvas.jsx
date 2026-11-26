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

function drawAttendancePanel(canvas, activeTab) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const base = context.createLinearGradient(0, 0, bounds.width, bounds.height);
  base.addColorStop(0, '#07132d');
  base.addColorStop(0.48, '#102653');
  base.addColorStop(1, '#071025');
  roundedRect(context, 0, 0, bounds.width, bounds.height, 18);
  context.fillStyle = base;
  context.fill();

  const centerGlow = context.createRadialGradient(
    bounds.width * 0.52,
    bounds.height * 0.47,
    8,
    bounds.width * 0.52,
    bounds.height * 0.47,
    Math.max(bounds.width, bounds.height) * 0.8
  );
  centerGlow.addColorStop(0, 'rgba(42, 116, 255, 0.16)');
  centerGlow.addColorStop(0.58, 'rgba(27, 73, 158, 0.065)');
  centerGlow.addColorStop(1, 'rgba(2, 6, 19, 0.56)');
  context.fillStyle = centerGlow;
  roundedRect(context, 0, 0, bounds.width, bounds.height, 18);
  context.fill();

  const sealX = bounds.width * 0.5;
  const sealY = bounds.height * 0.25;
  const sealRadius = Math.min(bounds.width * 0.2, bounds.height * 0.34);
  context.save();
  context.translate(sealX, sealY);
  context.strokeStyle = 'rgba(99, 164, 255, 0.075)';
  context.lineWidth = 1;
  [0.56, 0.7, 0.88, 1].forEach((scale, index) => {
    context.beginPath();
    context.arc(0, 0, sealRadius * scale, 0, Math.PI * 2);
    context.stroke();
    if (index > 0) return;
    for (let mark = 0; mark < 24; mark += 1) {
      const angle = (mark / 24) * Math.PI * 2;
      const innerRadius = sealRadius * 0.92;
      const outerRadius = sealRadius * (mark % 3 === 0 ? 1 : 0.96);
      context.beginPath();
      context.moveTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
      context.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
      context.stroke();
    }
  });
  context.beginPath();
  context.moveTo(0, -sealRadius * 0.34);
  context.lineTo(sealRadius * 0.3, 0);
  context.lineTo(0, sealRadius * 0.34);
  context.lineTo(-sealRadius * 0.3, 0);
  context.closePath();
  context.stroke();
  context.restore();

  const headerHeight = Math.min(118, bounds.height * 0.19);
  const header = context.createLinearGradient(0, 0, bounds.width, headerHeight);
  header.addColorStop(0, 'rgba(8, 24, 58, 0.97)');
  header.addColorStop(0.47, 'rgba(13, 35, 83, 0.94)');
  header.addColorStop(1, 'rgba(7, 20, 50, 0.98)');
  context.save();
  roundedRect(context, 2, 2, bounds.width - 4, headerHeight, 16);
  context.clip();
  context.fillStyle = header;
  context.fillRect(0, 0, bounds.width, headerHeight);
  const sheen = context.createLinearGradient(0, 0, bounds.width, headerHeight);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.01)');
  sheen.addColorStop(0.72, 'rgba(70,157,255,0.12)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = sheen;
  context.fillRect(0, 0, bounds.width, headerHeight);
  const headerEdge = context.createLinearGradient(0, 0, bounds.width, 0);
  headerEdge.addColorStop(0, 'rgba(255, 209, 113, 0.9)');
  headerEdge.addColorStop(0.48, 'rgba(75, 171, 255, 0.76)');
  headerEdge.addColorStop(1, 'rgba(255, 209, 113, 0.32)');
  context.fillStyle = headerEdge;
  context.fillRect(20, headerHeight - 2, bounds.width - 40, 2);
  context.restore();

  context.lineWidth = 2;
  context.strokeStyle = 'rgba(90, 169, 255, 0.92)';
  roundedRect(context, 1, 1, bounds.width - 2, bounds.height - 2, 18);
  context.stroke();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(247, 200, 105, 0.48)';
  roundedRect(context, 8, 8, bounds.width - 16, bounds.height - 16, 13);
  context.stroke();

  const cornerSize = 17;
  context.strokeStyle = 'rgba(255, 212, 125, 0.8)';
  context.lineWidth = 1;
  [
    [14, 14, 1, 1],
    [bounds.width - 14, 14, -1, 1],
    [14, bounds.height - 14, 1, -1],
    [bounds.width - 14, bounds.height - 14, -1, -1]
  ].forEach(([x, y, directionX, directionY]) => {
    context.beginPath();
    context.moveTo(x + cornerSize * directionX, y);
    context.lineTo(x, y);
    context.lineTo(x, y + cornerSize * directionY);
    context.stroke();
  });

  const tabWidth = (bounds.width - 40) / 2;
  const selectedX = activeTab === 'monthly' ? 20 : 20 + tabWidth;
  const selectedGradient = context.createLinearGradient(
    selectedX,
    headerHeight,
    selectedX + tabWidth,
    headerHeight + 10
  );
  selectedGradient.addColorStop(0, '#ffe18b');
  selectedGradient.addColorStop(0.5, '#fff3bb');
  selectedGradient.addColorStop(1, '#efb947');
  context.save();
  context.shadowColor = 'rgba(255, 199, 75, 0.55)';
  context.shadowBlur = 14;
  context.fillStyle = selectedGradient;
  roundedRect(context, selectedX + 8, headerHeight - 3, tabWidth - 16, 3, 2);
  context.fill();
  context.restore();

  context.fillStyle = 'rgba(255, 231, 173, 0.24)';
  for (let index = 0; index < 4; index += 1) {
    const x = 26 + index * 19;
    context.fillRect(x, headerHeight + 20 + (index % 2) * 5, 2, 2);
    context.fillRect(bounds.width - x, headerHeight + 31 - (index % 2) * 5, 2, 2);
  }
}

export default function AttendanceCanvas({ activeTab, panelRef }) {
  const canvasRef = useRef(null);
  const particlesCanvasRef = useRef(null);
  const threeCanvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel) return undefined;

    const draw = () => drawAttendancePanel(canvas, activeTab);
    const observer = new ResizeObserver(draw);
    observer.observe(panel);
    draw();
    return () => observer.disconnect();
  }, [activeTab, panelRef]);

  useEffect(() => {
    const canvas = particlesCanvasRef.current;
    const panel = panelRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !panel) return undefined;
    if (!context) {
      console.error('Không thể khởi tạo Canvas hạt sáng điểm danh.');
      return undefined;
    }

    let frame = 0;
    let width = 0;
    let height = 0;
    let lastFrameTime = 0;
    let previousFrameTime = 0;
    let particles = [];
    const colors = ['#8edbff', '#d2f3ff', '#8faeff', '#ffe6a1'];

    const resize = () => {
      const bounds = panel.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(110, Math.max(34, Math.round(width / 13)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 5,
        vy: -2 - Math.random() * 8,
        radius: 0.55 + Math.random() * 1.35,
        phase: Math.random() * Math.PI * 2,
        frequency: 0.8 + Math.random() * 2.4,
        color: colors[Math.floor(Math.random() * colors.length)],
        sparkle: Math.random() > 0.76
      }));
    };

    const draw = (time = 0, delta = 0) => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      particles.forEach((particle) => {
        const shimmer = 0.18 + (Math.sin(time * 0.001 * particle.frequency + particle.phase) + 1) * 0.32;
        const alpha = particle.sparkle ? shimmer * 0.95 : shimmer * 0.68;
        const drift = delta / 1000;
        particle.x += (particle.vx + Math.sin(time * 0.00035 + particle.phase) * 3) * drift;
        particle.y += particle.vy * drift;
        if (particle.y < -8) {
          particle.y = height + 5;
          particle.x = Math.random() * width;
        }
        if (particle.x < -8) particle.x = width + 5;
        if (particle.x > width + 8) particle.x = -5;

        context.globalAlpha = alpha;
        context.fillStyle = particle.color;
        context.shadowColor = particle.color;
        context.shadowBlur = particle.sparkle ? 13 : 7;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        if (particle.sparkle && shimmer > 0.62) {
          const ray = particle.radius * (2.5 + shimmer * 2.4);
          context.globalAlpha = (shimmer - 0.45) * 0.56;
          context.strokeStyle = particle.color;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(particle.x - ray, particle.y);
          context.lineTo(particle.x + ray, particle.y);
          context.moveTo(particle.x, particle.y - ray);
          context.lineTo(particle.x, particle.y + ray);
          context.stroke();
        }
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.globalCompositeOperation = 'source-over';
    };

    const animate = (time) => {
      frame = window.requestAnimationFrame(animate);
      if (time - lastFrameTime < 30) return;
      const delta = previousFrameTime ? Math.min(time - previousFrameTime, 50) : 0;
      previousFrameTime = time;
      lastFrameTime = time;
      draw(time, delta);
    };

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(panel);
    resize();
    draw();
    frame = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [panelRef]);

  useEffect(() => {
    const canvas = threeCanvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel) return undefined;

    let disposed = false;
    let frame = 0;
    let observer;
    let renderer;
    let scene;
    let camera;
    let eye;
    let eyeBaseY = 0;
    let stars;
    let starGeometry;
    let starPositions;
    let starData = [];
    let lastFrameTime = 0;

    const initialize = async () => {
      try {
        const importMap = document.querySelector('script[type="importmap"]');
        const threeUrl = JSON.parse(importMap?.textContent || '{}').imports?.three;
        if (!threeUrl) throw new Error('Three.js không được khai báo trong import map.');
        const THREE = await import(/* @vite-ignore */ threeUrl);
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          powerPreference: 'low-power'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        camera.position.z = 500;
        eye = new THREE.Group();
        scene.add(eye);

        const addLine = (points, color, opacity) => {
          const geometry = new THREE.BufferGeometry().setFromPoints(
            points.map(([x, y, z = 0]) => new THREE.Vector3(x, y, z))
          );
          const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthWrite: false
          });
          eye.add(new THREE.LineLoop(geometry, material));
        };

        addLine([[0, 207], [178, -76], [-178, -76]], 0x318dff, 0.32);
        addLine([[0, 194], [163, -67], [-163, -67]], 0x90dfff, 0.24);
        addLine([[0, 139], [118, -49], [-118, -49]], 0x3c7fce, 0.19);

        [44, 58, 74].forEach((radius, index) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, index === 0 ? 2.2 : 1, 6, 64),
            new THREE.MeshBasicMaterial({
              color: 0x71bcff,
              transparent: true,
              opacity: index === 0 ? 0.6 : 0.2 - index * 0.04,
              depthWrite: false
            })
          );
          ring.position.z = index * 0.2;
          eye.add(ring);
        });

        const eyeShape = new THREE.Shape();
        eyeShape.moveTo(-74, 0);
        eyeShape.quadraticCurveTo(-36, 36, 0, 38);
        eyeShape.quadraticCurveTo(36, 36, 74, 0);
        eyeShape.quadraticCurveTo(36, -36, 0, -38);
        eyeShape.quadraticCurveTo(-36, -36, -74, 0);
        addLine(
          eyeShape.getPoints(48).map(({ x, y }) => [x, y, 1]),
          0x98dfff,
          0.7
        );

        const pupil = new THREE.Mesh(
          new THREE.SphereGeometry(17, 20, 12),
          new THREE.MeshBasicMaterial({
            color: 0x55aaff,
            transparent: true,
            opacity: 0.52,
            depthWrite: false
          })
        );
        pupil.scale.z = 0.12;
        pupil.position.z = 2;
        eye.add(pupil);

        const starCount = 190;
        starPositions = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);
        const starPhases = new Float32Array(starCount);
        const starColors = new Float32Array(starCount * 3);
        starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeometry.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
        starGeometry.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
        starGeometry.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));
        stars = new THREE.Points(
          starGeometry,
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
              attribute float aSize;
              attribute float aPhase;
              attribute vec3 aColor;
              uniform float uTime;
              varying vec3 vColor;
              varying float vTwinkle;
              void main() {
                vColor = aColor;
                vTwinkle = 0.42 + 0.58 * (0.5 + 0.5 * sin(uTime * (1.3 + aPhase) + aPhase * 8.0));
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * viewPosition;
                gl_PointSize = aSize * (0.68 + vTwinkle * 0.9);
              }
            `,
            fragmentShader: `
              varying vec3 vColor;
              varying float vTwinkle;
              void main() {
                vec2 point = gl_PointCoord - 0.5;
                float radius = length(point);
                float glow = 1.0 - smoothstep(0.02, 0.5, radius);
                float rayX = exp(-abs(point.x) * 34.0) * exp(-abs(point.y) * 5.0);
                float rayY = exp(-abs(point.y) * 34.0) * exp(-abs(point.x) * 5.0);
                float alpha = (glow * 0.28 + (rayX + rayY) * 0.28) * vTwinkle;
                gl_FragColor = vec4(vColor * (0.7 + vTwinkle * 0.55), alpha);
              }
            `
          })
        );
        stars.frustumCulled = false;
        scene.add(stars);

        const resize = () => {
          const bounds = panel.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setSize(bounds.width, bounds.height, false);
          camera.left = -bounds.width / 2;
          camera.right = bounds.width / 2;
          camera.top = bounds.height / 2;
          camera.bottom = -bounds.height / 2;
          camera.updateProjectionMatrix();
          eyeBaseY = bounds.height * 0.36;
          eye.position.set(0, eyeBaseY, 0);
          eye.scale.setScalar(Math.min(1, bounds.width / 1100, bounds.height / 650));
          const positions = starGeometry.getAttribute('position');
          starData = [];
          for (let index = 0; index < positions.count; index += 1) {
            const x = (Math.random() - 0.5) * bounds.width;
            const y = (Math.random() - 0.5) * bounds.height;
            const phase = Math.random();
            const color = new THREE.Color(
              [0x73caff, 0xc3ebff, 0x8e9fff, 0xffdf98][Math.floor(Math.random() * 4)]
            );
            starData.push({
              x,
              y,
              phase,
              vx: (Math.random() - 0.5) * 3.2,
              vy: -2.5 - Math.random() * 9,
              boundsWidth: bounds.width,
              boundsHeight: bounds.height
            });
            positions.setXYZ(index, x, y, -4);
            starSizes[index] = 2.2 + Math.random() * 3.5;
            starPhases[index] = phase;
            starColors.set([color.r, color.g, color.b], index * 3);
          }
          positions.needsUpdate = true;
          starGeometry.getAttribute('aSize').needsUpdate = true;
          starGeometry.getAttribute('aPhase').needsUpdate = true;
          starGeometry.getAttribute('aColor').needsUpdate = true;
        };
        observer = new ResizeObserver(resize);
        observer.observe(panel);
        resize();

        const animate = (time) => {
          frame = window.requestAnimationFrame(animate);
          if (disposed || time - lastFrameTime < 32) return;
          const delta = Math.min(time - (lastFrameTime || time), 50) / 1000;
          lastFrameTime = time;
          eye.rotation.z = Math.sin(time * 0.00012) * 0.018;
          eye.position.y = eyeBaseY + Math.sin(time * 0.00035) * 3;
          eye.scale.setScalar(
            Math.min(1, panel.clientWidth / 1100, panel.clientHeight / 650)
            * (1 + Math.sin(time * 0.0008) * 0.012)
          );
          const positions = starGeometry.getAttribute('position');
          starData.forEach((star, index) => {
            star.x += star.vx * delta;
            star.y += star.vy * delta;
            if (star.y < -star.boundsHeight / 2 - 5) {
              star.y = star.boundsHeight / 2 + 5;
              star.x = (Math.random() - 0.5) * star.boundsWidth;
            }
            if (star.x < -star.boundsWidth / 2 - 5) star.x = star.boundsWidth / 2 + 5;
            if (star.x > star.boundsWidth / 2 + 5) star.x = -star.boundsWidth / 2 - 5;
            positions.setXY(index, star.x, star.y);
          });
          positions.needsUpdate = true;
          stars.material.uniforms.uTime.value = time * 0.001;
          renderer.render(scene, camera);
        };
        frame = window.requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) console.error('Không thể khởi tạo hiệu ứng Three.js điểm danh:', error);
      }
    };

    initialize();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      scene?.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
      renderer?.dispose();
    };
  }, [panelRef]);

  return (
    <>
      <canvas ref={canvasRef} className="attendance-modal__canvas" aria-hidden="true" />
      <canvas ref={threeCanvasRef} className="attendance-modal__three-canvas" aria-hidden="true" />
      <canvas ref={particlesCanvasRef} className="attendance-modal__particles" aria-hidden="true" />
    </>
  );
}
