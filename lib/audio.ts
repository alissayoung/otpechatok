// Собственный аудиоанализ в браузере: темп (BPM), тональность и лад, энергия, яркость, волна.
// Без внешних библиотек: БПФ + спектральный поток + автокорреляция + профили Крумхансла.
import type { AudioFeatures } from "./types";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Профили Крумхансла–Кесслер
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db + 1e-9);
}

export async function analyzeAudio(buf: ArrayBuffer, hintBpm = 0): Promise<AudioFeatures> {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  ctx.close();

  const sr = audio.sampleRate;
  const maxLen = Math.min(audio.length, sr * 60);
  const mono = new Float32Array(maxLen);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < maxLen; i++) mono[i] += d[i] / audio.numberOfChannels;
  }

  // волна для «Партитуры»
  const W = 160;
  const waveform: number[] = [];
  const step = Math.floor(maxLen / W);
  let peak = 1e-6;
  for (let i = 0; i < W; i++) {
    let s = 0;
    for (let j = i * step; j < (i + 1) * step; j += 4) s += mono[j] * mono[j];
    const v = Math.sqrt(s / (step / 4));
    waveform.push(v); peak = Math.max(peak, v);
  }
  const wave = waveform.map((v) => v / peak);

  // спектральный анализ
  const N = 2048, hop = 512;
  const frames = Math.floor((maxLen - N) / hop);
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(N / 2);
  const flux: number[] = [];
  const chroma = new Array(12).fill(0);
  let rmsSum = 0, centroidSum = 0, centroidCount = 0;
  const hann = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const x = mono[off + i];
      rms += x * x;
      re[i] = x * hann[i]; im[i] = 0;
    }
    rmsSum += Math.sqrt(rms / N);
    fft(re, im);
    let fl = 0, magSum = 0, wSum = 0;
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const d = mag - prev[k];
      if (d > 0) fl += d;
      prev[k] = mag;
      const freq = (k * sr) / N;
      magSum += mag; wSum += mag * freq;
      if (f % 2 === 0 && freq > 55 && freq < 4200) {
        const midi = 69 + 12 * Math.log2(freq / 440);
        chroma[((Math.round(midi) % 12) + 12) % 12] += mag;
      }
    }
    flux.push(fl);
    if (magSum > 1e-3) { centroidSum += wSum / magSum; centroidCount++; }
  }

  // темп: автокорреляция огибающей атак
  const mean = flux.reduce((s, x) => s + x, 0) / Math.max(1, flux.length);
  const env = flux.map((x) => Math.max(0, x - mean));
  const fps = sr / hop;
  let bestLag = 0, best = -Infinity;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < env.length; i++) s += env[i] * (env[i + l0] * (1 - fr) + env[i + l0 + 1] * fr);
    // мягкий приоритет 80–140 BPM
    s *= 1 - 0.15 * Math.abs(Math.log2(bpm / 110));
    if (s > best) { best = s; bestLag = bpm; }
  }
  let bpm = bestLag || 100;
  if (hintBpm > 40) bpm = hintBpm; // Deezer иногда знает точнее

  // тональность и лад
  let bestKey = 0, bestMode: "major" | "minor" = "major", bestR = -2, secondR = -2;
  for (let k = 0; k < 12; k++) {
    const rot = chroma.slice(k).concat(chroma.slice(0, k));
    for (const [mode, prof] of [["major", MAJOR], ["minor", MINOR]] as const) {
      const r = corr(rot, prof);
      if (r > bestR) { secondR = bestR; bestR = r; bestKey = k; bestMode = mode; }
      else if (r > secondR) secondR = r;
    }
  }

  const rmsAvg = rmsSum / Math.max(1, frames);
  const centroid = centroidSum / Math.max(1, centroidCount);
  const fluxNorm = mean / (rmsAvg * N * 0.5 + 1e-6);

  return {
    bpm: Math.round(bpm),
    key: NOTES[bestKey],
    mode: bestMode,
    modeClarity: Math.max(0, Math.min(1, (bestR - secondR) * 8 + bestR * 0.5)),
    energy: Math.max(0, Math.min(1, rmsAvg * 4.5 * 0.6 + Math.min(1, fluxNorm * 2) * 0.4)),
    brightness: Math.max(0, Math.min(1, (centroid - 800) / 3200)),
    waveform: wave,
    analyzed: true,
  };
}

/** Когда звука нет: признаки по описанию (жанровые слова, BPM из каталога) */
export function guessAudio(desc: string, bpmHint = 0): AudioFeatures {
  const d = desc.toLowerCase();
  const fast = /(techno|техно|drum|dnb|house|хаус|rock|рок|metal|панк|phonk|фонк|edm|рейв|dance)/.test(d);
  const slow = /(jazz|джаз|sinatra|синатр|ballad|баллад|lofi|lo-fi|ambient|эмбиент|piano|пиан|classic|класси)/.test(d);
  const sad = /(sad|грус|minor|минор|tears|слёз|alone|одинок)/.test(d);
  const bpm = bpmHint > 40 ? bpmHint : fast ? 128 : slow ? 76 : 100;
  const wave = Array.from({ length: 160 }, (_, i) => 0.35 + 0.3 * Math.abs(Math.sin(i * 0.21) * Math.cos(i * 0.047)));
  return {
    bpm, key: "C", mode: sad ? "minor" : "major", modeClarity: 0.2,
    energy: fast ? 0.75 : slow ? 0.3 : 0.5, brightness: fast ? 0.6 : 0.4, waveform: wave, analyzed: false,
  };
}
