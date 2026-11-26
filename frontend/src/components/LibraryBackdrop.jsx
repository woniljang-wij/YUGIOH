import { useEffect, useRef } from 'react';

export default function LibraryBackdrop({ active }) {
  const particlesRef = useRef(null);
  const threeRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = particlesRef.current;
    const stage = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !stage) return undefined;
    if (!context) {
      console.error('Không thể khởi tạo Canvas hiệu ứng Thư Viện.');
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
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: Math.min(42, Math.round(width / 30)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.6 + Math.random() * 1.3,
        speed: 0.08 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
        color: ['#69dfff', '#9c8bff', '#ffd77a'][Math.floor(Math.random() * 3)]
      }));
    };

    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      particles.forEach((particle) => {
        context.globalAlpha = 0.24 + (Math.sin(time * 0.001 + particle.phase) + 1) * 0.22;
        context.fillStyle = particle.color;
        context.shadowColor = particle.color;
        context.shadowBlur = 9;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
        particle.y -= particle.speed;
        particle.x += Math.sin(time * 0.0007 + particle.phase) * 0.12;
        if (particle.y < -3) {
          particle.y = height + 3;
          particle.x = Math.random() * width;
        }
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    const animate = (time) => {
      frame = window.requestAnimationFrame(animate);
      if (time - lastFrameTime < 40) return;
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
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = threeRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return undefined;

    let disposed = false;
    let frame = 0;
    let observer;
    let renderer;
    let scene;
    let camera;
    let sigil;
    let lastFrameTime = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1));
        renderer.setClearColor(0x000000, 0);
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
        camera.position.z = 480;
        sigil = new THREE.Group();
        scene.add(sigil);

        [
          { radius: 118, tube: 1.1, color: 0x3c9fff, opacity: 0.25, tilt: 0.03 },
          { radius: 98, tube: 0.7, color: 0x827dff, opacity: 0.18, tilt: 0.1 },
          { radius: 76, tube: 0.9, color: 0xf0c766, opacity: 0.16, tilt: -0.06 },
          { radius: 44, tube: 1.2, color: 0x56cfff, opacity: 0.22, tilt: 0.02 }
        ].forEach(({ radius, tube, color, opacity, tilt }, index) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube, 5, 96),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
          );
          ring.rotation.x = Math.PI * 0.42 + tilt;
          ring.rotation.y = index * 0.035;
          sigil.add(ring);
        });

        const resize = () => {
          const bounds = stage.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          renderer.setSize(bounds.width, bounds.height, false);
          camera.aspect = bounds.width / bounds.height;
          camera.updateProjectionMatrix();
          const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
          const viewWidth = viewHeight * camera.aspect;
          sigil.position.set(viewWidth * 0.16, viewHeight * -0.02, 0);
          sigil.scale.setScalar(Math.min(1, bounds.height / 760));
        };
        observer = new ResizeObserver(resize);
        observer.observe(stage);
        resize();

        if (reducedMotion) {
          renderer.render(scene, camera);
          return;
        }

        const animate = (time) => {
          frame = window.requestAnimationFrame(animate);
          if (disposed || time - lastFrameTime < 40) return;
          lastFrameTime = time;
          sigil.rotation.z = time * 0.00007;
          sigil.rotation.y = Math.sin(time * 0.00012) * 0.08;
          renderer.render(scene, camera);
        };
        frame = window.requestAnimationFrame(animate);
      } catch (error) {
        if (!disposed) console.error('Không thể khởi tạo hiệu ứng Three.js Thư Viện:', error);
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
  }, [active]);

  return (
    <div className="library-screen__backdrop" aria-hidden="true">
      <canvas ref={particlesRef} className="library-screen__particles" />
      <canvas ref={threeRef} className="library-screen__three" />
    </div>
  );
}
