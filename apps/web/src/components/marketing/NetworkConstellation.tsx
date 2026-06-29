"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * Canvas-based "network" of slow-drifting nodes connected by thin lines that
 * fade in when two nodes get close — echoing the team/mentorship-network idea.
 * Layers on top of BackgroundMesh (sits at -z-10, above the -z-20 blobs and
 * below the ambient glow + content). Medium intensity, green/teal on navy.
 *
 * Interactions: the whole field eases toward the cursor (parallax) and drifts
 * slightly slower than scroll for depth; the cursor itself acts as a transient
 * node so edges connect to it on hover.
 *
 * Under prefers-reduced-motion it paints a single static frame (no rAF loop,
 * no parallax) so it still reads as designed rather than vanishing.
 */
export function NetworkConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const el = canvas;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const GREEN = "74, 222, 128"; // tailwind green-400 — brighter so it reads over the mesh
    const TEAL = "45, 212, 191"; // tailwind teal-400
    const EDGE_THRESHOLD = 165; // px within which two nodes connect
    const MAX_EDGE_ALPHA = 0.32;
    const NODE_ALPHA = 0.7;

    type Node = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      teal: boolean;
      phase: number; // twinkle phase offset
      twSpeed: number; // twinkle speed
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let rafId = 0;
    let resizeRaf = 0;
    let t = 0; // frame counter, drives the automatic twinkle

    // Eased pointer parallax + a live cursor node (negative = off-screen/idle).
    const pointer = { x: -1, y: -1, ox: 0, oy: 0, tx: 0, ty: 0 };

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    function buildNodes() {
      const area = width * height;
      const count = Math.max(60, Math.min(120, Math.round(area / 15000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: rand(-0.35, 0.35),
        vy: rand(-0.35, 0.35),
        r: rand(2, 4),
        teal: Math.random() < 0.28,
        phase: rand(0, Math.PI * 2),
        twSpeed: rand(0.01, 0.03),
      }));
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      // Field-wide offset: eased cursor parallax + slow scroll parallax.
      pointer.ox += (pointer.tx - pointer.ox) * 0.05;
      pointer.oy += (pointer.ty - pointer.oy) * 0.05;
      const scrollOffset = reducedMotion ? 0 : window.scrollY * 0.04;
      const offX = pointer.ox;
      const offY = pointer.oy - scrollOffset;

      // Draw edges (node-to-node + node-to-cursor).
      const points = nodes.map((n) => ({ x: n.x + offX, y: n.y + offY }));
      const cursorActive = pointer.x >= 0 && pointer.y >= 0;

      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < EDGE_THRESHOLD) {
            const alpha = (1 - dist / EDGE_THRESHOLD) * MAX_EDGE_ALPHA;
            ctx!.strokeStyle = `rgba(${GREEN}, ${alpha})`;
            ctx!.lineWidth = 1.4;
            ctx!.beginPath();
            ctx!.moveTo(points[i].x, points[i].y);
            ctx!.lineTo(points[j].x, points[j].y);
            ctx!.stroke();
          }
        }
        if (cursorActive) {
          const dx = points[i].x - pointer.x;
          const dy = points[i].y - pointer.y;
          const dist = Math.hypot(dx, dy);
          const cursorThreshold = EDGE_THRESHOLD * 1.4;
          if (dist < cursorThreshold) {
            const alpha = (1 - dist / cursorThreshold) * MAX_EDGE_ALPHA * 1.6;
            ctx!.strokeStyle = `rgba(${GREEN}, ${alpha})`;
            ctx!.lineWidth = 1.4;
            ctx!.beginPath();
            ctx!.moveTo(points[i].x, points[i].y);
            ctx!.lineTo(pointer.x, pointer.y);
            ctx!.stroke();
          }
        }
      }

      // Draw nodes — each twinkles (radius + opacity oscillate) so the field
      // visibly animates on its own, plus a soft glow to read over the mesh.
      ctx!.shadowBlur = 12;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const color = n.teal ? TEAL : GREEN;
        const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(t * n.twSpeed + n.phase);
        ctx!.fillStyle = `rgba(${color}, ${NODE_ALPHA * tw})`;
        ctx!.shadowColor = `rgba(${color}, 0.95)`;
        ctx!.beginPath();
        ctx!.arc(points[i].x, points[i].y, n.r * (0.85 + 0.15 * tw), 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;
    }

    function step() {
      t += 1;
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0) n.x += width;
        else if (n.x > width) n.x -= width;
        if (n.y < 0) n.y += height;
        else if (n.y > height) n.y -= height;
      }
      draw();
      rafId = window.requestAnimationFrame(step);
    }

    function onPointerMove(e: PointerEvent) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.tx = (e.clientX - width / 2) * -0.025;
      pointer.ty = (e.clientY - height / 2) * -0.025;
    }
    function onPointerLeave() {
      pointer.x = -1;
      pointer.y = -1;
      pointer.tx = 0;
      pointer.ty = 0;
    }
    function onResize() {
      window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(resize);
    }
    function onVisibility() {
      if (document.hidden) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!rafId) {
        rafId = window.requestAnimationFrame(step);
      }
    }

    resize();

    if (reducedMotion) {
      // Single static frame — no animation, no parallax.
      draw();
      window.addEventListener("resize", onResize);
      return () => {
        window.cancelAnimationFrame(resizeRaf);
        window.removeEventListener("resize", onResize);
      };
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    rafId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="network-constellation pointer-events-none fixed inset-0 -z-10"
    />
  );
}
