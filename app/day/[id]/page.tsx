"use client";
// Страница дня: живое воспоминание + озвучка + «Почему так?» + папка дня + видео.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getDay } from "@/lib/store";
import { MODE_LABELS, MODES, type Day, type DayMedia } from "@/lib/types";
import { buildFolderZip, download, folderName } from "@/lib/zip";
import Scene, { type SceneHandle } from "@/components/Scene";

const VEC_LABELS: Record<string, string> = {
  valence: "тон (радость)", energy: "энергия", warmth: "теплота", intimacy: "близость", nostalgia: "ностальгия", density: "насыщенность",
};

export default function DayPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ day: Day; media: DayMedia } | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [rec, setRec] = useState(0);
  const [video, setVideo] = useState<Blob | null>(null);
  const [zipping, setZipping] = useState(false);
  const scene = useRef<SceneHandle>(null);

  useEffect(() => { getDay(id).then(setData).catch(() => setData(null)); return () => speechSynthesis?.cancel(); }, [id]);

  if (data === undefined) return <main className="wrap"><p className="muted">Открываю день…</p></main>;
  if (data === null) return <main className="wrap"><p>Такого дня нет в этом дневнике. <Link href="/">К архиву</Link></p></main>;

  const { day, media } = data;
  const audioSrc = media.audioUrl ?? (day.song.deezerId ? `/api/song/audio?id=${day.song.deezerId}` : undefined);

  const start = async () => { setStarted(true); await scene.current?.play(); };
  const toggle = async () => (playing ? scene.current?.pause() : scene.current?.play());

  const speak = () => {
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(`${day.title}. ${day.text}`);
    const ru = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ru"));
    // Тихий день — первый найденный «мягкий» голос, энергичный — другой, если есть выбор
    u.voice = (day.vector.energy < 0.5 ? ru.find((v) => /female|жен|irina|milena|svetlana/i.test(v.name)) : ru.find((v) => /male|муж|pavel|dmitry|yuri/i.test(v.name))) ?? ru[0] ?? null;
    u.lang = "ru-RU"; u.rate = day.voice.rate; u.pitch = day.voice.pitch; u.volume = 1;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(u);
  };

  const record = async () => {
    if (!scene.current) return;
    setStarted(true);
    const blob = await scene.current.record(15, setRec);
    setRec(0); setVideo(blob);
    download(blob, `${folderName(day)}.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
  };

  const folder = async () => {
    setZipping(true);
    try {
      const snapshot = await scene.current?.snapshot();
      const zip = await buildFolderZip(day, media, { snapshot, video: video ?? undefined });
      download(zip, `${folderName(day)}.zip`);
    } finally { setZipping(false); }
  };

  return (
    <main className="wrap">
      <header className="top">
        <Link href="/" className="logo">Отпечаток<small>← к архиву</small></Link>
        <Link href="/new" className="btn">+ Записать день</Link>
      </header>

      <div className="daylayout">
        <div className="frame">
          <Scene ref={scene} day={day} media={media} audioSrc={audioSrc} onPlayState={setPlaying} />
          {!started && (
            <button className="start" onClick={start} aria-label="Открыть день">
              <span>▶ Открыть день{audioSrc ? " со звуком" : ""}</span>
            </button>
          )}
        </div>

        <aside className="side">
          <div className="eyebrow">Папка дня · {day.date.split("-").reverse().join(".")}{day.weather ? ` · ${day.weather.label}, ${Math.round(day.weather.tempMax)}°` : ""}</div>
          <h1>{day.title}</h1>
          <div className="text">{day.text}</div>

          <div className="controls">
            {audioSrc && <button className="btn" onClick={toggle}>{playing ? "❚❚ Пауза" : "▶ Музыка"}</button>}
            <button className="btn" onClick={speak}>{speaking ? "■ Стоп" : "◖ Озвучка"}</button>
            <button className="btn" onClick={folder} disabled={zipping}>{zipping ? "Собираю…" : "↓ Папка дня"}</button>
            <button className="btn" onClick={record} disabled={rec > 0}>{rec > 0 ? `● Запись ${rec}с` : "● Видео 15с"}</button>
          </div>
          {day.song.link && <p style={{ fontSize: 12 }}><a href={day.song.link} target="_blank" rel="noreferrer">Открыть песню целиком ↗</a></p>}

          <div className="panel">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Почему так?</div>
            <ol className="why">{day.explain.map((e, i) => <li key={i}>{e}</li>)}</ol>
          </div>

          <div className="panel">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Вектор атмосферы</div>
            <div className="bars">
              {Object.entries(day.vector).map(([k, v]) => (
                <div className="bar" key={k}><span>{VEC_LABELS[k]}</span><span className="track"><i style={{ width: `${v * 100}%` }} /></span><span>{Math.round(v * 100)}</span></div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Художественные режимы</div>
            <div className="bars">
              {MODES.map((m) => (
                <div className="bar" key={m} title={MODE_LABELS[m].why}><span>{MODE_LABELS[m].name}</span><span className="track"><i style={{ width: `${day.weights[m] * 100}%`, background: "var(--accent)" }} /></span><span>{Math.round(day.weights[m] * 100)}</span></div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
              Анализ текста: {day.analysis.source === "claude" ? "Claude" : "словарь"}. Песня: {day.song.features.analyzed ? "аудиоанализ" : "оценка по описанию"}.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
