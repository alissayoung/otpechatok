// Анализ фото в браузере: уменьшение, палитра (k-means), яркость, теплота, насыщенность,
// карта глубины (Depth Anything V2 через transformers.js, иначе псевдо-глубина).
import type { PhotoInfo } from "./types";

export async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return img;
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

const toBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.88) =>
  new Promise<Blob>((res) => c.toBlob((b) => res(b!), type, q));

/** Уменьшает фото до 1600 px по длинной стороне */
export async function downscale(file: Blob, max = 1600): Promise<{ blob: Blob; img: HTMLImageElement }> {
  const img = await loadImage(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = canvasOf(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await toBlob(c);
  return { blob, img: await loadImage(blob) };
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function analyzePhoto(img: HTMLImageElement): Omit<PhotoInfo, "hasDepthModel"> {
  const S = 64;
  const c = canvasOf(S, S);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const px: number[][] = [];
  let lum = 0, warm = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    px.push([r, g, b]);
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    warm += (r - b) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
  }
  const n = px.length;

  // k-means, 5 кластеров
  const K = 5;
  let cent = Array.from({ length: K }, (_, k) => px[Math.floor(((k + 0.5) / K) * n)].slice());
  const assign = new Array(n).fill(0);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < n; i++) {
      let bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dd = (px[i][0] - cent[k][0]) ** 2 + (px[i][1] - cent[k][1]) ** 2 + (px[i][2] - cent[k][2]) ** 2;
        if (dd < bd) { bd = dd; assign[i] = k; }
      }
    }
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sum[assign[i]];
      s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
    }
    cent = sum.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3], s[3]] : [...cent[k].slice(0, 3), 0]));
  }
  const palette = cent.sort((a, b) => (b[3] ?? 0) - (a[3] ?? 0)).map((c) => hex(c[0], c[1], c[2]));

  return {
    palette,
    brightness: lum / n / 255,
    warmth: Math.max(0, Math.min(1, 0.5 + (warm / n) * 1.6)),
    saturation: sat / n,
  };
}

/** Псевдо-глубина: размытая яркость + «низ кадра ближе» */
function pseudoDepth(img: HTMLImageElement): HTMLCanvasElement {
  const w = 256, h = Math.round((256 * img.naturalHeight) / img.naturalWidth);
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = "blur(6px) grayscale(1)";
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = "none";
  const id = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = 0.55 * (y / h) * 255 + 0.45 * id.data[i];
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

let depthPipe: Promise<any> | null = null;

async function modelDepth(blob: Blob): Promise<HTMLCanvasElement | null> {
  try {
    if (!depthPipe) {
      depthPipe = (async () => {
        const url = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
        const tf: any = await import(/* webpackIgnore: true */ url);
        return tf.pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", { dtype: "q8" });
      })();
    }
    const pipe = await Promise.race([depthPipe, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 45000))]);
    console.info("[depth] model ready");
    const url = URL.createObjectURL(blob);
    const out: any = await (pipe as any)(url);
    URL.revokeObjectURL(url);
    // RawImage (1 канал) → обычный canvas
    const dimg = out.depth;
    const c = canvasOf(dimg.width, dimg.height);
    const ctx = c.getContext("2d")!;
    const id = ctx.createImageData(dimg.width, dimg.height);
    const ch = dimg.channels || 1;
    for (let i = 0, n = dimg.width * dimg.height; i < n; i++) {
      const v = dimg.data[i * ch];
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  } catch (e) {
    console.warn("Depth model unavailable, using pseudo depth", e);
    depthPipe = null;
    return null;
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

export async function depthMap(blob: Blob, img: HTMLImageElement): Promise<{ blob: Blob; model: boolean }> {
  console.info("[depth] start");
  const m = await withTimeout(modelDepth(blob), 60000, null);
  console.info("[depth] model:", Boolean(m));
  const c = m ?? pseudoDepth(img);
  const out = await withTimeout(toBlob(c, "image/png"), 15000, null);
  console.info("[depth] png", Boolean(out));
  return { blob: out ?? (await toBlob(pseudoDepth(img), "image/png")), model: Boolean(m && out) };
}
