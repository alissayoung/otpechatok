"use client";
// Живая страница дня: three.js + шейдер, музыка через Web Audio управляет светом и ритмом.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { FRAG, VERT } from "@/lib/shader";
import { computeLayout, drawOverlay, hexRgb, paperColors } from "@/lib/overlay";
import type { Day, DayMedia } from "@/lib/types";

export interface SceneHandle {
  play: () => Promise<void>;
  pause: () => void;
  isPlaying: () => boolean;
  record: (seconds: number, onTick?: (s: number) => void) => Promise<Blob>;
  snapshot: () => Promise<Blob>;
}

const PARTICLE_ID = { none: 0, leaves: 1, snow: 2, rain: 3, dust: 4, petals: 5 } as const;
const v3 = (h: string) => new THREE.Vector3(...hexRgb(h).map((x) => x / 255));

interface Props { day: Day; media: DayMedia; audioSrc?: string; onPlayState?: (p: boolean) => void }

const Scene = forwardRef<SceneHandle, Props>(function Scene({ day, media, audioSrc, onPlayState }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ ctx: AudioContext; analyser: AnalyserNode; dest: MediaStreamAudioDestinationNode } | null>(null);

  useImperativeHandle(ref, () => ({
    async play() {
      const a = audioRef.current;
      if (!a) return;
      ensureGraph();
      await graph.current?.ctx.resume();
      await a.play().catch(() => {});
      onPlayState?.(true);
    },
    pause() { audioRef.current?.pause(); onPlayState?.(false); },
    isPlaying: () => Boolean(audioRef.current && !audioRef.current.paused),
    async record(seconds, onTick) {
      const canvas = canvasRef.current!;
      ensureGraph();
      const a = audioRef.current;
      if (a) { a.currentTime = 0; await graph.current?.ctx.resume(); await a.play().catch(() => {}); onPlayState?.(true); }
      const stream = canvas.captureStream(30);
      graph.current?.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const types = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm"];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<Blob>((res) => (rec.onstop = () => res(new Blob(chunks, { type: mimeType.split(";")[0] || "video/webm" }))));
      rec.start(250);
      for (let s = 0; s < seconds; s++) { onTick?.(seconds - s); await new Promise((r) => setTimeout(r, 1000)); }
      rec.stop();
      return done;
    },
    snapshot: () => new Promise<Blob>((res) => canvasRef.current!.toBlob((b) => res(b!), "image/png")),
  }));

  function ensureGraph() {
    const a = audioRef.current;
    if (!a || graph.current) return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    const src = ctx.createMediaElementSource(a);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    const dest = ctx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(ctx.destination);
    analyser.connect(dest);
    graph.current = { ctx, analyser, dest };
  }

  useEffect(() => {
    if (!audioSrc) return;
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = audioSrc;
    a.loop = true;
    a.preload = "auto";
    audioRef.current = a;
    return () => { a.pause(); a.src = ""; graph.current?.ctx.close().catch(() => {}); graph.current = null; };
  }, [audioSrc]);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const layout = computeLayout(day);
    const colors = paperColors(day);
    const pal = [...(day.photos[0]?.palette ?? []), "#777777", "#999999", "#555555", "#bbbbbb", "#333333"].slice(0, 5);
    const w = day.weights;

    const overlay = document.createElement("canvas");
    const overlayTex = new THREE.CanvasTexture(overlay);
    const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    blank.needsUpdate = true;

    const uniforms: Record<string, THREE.IUniform> = {
      uTex0: { value: blank }, uTex1: { value: blank }, uDep0: { value: blank }, uDep1: { value: blank },
      uOverlay: { value: overlayTex },
      uAsp0: { value: 1 }, uAsp1: { value: 1 }, uMix: { value: 0 }, uTime: { value: 0 },
      uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 },
      uEnergy: { value: day.vector.energy }, uValence: { value: day.vector.valence }, uWarmth: { value: day.vector.warmth },
      uNostalgia: { value: day.vector.nostalgia },
      uSeed: { value: (parseInt(day.id.replace(/\D/g, "").slice(-6) || "7", 10) % 997) / 31 },
      uRes: { value: new THREE.Vector2(1, 1) }, uMouse: { value: new THREE.Vector2(0, 0) },
      uWin: { value: new THREE.Vector4(layout.winX0, 1 - layout.winBottom, layout.winX1, 1 - layout.winTop) },
      uWA: { value: new THREE.Vector3(w.impression, w.composition, w.cutouts) },
      uWB: { value: new THREE.Vector3(w.nocturne, w.film, w.ma) },
      uP0: { value: v3(pal[0]) }, uP1: { value: v3(pal[1]) }, uP2: { value: v3(pal[2]) }, uP3: { value: v3(pal[3]) }, uP4: { value: v3(pal[4]) },
      uPaper: { value: v3(colors.paper) }, uInk: { value: v3(colors.ink) },
      uParticles: { value: PARTICLE_ID[day.analysis.particles] ?? 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    // Текстуры фото и глубины
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const photos: THREE.Texture[] = [], depths: THREE.Texture[] = [], asps: number[] = [];
    media.photos.forEach((url, i) => {
      loader.load(url, (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.minFilter = THREE.LinearFilter;
        photos[i] = t;
        asps[i] = t.image.width / t.image.height;
        if (i === 0) { uniforms.uTex0.value = t; uniforms.uAsp0.value = asps[0]; }
      });
      if (media.depths[i]) loader.load(media.depths[i], (t) => { depths[i] = t; if (i === 0) uniforms.uDep0.value = t; });
    });

    // Размер под рамку 9:16
    let W = 1, H = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = Math.max(2, Math.round(r.width)); H = Math.max(2, Math.round(r.height));
      renderer.setSize(W, H, false);
      uniforms.uRes.value.set(W * dpr, H * dpr);
      overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
      redrawOverlay(0);
    };
    let lastProgress = -1;
    const redrawOverlay = (p: number) => {
      if (Math.abs(p - lastProgress) < 0.004 && lastProgress >= 0) return;
      lastProgress = p;
      drawOverlay(overlay, day, layout, p);
      overlayTex.needsUpdate = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    document.fonts?.ready.then(() => { lastProgress = -1; redrawOverlay(0); });

    // Мышь и гироскоп → параллакс
    const target = new THREE.Vector2();
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      target.set(((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2);
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.set(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 30)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("deviceorientation", onTilt);

    // Ритм смены кадров по такту песни
    const bpm = day.song.features.bpm || 100;
    const bar = (4 * 60) / bpm;
    const hold = (day.vector.energy > 0.65 ? 2 : 4) * bar;
    const fade = day.vector.energy > 0.65 ? 0.35 : Math.min(3, bar * 1.2);
    let cur = 0, nextAt = hold, fading = -1;

    const freq = new Uint8Array(256);
    let lowAvg = 0.2, beat = 0, raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      uniforms.uTime.value = t;
      uniforms.uMouse.value.lerp(target, 0.05);

      const a = audioRef.current;
      const g = graph.current;
      let low = 0, mid = 0, high = 0;
      if (g && a && !a.paused) {
        g.analyser.getByteFrequencyData(freq);
        const band = (s: number, e: number) => { let x = 0; for (let i = s; i < e; i++) x += freq[i]; return x / (e - s) / 255; };
        low = band(1, 8); mid = band(8, 40); high = band(40, 120);
        if (low > lowAvg * 1.25 && low > 0.3) beat = 1;
        lowAvg = lowAvg * 0.95 + low * 0.05;
        redrawOverlay(a.duration ? a.currentTime / a.duration : 0);
      } else {
        // Без звука — тихий метроном по BPM песни
        const ph = (t * bpm) / 60;
        beat = Math.max(beat, Math.pow(1 - (ph % 1), 6) * 0.35);
        low = 0.15 + 0.1 * Math.sin(t * 0.8);
      }
      beat *= Math.pow(0.02, dt);
      uniforms.uLow.value += (low - uniforms.uLow.value) * 0.2;
      uniforms.uMid.value += (mid - uniforms.uMid.value) * 0.2;
      uniforms.uHigh.value += (high - uniforms.uHigh.value) * 0.2;
      uniforms.uBeat.value = beat;

      // Смена фото
      const n = media.photos.length;
      if (n > 1) {
        if (fading < 0 && t >= nextAt) {
          const nx = (cur + 1) % n;
          if (photos[nx]) {
            uniforms.uTex1.value = photos[nx]; uniforms.uAsp1.value = asps[nx];
            uniforms.uDep1.value = depths[nx] || blank;
            fading = 0;
          } else nextAt = t + 0.5;
        }
        if (fading >= 0) {
          fading += dt / fade;
          const k = Math.min(1, fading);
          uniforms.uMix.value = k * k * (3 - 2 * k);
          if (k >= 1) {
            cur = (cur + 1) % n;
            uniforms.uTex0.value = photos[cur]; uniforms.uAsp0.value = asps[cur];
            uniforms.uDep0.value = depths[cur] || blank;
            uniforms.uMix.value = 0; fading = -1; nextAt = t + hold;
          }
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
      photos.forEach((t) => t?.dispose()); depths.forEach((t) => t?.dispose());
      overlayTex.dispose(); mat.dispose(); renderer.dispose();
    };
  }, [day, media]);

  return (
    <div ref={wrapRef} className="scene">
      <canvas ref={canvasRef} />
    </div>
  );
});

export default Scene;
