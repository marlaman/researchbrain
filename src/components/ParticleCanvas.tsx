import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
}

const COLORS = ["#4f8ef7", "#7c5cbf", "#6ba3ff", "#9d7fe8", "#4f8ef7"];
const COUNT = 85;
const MAX_DIST = 160;
const SPEED = 0.35;

export function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    // Use explicit non-null typed refs inside closures
    const canvas: HTMLCanvasElement = el;
    const cx: CanvasRenderingContext2D = ctx;

    let animId: number;
    let particles: Particle[] = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function spawn(): Particle {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        radius: Math.random() * 1.8 + 0.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        opacity: Math.random() * 0.5 + 0.4,
      };
    }

    function init() {
      particles = Array.from({ length: COUNT }, spawn);
    }

    function draw() {
      cx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = canvas.width + 10;
        else if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        else if (p.y > canvas.height + 10) p.y = -10;
      }

      // Draw connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.45;
            cx.beginPath();
            cx.moveTo(particles[i].x, particles[i].y);
            cx.lineTo(particles[j].x, particles[j].y);
            cx.strokeStyle = `rgba(79, 142, 247, ${alpha})`;
            cx.lineWidth = (1 - dist / MAX_DIST) * 0.8;
            cx.stroke();
          }
        }
      }

      // Draw particles with glow
      for (const p of particles) {
        cx.save();
        cx.globalAlpha = p.opacity;
        cx.shadowBlur = 10;
        cx.shadowColor = p.color;
        cx.beginPath();
        cx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        cx.fillStyle = p.color;
        cx.fill();

        // Bright core
        cx.shadowBlur = 0;
        cx.globalAlpha = p.opacity * 0.9;
        cx.beginPath();
        cx.arc(p.x, p.y, p.radius * 0.45, 0, Math.PI * 2);
        cx.fillStyle = "#ffffff";
        cx.fill();

        cx.restore();
      }

      animId = requestAnimationFrame(draw);
    }

    function onResize() {
      resize();
      init();
    }

    resize();
    init();
    draw();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
