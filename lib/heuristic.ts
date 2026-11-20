// Запасной анализ текста без LLM: словари корней русского языка.
// Работает, когда ANTHROPIC_API_KEY не задан или API недоступен.
import type { TextAnalysis, Particles, Season, TimeOfDay } from "./types";

const has = (t: string, roots: string[]) => roots.filter((r) => t.includes(r)).length;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

const POS = ["счаст", "радост", "весел", "смея", "смех", "любл", "любим", "уют", "тепл", "кайф", "класс", "здоров", "прекрас", "чудес", "нежн", "обним", "улыб", "восторг", "праздн", "танц", "ура", "спокойн", "хорош", "красив"];
const NEG = ["грус", "тоск", "плак", "слёз", "слез", "устал", "одинок", "страш", "боль", "злюсь", "злой", "тревог", "пуст", "плох", "скучн", "печал", "обид", "ссор", "потер", "болел", "дедлайн", "провал"];
const HIGH = ["бег", "срочн", "дедлайн", "сдач", "быстр", "концерт", "танц", "кричал", "спешил", "аврал", "гонк", "тусов", "вечеринк", "толп", "шумн", "бешен", "ноч", "кофе", "адренал", "спорт", "трениров", "экзамен", "хакатон"];
const LOW = ["спокойн", "тих", "медлен", "лениво", "отдых", "сон", "спал", "читал", "пледе", "плед", "гулял", "прогулк", "сидел", "смотрел", "чай", "какао", "дожд", "умиротвор", "тишин"];
const WARM = ["тепл", "солн", "жар", "лето", "летн", "какао", "чай", "плед", "камин", "свеч", "обним", "уют", "закат", "оранж", "жёлт", "желт", "золот"];
const COLD = ["холод", "мороз", "снег", "зим", "ветер", "ветр", "дожд", "сер", "син", "лёд", "лед", "офис", "мрак", "ночь", "туман"];
const PEOPLE = ["мы ", "мы,", "друз", "подруг", "девушк", "парн", "мам", "пап", "сестр", "брат", "семь", "вместе", "с ним", "с ней", "бабушк", "дедушк", "коллег", "команд", "любим"];
const NOSTALGIA = ["вспомн", "помню", "детств", "когда-то", "раньше", "как в", "старый", "старые", "давно", "ностальг", "школ", "бабушк", "дедушк"];

const PLACES: [string, string][] = [
  ["парк", "в парке"], ["пруд", "у пруда"], ["озер", "у озера"], ["офис", "в офисе"],
  [" море", "у моря"], [" моря", "у моря"], [" морю", "у моря"], ["кафе", "в кафе"], ["кофейн", "в кофейне"], [" дома", "дома"], [" домой", "по дороге домой"], ["кухн", "на кухне"], [" лес", "в лесу"],
  [" горы", "в горах"], [" горах", "в горах"], [" город", "в городе"], ["улиц", "на улице"], ["крыш", "на крыше"], ["поезд", "в поезде"],
  ["вокзал", "на вокзале"], ["аэропорт", "в аэропорту"], ["универ", "в универе"], ["школ", "в школе"], ["концерт", "на концерте"],
  ["пляж", "на пляже"], ["дач", "на даче"], ["набережн", "на набережной"], ["степ", "в степи"],
];

const PARTICLE_RULES: [Particles, string[]][] = [
  ["snow", ["снег", "снеж", "метел", "сугроб"]],
  ["rain", ["дожд", "ливен", "ливн", "морос", "гроз"]],
  ["leaves", ["лист", "осен", "листопад"]],
  ["petals", ["цвет", "сакур", "яблон", "весн", "букет", "цветы"]],
  ["dust", ["солн", "свет", "пыль", "закат", "рассвет", "луч", "огни", "фонар"]],
];

function season(t: string, date: string): Season {
  if (has(t, ["зим", "снег", "мороз", "новый год"])) return "winter";
  if (has(t, ["осен", "листопад", "жёлтые лист", "желтые лист"])) return "autumn";
  if (has(t, ["весн", "сакур", "цвет"])) return "spring";
  if (has(t, ["лет", "жара", "пляж"])) return "summer";
  const m = Number(date.slice(5, 7));
  if (!m) return "unknown";
  return m <= 2 || m === 12 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "autumn";
}

function timeOfDay(t: string): TimeOfDay {
  if (has(t, ["ночь", "ночью", "ночн", "полноч", "до утра"])) return "night";
  if (has(t, ["вечер", "закат", "вечером"])) return "evening";
  if (has(t, ["утр", "рассвет", "завтрак"])) return "morning";
  if (has(t, ["днём", "днем", "обед", "полдень"])) return "day";
  return "unknown";
}

const SEASON_WORD: Record<Season, string> = { winter: "Зимний", spring: "Весенний", summer: "Летний", autumn: "Осенний", unknown: "Тихий" };
const TIME_WORD: Record<TimeOfDay, string> = { morning: "Утро", day: "День", evening: "Вечер", night: "Ночь", unknown: "День" };

export function heuristicAnalysis(text: string, date: string): TextAnalysis {
  const t = " " + text.toLowerCase().replace(/ё/g, "е") + " ";
  const pos = has(t, POS), neg = has(t, NEG);
  const hi = has(t, HIGH), lo = has(t, LOW);
  const warm = has(t, WARM), cold = has(t, COLD);
  const ppl = has(t, PEOPLE);
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?…]+/).map((s) => s.trim()).filter(Boolean);

  const s = season(t, date);
  const tod = timeOfDay(t);
  const particles = (PARTICLE_RULES.find(([, roots]) => has(t, roots) > 0)?.[0] ?? "none") as Particles;
  const places = PLACES.filter(([r]) => t.includes(r)).map(([, p]) => p).slice(0, 3);

  // кривая настроения: тон каждого предложения
  const arc = sentences.slice(0, 8).map((sn) => {
    const x = " " + sn.toLowerCase() + " ";
    return clamp(0.5 + 0.18 * (has(x, POS) - has(x, NEG)));
  });
  while (arc.length < 3) arc.push(arc[arc.length - 1] ?? 0.5);

  const titleBase = tod !== "unknown" ? `${TIME_WORD[tod]}` : `${SEASON_WORD[s]} день`;
  const title = [titleBase, places[0] ?? "", ppl ? "вместе" : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const caption = (sentences[sentences.length - 1] ?? text).slice(0, 80);

  return {
    valence: clamp(0.5 + 0.12 * (pos - neg)),
    energy: clamp(0.45 + 0.1 * (hi - lo) + Math.min(0.15, words / 1500)),
    warmth: clamp(0.5 + 0.1 * (warm - cold)),
    intimacy: clamp(0.25 + 0.2 * ppl),
    nostalgia: clamp(0.2 + 0.2 * has(t, NOSTALGIA)),
    density: clamp(words / 160 + sentences.length / 20),
    season: s,
    timeOfDay: tod,
    particles,
    places,
    people: [],
    details: [],
    moodWords: [],
    arc,
    title: title.split(" ").length < 3 ? `${title} без лишних слов` : title,
    caption,
    source: "heuristic",
  };
}
