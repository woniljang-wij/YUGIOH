import { useEffect, useRef } from 'react';

export default function AttendanceRewardEffects() {
  const particleCanvasRef = useRef(null);
  const threeCanvasRef = useRef(null);

  useEffect(() => {
    const canvas = particleCanvasRef.current;
    const stage = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !stage) return undefined;
    if (!context) {
      console.error('Không thể khởi tạo hiệu ứng Canvas phần thưởng.');
      return undefined;
    }

    let frame = 0;
    let width = 0;
    let height = 0;
    let lastFrameTime = 0;
    let particles = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: Math.min(42, Math.round(width / 14)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.6 + Math.random() * 1.8,
        speed: 0.12 + Math.random() * 0.42,
        phase: Math.random() * Math.PI * 2,
        color: ['#69dfff', '#a88bff', '#ffd77a'][Math.floor(Math.random() * 3)]
      }));
    };

    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      const glow = context.createRadialGradient(width / 2, height * 0.61, 8, width / 2, height * 0.61, height * 0.62);
      glow.addColorStop(0, 'rgba(40, 130, 255, 0.16)');
      glow.addColorStop(0.52, 'rgba(67, 93, 255, 0.06)');
      glow.addColorStop(1, 'rgba(5, 14, 38, 0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      particles.forEach((particle) => {
        const shimmer = 0.38 + (Math.sin(time * 0.0014 + particle.phase) + 1) * 0.28;
        context.globalAlpha = shimmer;
        context.fillStyle = particle.color;
        context.shadowColor = particle.color;
        context.shadowBlur = 10;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
        particle.y -= particle.speed;
        particle.x += Math.sin(time * 0.0007 + particle.phase) * 0.18;
        if (particle.y < -4) {
          particle.y = height + 4;
          particle.x = Math.random() * width;
        }
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    const animate = (time) => {
      frame = window.requestAnimationFrame(animate);
      if (time - lastFrameTime < 32) return;
      lastFrameTime = time;
      draw(time);
    };

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(stage);
    resize();
    draw();
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const canvas = threeCanvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return undefined;

    let disposed = false;
    let frame = 0;
    let observer;
    let renderer;
    let scene;
    let camera;
    let rings;
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
        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
        camera.position.set(0, 3.5, 410);
        rings = new THREE.Group();
        scene.add(rings);

        [
          { radius: 102, tube: 1.3, color: 0x48cfff, opacity: 0.72, tilt: 0.02 },
          { radius: 83, tube: 0.8, color: 0x8185ff, opacity: 0.5, tilt: 0.08 },
          { radius: 61, tube: 1.1, color: 0xffd77a, opacity: 0.48, tilt: -0.06 }
        ].forEach(({ radius, tube, color, opacity, tilt }, index) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube, 6, 112),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity,
              depthWrite: false
            })
          );
          ring.rotation.x = Math.PI * 0.42 + tilt;
          ring.rotation.y = index * 0.035;
          ring.position.z = index * 1.5;
          rings.add(ring);
        });

        const resize = () => {
          const bounds = stage.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setSize(bounds.width, bounds.height, false);
          camera.aspect = bounds.width / bounds.height;
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(stage);
        resize();

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          renderer.render(scene, camera);
          return;
        }

        const animate = (time) => {
          frame = window.requestAnimationFrame(animate);
          if (disposed || time - lastFrameTime < 32) return;
          lastFrameTime = time;
          rings.rotation.z = time * 0.00012;
          rings.rotation.y = Math.sin(time * 0.0002) * 0.12;
          renderer.render(scene, camera);
        };
        frame = window.requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) console.error('Không thể khởi tạo hiệu ứng Three.js phần thưởng:', error);
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
  }, []);

  return (
    <>
      <canvas ref={particleCanvasRef} className="attendance-success__particles" aria-hidden="true" />
      <canvas ref={threeCanvasRef} className="attendance-success__three" aria-hidden="true" />
    </>
  );
}
