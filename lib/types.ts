// Общие типы «Отпечатка»

export type Particles = "leaves" | "snow" | "rain" | "dust" | "petals" | "none";
export type Season = "winter" | "spring" | "summer" | "autumn" | "unknown";
export type TimeOfDay = "morning" | "day" | "evening" | "night" | "unknown";

/** Что LLM (или эвристика) достаёт из текста дня */
export interface TextAnalysis {
  valence: number; // 0 грусть … 1 радость
  energy: number; // 0 покой … 1 напряжение
  warmth: number; // 0 холодно … 1 тепло
  intimacy: number; // 0 один … 1 с близкими
  nostalgia: number; // 0 … 1
  density: number; // 0 пустой день … 1 насыщенный
  season: Season;
  timeOfDay: TimeOfDay;
  particles: Particles;
  places: string[];
  people: string[];
  details: string[]; // сенсорные детали: запахи, звуки, свет
  moodWords: string[];
  arc: number[]; // кривая настроения по ходу текста, 3–8 значений 0..1
  title: string; // 3–7 слов
  caption: string; // короткая «рукописная» подпись из слов человека
  source: "claude" | "heuristic";
}

/** Признаки песни из аудиоанализа */
export interface AudioFeatures {
  bpm: number;
  key: string; // например «A»
  mode: "major" | "minor";
  modeClarity: number; // 0..1 уверенность в ладе
  energy: number; // 0..1 громкость/плотность
  brightness: number; // 0..1 спектральный центроид
  waveform: number[]; // 160 значений 0..1 для «Партитуры»
  analyzed: boolean; // false = значения по описанию, без звука
}

export interface SongInfo {
  input: string; // что ввёл человек
  link?: string;
  artist?: string;
  title?: string;
  year?: number;
  deezerId?: number;
  cover?: string;
  source: "deezer" | "file" | "text";
  features: AudioFeatures;
}

export interface PhotoInfo {
  palette: string[]; // 5 hex-цветов, от доминирующего
  brightness: number;
  warmth: number;
  saturation: number;
  hasDepthModel: boolean;
}

export interface WeatherInfo {
  code: number;
  tempMax: number;
  label: string;
}

/** Вектор атмосферы — ядро визуальной системы */
export interface AtmosphereVector {
  valence: number;
  energy: number;
  warmth: number;
  intimacy: number;
  nostalgia: number;
  density: number;
}

export const MODES = ["impression", "composition", "cutouts", "nocturne", "film", "ma"] as const;
export type ModeName = (typeof MODES)[number];

export const MODE_LABELS: Record<ModeName, { name: string; ref: string; why: string }> = {
  impression: {
    name: "Импрессия",
    ref: "Клод Моне",
    why: "размытые мазки и мягкий свет — тёплая память без лишних деталей",
  },
  composition: {
    name: "Композиция",
    ref: "Василий Кандинский",
    why: "острые линии и диагонали читаются как напряжение и скорость",
  },
  cutouts: {
    name: "Вырезки",
    ref: "Анри Матисс",
    why: "плоские яркие формы — праздник, движение, танец",
  },
  nocturne: {
    name: "Ноктюрн",
    ref: "Джеймс Уистлер",
    why: "туман и пустой воздух — пауза, тишина, мысли",
  },
  film: {
    name: "Плёнка",
    ref: "любительская фотография 70–90-х",
    why: "зерно и засветки мгновенно читаются как воспоминание",
  },
  ma: {
    name: "Ма",
    ref: "японская гравюра укиё-э, пустота «ма»",
    why: "пустота как смысл — сосредоточенность и одиночество",
  },
};

export type ModeWeights = Record<ModeName, number>;

export interface Day {
  id: string;
  createdAt: string;
  date: string; // YYYY-MM-DD, день записи
  text: string;
  title: string;
  caption: string;
  analysis: TextAnalysis;
  song: SongInfo;
  photos: PhotoInfo[];
  weather?: WeatherInfo;
  vector: AtmosphereVector;
  weights: ModeWeights;
  explain: string[];
  voice: { rate: number; pitch: number; label: string };
  hasAudioFile: boolean;
}

/** Медиа дня, готовые к показу */
export interface DayMedia {
  photos: string[]; // URL изображений
  depths: string[]; // URL карт глубины
  audioUrl?: string; // свой файл
}
