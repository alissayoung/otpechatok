// Правила визуальной системы: текст + фото + музыка → вектор атмосферы → веса художественных режимов.
// Каждое правило оставляет строчку в «Почему так?», поэтому вид дня всегда объясним.
import { MODES, MODE_LABELS, type AtmosphereVector, type AudioFeatures, type ModeWeights, type PhotoInfo, type SongInfo, type TextAnalysis, type WeatherInfo } from "./types";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => Math.round(v * 100);
const avg = (xs: number[], d = 0.5) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : d);

export function buildVector(a: TextAnalysis, song: SongInfo, photos: PhotoInfo[], weather?: WeatherInfo) {
  const f: AudioFeatures = song.features;
  const explain: string[] = [];
  const year = new Date().getFullYear();

  const photoBright = avg(photos.map((p) => p.brightness));
  const photoWarm = avg(photos.map((p) => p.warmth));
  const photoSat = avg(photos.map((p) => p.saturation), 0.4);

  // Лад: мажор тянет вверх, минор вниз, сила зависит от уверенности анализа
  const modeVal = f.mode === "major" ? 0.5 + 0.3 * f.modeClarity + 0.1 : 0.5 - 0.3 * f.modeClarity - 0.1;
  const valence = clamp(0.6 * a.valence + 0.3 * modeVal + 0.1 * photoBright);
  explain.push(`Тон дня ${pct(valence)}%: текст ${pct(a.valence)}% × 0.6 + ${f.mode === "major" ? "мажор" : "минор"} (${f.key}) × 0.3 + яркость фото ${pct(photoBright)}% × 0.1`);

  const tempo = clamp((f.bpm - 60) / 110);
  const energy = clamp(0.5 * a.energy + 0.3 * tempo + 0.2 * f.energy);
  explain.push(`Энергия ${pct(energy)}%: текст ${pct(a.energy)}% + темп ${f.bpm} BPM + громкость песни ${pct(f.energy)}%`);

  let wW = 0;
  if (weather) wW = weather.tempMax > 18 ? 0.15 : weather.tempMax < 3 ? -0.15 : 0;
  const warmth = clamp(0.45 * photoWarm + 0.45 * a.warmth + 0.1 * (0.5 + f.brightness * 0.3) + wW);
  explain.push(`Теплота ${pct(warmth)}%: цвета фото ${pct(photoWarm)}% и слова текста ${pct(a.warmth)}%${weather ? `, погода ${weather.label}, ${Math.round(weather.tempMax)}°` : ""}`);

  const songAge = song.year ? year - song.year : 0;
  const nostalgia = clamp(Math.max(a.nostalgia, songAge > 15 ? 0.45 + Math.min(0.4, songAge / 80) : 0));
  if (songAge > 15) explain.push(`Песне ${songAge} лет — ностальгия ${pct(nostalgia)}%, включается плёнка`);

  const density = clamp(0.75 * a.density + 0.25 * Math.min(1, photos.length / 5));
  const intimacy = clamp(a.intimacy);

  const v: AtmosphereVector = { valence, energy, warmth, intimacy, nostalgia, density };

  // Веса режимов: у каждого режима своя «зона» в пространстве вектора
  const raw: ModeWeights = {
    impression: (1 - energy) * (0.4 + valence) * (0.4 + warmth),
    composition: energy ** 1.5 * (1.3 - valence * 0.6) * (1.2 - warmth * 0.5),
    cutouts: energy * valence ** 1.4 * (0.6 + photoSat),
    nocturne: (1 - valence) * (1 - energy * 0.8) * (1.1 - warmth * 0.4),
    film: nostalgia * 1.3 + intimacy * 0.25,
    ma: (1 - intimacy) * (1 - density) * (1 - energy * 0.7) * 1.1,
  };
  const sharp = 2.2; // усиливает доминирующий режим, но оставляет смешение
  const pow = MODES.map((m) => Math.pow(Math.max(0.0001, raw[m]), sharp));
  const sum = pow.reduce((s, x) => s + x, 0);
  const weights = Object.fromEntries(MODES.map((m, i) => [m, pow[i] / sum])) as ModeWeights;

  const ranked = [...MODES].sort((x, y) => weights[y] - weights[x]);
  const top = ranked[0], second = ranked[1];
  explain.push(`Главный режим — «${MODE_LABELS[top].name}» (${MODE_LABELS[top].ref}), ${pct(weights[top])}%: ${MODE_LABELS[top].why}`);
  if (weights[second] > 0.12) explain.push(`Примешан «${MODE_LABELS[second].name}» ${pct(weights[second])}%: ${MODE_LABELS[second].why}`);

  if (f.mode === "minor" && f.bpm < 90) explain.push(`Медленная минорная песня → больше пустого поля и приглушённые цвета`);
  if (energy > 0.65) explain.push(`Высокая энергия → смена кадров каждые 2 такта, резкие переходы`);
  else explain.push(`Спокойный темп → смена кадров каждые 4 такта, долгие растворения`);
  if (a.particles !== "none") explain.push(`В тексте «${PARTICLE_TEXT[a.particles]}» → в воздухе ${PARTICLE_AIR[a.particles]}`);
  if (intimacy > 0.6) explain.push(`Рядом были люди → кадр крупнее, вокруг фото меньше пустоты`);
  if (density < 0.3) explain.push(`Тихий день → фото занимает меньше страницы, больше воздуха`);

  // Голос озвучки по правилам системы
  const rate = energy < 0.4 ? 0.88 : energy > 0.7 ? 1.12 : 1;
  const pitch = 0.9 + valence * 0.25;
  const voiceLabel = energy < 0.4 ? "тихий и тёплый, с паузами" : energy > 0.7 ? "живой и быстрый" : "ровный, разговорный";
  explain.push(`Голос: ${voiceLabel} (скорость ${rate}, высота ${pitch.toFixed(2)})`);

  return { vector: v, weights, explain, voice: { rate, pitch: Number(pitch.toFixed(2)), label: voiceLabel } };
}

const PARTICLE_TEXT = { leaves: "листья, осень", snow: "снег", rain: "дождь", dust: "свет", petals: "цветы, весна", none: "" };
const PARTICLE_AIR = { leaves: "падают листья", snow: "медленный снег", rain: "косой дождь", dust: "пылинки в луче света", petals: "летят лепестки", none: "" };

export function topMode(w: ModeWeights) {
  return [...MODES].sort((x, y) => w[y] - w[x])[0];
}
