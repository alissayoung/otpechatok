"use client";
// Запись дня: текст → фото → песня → (погода) → анализ → страница дневника.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { analyzeAudio, guessAudio } from "@/lib/audio";
import { analyzePhoto, depthMap, downscale } from "@/lib/photo";
import { saveDay } from "@/lib/store";
import { buildVector } from "@/lib/vector";
import type { Day, PhotoInfo, SongInfo, TextAnalysis, WeatherInfo } from "@/lib/types";

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const WMO: Record<number, string> = { 0: "ясно", 1: "почти ясно", 2: "облачно", 3: "пасмурно", 45: "туман", 48: "туман", 51: "морось", 61: "дождь", 63: "дождь", 65: "ливень", 71: "снег", 73: "снег", 75: "снегопад", 80: "ливень", 95: "гроза" };

async function getWeather(date: string): Promise<WeatherInfo | undefined> {
  const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
  const { latitude: la, longitude: lo } = pos.coords;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(2)}&longitude=${lo.toFixed(2)}&daily=weather_code,temperature_2m_max&past_days=31&forecast_days=1&timezone=auto`).then((x) => x.json());
  const i = (r?.daily?.time ?? []).indexOf(date);
  if (i < 0) return undefined;
  const code = r.daily.weather_code[i];
  return { code, tempMax: r.daily.temperature_2m_max[i], label: WMO[code] ?? "переменно" };
}

export default function NewDay() {
  const router = useRouter();
  const [date, setDate] = useState(today());
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [song, setSong] = useState("");
  const [songFile, setSongFile] = useState<File | null>(null);
  const [weather, setWeather] = useState(false);
  const [steps, setSteps] = useState<{ label: string; done: boolean }[]>([]);
  const [error, setError] = useState("");
  const busy = steps.length > 0 && !error;

  const step = (label: string) => setSteps((s) => [...s.map((x) => ({ ...x, done: true })), { label, done: false }]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (text.trim().length < 10) return setError("Расскажите о дне хотя бы парой предложений.");
    if (!files.length) return setError("Нужна хотя бы одна фотография дня.");
    if (!song.trim() && !songFile) return setError("Добавьте песню дня — ссылкой, названием или файлом.");

    try {
      setSteps([]);
      // 1. Песня
      step("Слушаю песню: темп, лад, энергия");
      let songInfo: SongInfo;
      if (songFile) {
        const features = await analyzeAudio(await songFile.arrayBuffer()).catch(() => guessAudio(songFile.name));
        songInfo = { input: songFile.name, title: (song.trim() || songFile.name.replace(/\.[^.]+$/, "")), source: "file", features };
      } else {
        const meta = await fetch(`/api/song?q=${encodeURIComponent(song.trim())}`).then((r) => r.json()).catch(() => ({ found: false }));
        if (meta.found && meta.hasPreview) {
          const buf = await fetch(`/api/song/audio?id=${meta.deezerId}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()));
          const features = await analyzeAudio(buf, meta.bpm).catch(() => guessAudio(`${meta.artist} ${meta.title}`, meta.bpm));
          songInfo = { input: song.trim(), link: meta.link, artist: meta.artist, title: meta.title, year: meta.year, deezerId: meta.deezerId, cover: meta.cover, source: "deezer", features };
        } else {
          songInfo = { input: song.trim(), link: /^https?:/.test(song) ? song.trim() : undefined, title: song.trim(), source: "text", features: guessAudio(song) };
        }
      }
      const songDesc = songInfo.artist ? `${songInfo.artist} — ${songInfo.title}${songInfo.year ? ` (${songInfo.year})` : ""}` : songInfo.title || songInfo.input;

      // 2. Текст + фото параллельно
      step("Читаю запись и придумываю название папки");
      const textP: Promise<TextAnalysis> = fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, date, song: songDesc }),
      }).then((r) => r.json());

      step(`Смотрю фото: цвет, свет, глубина (${files.length})`);
      const photoBlobs: Blob[] = [], depthBlobs: Blob[] = [], photos: PhotoInfo[] = [];
      for (const [i, f] of files.slice(0, 6).entries()) {
        console.info("[photo]", i, "downscale");
        const { blob, img } = await downscale(f);
        console.info("[photo]", i, "palette");
        const info = analyzePhoto(img);
        const d = await depthMap(blob, img);
        console.info("[photo]", i, "done");
        photoBlobs.push(blob); depthBlobs.push(d.blob);
        photos.push({ ...info, hasDepthModel: d.model });
      }

      let w: WeatherInfo | undefined;
      if (weather) {
        step("Узнаю погоду этого дня");
        w = await getWeather(date).catch(() => undefined);
      }

      const analysis = await textP;
      if ((analysis as any).error) throw new Error((analysis as any).error);

      // 3. Визуальная система
      step("Собираю страницу по правилам визуальной системы");
      const { vector, weights, explain, voice } = buildVector(analysis, songInfo, photos, w);
      if (analysis.source === "heuristic") explain.push("Текст разобран словарём (ключ Claude не подключён)");
      if (photos.some((p) => p.hasDepthModel)) explain.push("Глубина фото — нейросеть Depth Anything V2"); else explain.push("Глубина фото — псевдо-глубина по яркости и перспективе");

      const day: Day = {
        id: `${date.replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        date, text, title: analysis.title, caption: analysis.caption,
        analysis, song: songInfo, photos, weather: w, vector, weights, explain, voice,
        hasAudioFile: Boolean(songFile),
      };
      step("Сохраняю папку дня");
      await saveDay(day, { photos: photoBlobs, depths: depthBlobs, audio: songFile ?? undefined });
      router.push(`/day/${day.id}`);
    } catch (err: any) {
      console.error(err);
      setError(`Что-то пошло не так: ${err?.message || err}. Попробуйте ещё раз.`);
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <Link href="/" className="logo">Отпечаток<small>← к архиву</small></Link>
      </header>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label className="eyebrow" htmlFor="date">Дата</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} />
        </div>

        <div className="field">
          <label className="eyebrow" htmlFor="text">Как прошёл день</label>
          <textarea id="text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали…" />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Пишите конкретно: погода, свет, запахи, звуки, кто был рядом.</div>
        </div>

        <div className="field">
          <span className="eyebrow">Фото дня (1–6)</span>
          <label className="drop" style={{ marginTop: 8 }}>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))} />
            {files.length ? `Выбрано: ${files.length}` : "Выбрать фотографии"}
          </label>
          <div className="thumbs">{files.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" />)}</div>
        </div>

        <div className="field">
          <label className="eyebrow" htmlFor="song">Песня дня</label>
          <input id="song" type="text" value={song} onChange={(e) => setSong(e.target.value)}
            placeholder="Ссылка Spotify / YouTube / Deezer или «Frank Sinatra — Autumn Leaves»" />
          <div className="row" style={{ marginTop: 8 }}>
            <label className="btn" style={{ fontSize: 12 }}>
              <input type="file" accept="audio/*" hidden onChange={(e) => setSongFile(e.target.files?.[0] ?? null)} />
              {songFile ? `Файл: ${songFile.name}` : "или свой аудиофайл"}
            </label>
            <span className="muted" style={{ fontSize: 12 }}>По ссылке звучит официальное 30-секундное превью.</span>
          </div>
        </div>

        <label className="row" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={weather} onChange={(e) => setWeather(e.target.checked)} />
          Добавить погоду этого дня (спросит геолокацию, координаты не сохраняются)
        </label>

        <div className="row">
          <button className="btn solid" disabled={busy}>{busy ? "Собираю воспоминание…" : "Превратить день в воспоминание"}</button>
        </div>

        {steps.length > 0 && (
          <ul className="steps">{steps.map((s, i) => <li key={i} className={s.done ? "done" : ""}>{s.label}</li>)}</ul>
        )}
        {error && <p className="err">{error}</p>}
        <p className="muted" style={{ fontSize: 12 }}>
          Настроение система оценивает как художественную интерпретацию, а не психологическую диагностику.
        </p>
      </form>
    </main>
  );
}
