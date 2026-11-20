// Постоянные элементы страницы, нарисованные на 2D-холсте и наложенные в шейдере:
// дата, режим, название папки, рукописная подпись и «Партитура дня».
import { MODE_LABELS, type Day } from "./types";
import { topMode } from "./vector";

export interface Layout {
  // в долях страницы, y сверху вниз
  winX0: number; winX1: number; winTop: number; winBottom: number;
}

export function computeLayout(day: Day): Layout {
  const v = day.vector;
  const w = day.weights;
  const wf = Math.max(0.56, Math.min(0.88, 0.62 + 0.26 * (0.5 * v.intimacy + 0.5 * v.density) - 0.14 * w.ma));
  const hFrac = (wf * 9) / (0.8 * 16);
  const top = 0.1;
  return { winX0: (1 - wf) / 2, winX1: 1 - (1 - wf) / 2, winTop: top, winBottom: top + hFrac };
}

export function paperColors(day: Day): { paper: string; ink: string; accent: string; dark: boolean } {
  const dark = day.weights.nocturne > 0.4 || day.analysis.timeOfDay === "night";
  const pal = day.photos[0]?.palette ?? ["#888888", "#aa7744", "#557799", "#cc9966", "#334455"];
  const accent = [...pal].sort((a, b) => chroma(b) - chroma(a))[0];
  const mixHex = (a: string, b: string, t: number) => {
    const pa = hexRgb(a), pb = hexRgb(b);
    return "#" + pa.map((x, i) => Math.round(x * (1 - t) + pb[i] * t).toString(16).padStart(2, "0")).join("");
  };
  return dark
    ? { paper: mixHex("#14161b", pal[0], 0.12), ink: "#ece6da", accent: mixHex(accent, "#ffffff", 0.25), dark }
    : { paper: mixHex("#f3eee4", pal[0], 0.1), ink: "#1d1b18", accent: mixHex(accent, "#000000", 0.15), dark };
}

export function hexRgb(h: string): number[] {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function chroma(h: string) {
  const [r, g, b] = hexRgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const WEEK = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function drawOverlay(c: HTMLCanvasElement, day: Day, layout: Layout, progress: number) {
  const ctx = c.getContext("2d")!;
  const W = c.width, H = c.height;
  const { ink, accent } = paperColors(day);
  ctx.clearRect(0, 0, W, H);
  const m = W * 0.06;
  const u = W / 100; // единица типографики

  // Дата и режим — моноширинный шрифт
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.85;
  ctx.font = `500 ${2.6 * u}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "alphabetic";
  const d = new Date(day.date + "T12:00:00");
  const dateStr = `${day.date.split("-").reverse().join(".")} · ${WEEK[d.getDay()] ?? ""}`;
  ctx.fillText(dateStr, m, H * 0.06);
  const mode = MODE_LABELS[topMode(day.weights)];
  ctx.textAlign = "right";
  ctx.fillText(mode.name.toUpperCase(), W - m, H * 0.06);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;

  // Название папки — антиквa
  let y = H * (layout.winBottom + 0.055);
  ctx.font = `600 ${6.4 * u}px "Cormorant Garamond", Georgia, serif`;
  const titleLines = wrap(ctx, day.title, W - 2 * m).slice(0, 2);
  for (const line of titleLines) { ctx.fillText(line, m, y); y += 6.6 * u; }

  // Рукописная подпись
  ctx.fillStyle = accent;
  ctx.font = `500 ${4.6 * u}px "Caveat", cursive`;
  const capLines = wrap(ctx, day.caption, W - 2 * m - 3 * u);
  const cap = (capLines[0] ?? "") + (capLines.length > 1 ? "…" : "");
  ctx.fillText(cap, m, y + 0.5 * u);

  // «Партитура дня»: волна песни + кривая настроения + плейхед
  const top = H * 0.885, bot = H * 0.955, ph = bot - top;
  const x0 = m, x1 = W - m, pw = x1 - x0;
  const wave = day.song.features.waveform;
  ctx.fillStyle = ink;
  for (let i = 0; i < wave.length; i++) {
    const x = x0 + (i / wave.length) * pw;
    const h = Math.max(1, wave[i] * ph * 0.8);
    ctx.globalAlpha = i / wave.length < progress ? 0.75 : 0.28;
    ctx.fillRect(x, top + ph / 2 - h / 2, Math.max(1, (pw / wave.length) * 0.55), h);
  }
  ctx.globalAlpha = 1;
  const arc = day.analysis.arc;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, 0.55 * u);
  ctx.lineJoin = "round";
  ctx.beginPath();
  const steps = 60;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const fi = t * (arc.length - 1);
    const i0 = Math.floor(fi), i1 = Math.min(arc.length - 1, i0 + 1);
    const k = fi - i0, k2 = (1 - Math.cos(k * Math.PI)) / 2;
    const v = arc[i0] * (1 - k2) + arc[i1] * k2;
    const x = x0 + t * pw, yy = bot - v * ph;
    s ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
  }
  ctx.stroke();
  if (progress > 0) {
    ctx.fillStyle = accent;
    ctx.fillRect(x0 + progress * pw - 1, top - 0.6 * u, 2, ph + 1.2 * u);
  }

  // Подписи под партитурой
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.7;
  ctx.font = `400 ${2.2 * u}px "JetBrains Mono", monospace`;
  const s = day.song;
  const songLabel = s.artist ? `♪ ${s.artist} — ${s.title}` : `♪ ${s.title || s.input || "без песни"}`;
  ctx.fillText(songLabel.length > 42 ? songLabel.slice(0, 41) + "…" : songLabel, x0, H * 0.978);
  ctx.textAlign = "right";
  const f = s.features;
  ctx.fillText(`${f.bpm} BPM · ${f.key} ${f.mode === "major" ? "maj" : "min"}`, x1, H * 0.978);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}
