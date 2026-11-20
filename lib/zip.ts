// «Папка дня»: всё, что относится к дню, в одном ZIP с названием, которое придумала система.
import JSZip from "jszip";
import { MODE_LABELS, MODES, type Day, type DayMedia } from "./types";

export const folderName = (day: Day) => `${day.date} ${day.title}`.replace(/[\\/:*?"<>|]+/g, "").trim();

export async function buildFolderZip(day: Day, media: DayMedia, extras: { snapshot?: Blob; video?: Blob }) {
  const zip = new JSZip();
  const root = zip.folder(folderName(day))!;
  root.file("запись.txt", `${day.title}\n${day.date}\n\n${day.text}\n`);

  const photos = root.folder("фото")!;
  const depth = root.folder("глубина")!;
  await Promise.all(
    media.photos.map(async (u, i) => {
      photos.file(`фото-${i + 1}.jpg`, await fetch(u).then((r) => r.blob()));
      if (media.depths[i]) depth.file(`глубина-${i + 1}.png`, await fetch(media.depths[i]).then((r) => r.blob()));
    }),
  );

  const s = day.song, f = s.features;
  root.file(
    "песня.txt",
    [
      `${s.artist ?? ""}${s.artist ? " — " : ""}${s.title ?? s.input}`,
      s.year ? `Год: ${s.year}` : "",
      s.link ? `Ссылка: ${s.link}` : "",
      `Темп: ${f.bpm} BPM · ${f.key} ${f.mode === "major" ? "мажор" : "минор"} · энергия ${Math.round(f.energy * 100)}%`,
      f.analyzed ? "Признаки получены аудиоанализом." : "Признаки оценены по описанию песни.",
      s.source === "deezer" ? "Сама песня не хранится: звучит официальное 30-секундное превью по ссылке." : "",
    ].filter(Boolean).join("\n"),
  );
  if (s.source === "file" && media.audioUrl) root.file("песня-файл", await fetch(media.audioUrl).then((r) => r.blob()));

  root.file(
    "озвучка.txt",
    `Голос: ${day.voice.label}\nСкорость ${day.voice.rate}, высота ${day.voice.pitch}\n\nТекст для озвучки:\n${day.title}. ${day.text}\n`,
  );
  root.file(
    "почему-так.txt",
    [
      "Вектор атмосферы:",
      ...Object.entries(day.vector).map(([k, v]) => `  ${k}: ${Math.round(v * 100)}%`),
      "",
      "Художественные режимы:",
      ...MODES.map((m) => `  ${MODE_LABELS[m].name} (${MODE_LABELS[m].ref}): ${Math.round(day.weights[m] * 100)}%`),
      "",
      "Правила, которые сработали:",
      ...day.explain.map((e) => `  — ${e}`),
    ].join("\n"),
  );
  root.file("день.json", JSON.stringify(day, null, 2));
  if (extras.snapshot) root.file("воспоминание.png", extras.snapshot);
  if (extras.video) root.file(`воспоминание.${extras.video.type.includes("mp4") ? "mp4" : "webm"}`, extras.video);

  return zip.generateAsync({ type: "blob" });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
