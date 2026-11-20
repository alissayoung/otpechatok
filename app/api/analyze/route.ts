// Анализ текста дня через Claude: вектор настроения, детали, название папки.
// Без ключа ANTHROPIC_API_KEY возвращает словарный анализ (lib/heuristic.ts).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { heuristicAnalysis } from "@/lib/heuristic";
import type { TextAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const unit = z.number().transform((v) => Math.max(0, Math.min(1, v)));

const Schema = z.object({
  valence: unit,
  energy: unit,
  warmth: unit,
  intimacy: unit,
  nostalgia: unit,
  density: unit,
  season: z.enum(["winter", "spring", "summer", "autumn", "unknown"]),
  timeOfDay: z.enum(["morning", "day", "evening", "night", "unknown"]),
  particles: z.enum(["leaves", "snow", "rain", "dust", "petals", "none"]),
  places: z.array(z.string()),
  people: z.array(z.string()),
  details: z.array(z.string()),
  moodWords: z.array(z.string()),
  arc: z.array(unit),
  title: z.string(),
  caption: z.string(),
});

const str = { type: "string" };
const num = { type: "number" };
const arr = (items: object) => ({ type: "array", items });
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["valence", "energy", "warmth", "intimacy", "nostalgia", "density", "season", "timeOfDay", "particles", "places", "people", "details", "moodWords", "arc", "title", "caption"],
  properties: {
    valence: num, energy: num, warmth: num, intimacy: num, nostalgia: num, density: num,
    season: { type: "string", enum: ["winter", "spring", "summer", "autumn", "unknown"] },
    timeOfDay: { type: "string", enum: ["morning", "day", "evening", "night", "unknown"] },
    particles: { type: "string", enum: ["leaves", "snow", "rain", "dust", "petals", "none"] },
    places: arr(str), people: arr(str), details: arr(str), moodWords: arr(str), arc: arr(num),
    title: str, caption: str,
  },
};

const SYSTEM = `Ты — часть художественного дневника «Отпечаток». Человек описывает свой день, а ты переводишь текст в параметры атмосферы, по которым система рисует воспоминание. Это художественная интерпретация, а не психологическая оценка.

Шкалы от 0 до 1:
- valence: 0 грусть/тяжесть … 1 радость/лёгкость
- energy: 0 покой, медленность … 1 напряжение, скорость, шум
- warmth: 0 холод (погода, свет, отношения) … 1 тепло
- intimacy: 0 человек один … 1 рядом близкие люди
- nostalgia: 0 только настоящее … 1 день про память, прошлое
- density: 0 пустой, тихий день … 1 насыщенный событиями

season и timeOfDay — из текста; если не сказано, unknown. particles — что «висит в воздухе» этого дня: leaves (листопад), snow, rain, dust (пылинки в солнечном или фонарном свете), petals (весна, цветы), none.
places, people — коротко, как в тексте. details — 2–5 сенсорных деталей (свет, запах, звук, вкус), почти дословно из текста. moodWords — 2–4 слова настроения.
arc — тон текста по ходу рассказа: 3–8 чисел от 0 до 1, по одному на смысловой кусок.

title — название папки дня: 3–7 слов, по-русски, с заглавной буквы и без кавычек и точки. Формула: время или сезон + место + главная деталь. Не называй эмоцию прямо. Примеры: «Осенний парк и какао», «Ночь в офисе перед сдачей», «Вечер осенью с девушкой у пруда», «Первый снег по дороге домой», «Утро на кухне под дождь».
caption — короткая подпись на 4–10 слов, собранная из слов самого человека, как рукописная строчка на полях.

Учитывай песню: она окрашивает день, но главный источник — текст.`;

export async function POST(req: Request) {
  const { text, date, song } = (await req.json()) as { text: string; date: string; song?: string };
  if (!text || typeof text !== "string") return Response.json({ error: "Нужен текст дня" }, { status: 400 });

  const fallback = () => Response.json(heuristicAnalysis(text, date || ""));
  if (!process.env.ANTHROPIC_API_KEY) return fallback();

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: JSON_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Дата: ${date || "не указана"}\nПесня дня: ${song || "не указана"}\n\nЗапись:\n${text.slice(0, 6000)}`,
        },
      ],
    } as any);

    if (response.stop_reason === "refusal") return fallback();
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallback();
    const parsed = Schema.safeParse(JSON.parse(block.text));
    if (!parsed.success) return fallback();

    const a = parsed.data;
    const words = a.title.split(/\s+/).filter(Boolean);
    const result = {
      ...(a as Omit<TextAnalysis, "source">),
      title: words.slice(0, 7).join(" ").replace(/[«».]/g, ""),
      arc: a.arc.length >= 3 ? a.arc.slice(0, 8) : [0.5, 0.5, 0.5],
      source: "claude",
    };
    return Response.json(result);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("Claude: rate limit, словарный анализ");
    else if (err instanceof Anthropic.APIError) console.warn("Claude API error", err.status, err.message);
    else console.warn("analyze failed", err);
    return fallback();
  }
}
