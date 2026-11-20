// Хранение дней: Supabase (если заданы переменные окружения) или IndexedDB в браузере.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { get, set, keys } from "idb-keyval";
import type { Day, DayMedia } from "./types";

export interface DayFiles {
  photos: Blob[];
  depths: Blob[];
  audio?: Blob;
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let sb: SupabaseClient | null = null;
function supa() {
  if (!SB_URL || !SB_KEY) return null;
  if (!sb) sb = createClient(SB_URL, SB_KEY);
  return sb;
}
export const storageLabel = () => (supa() ? "Supabase" : "этом браузере");

const BUCKET = "days";

// ---------- IndexedDB ----------
async function idbSave(day: Day, files: DayFiles) {
  await set(`day:${day.id}`, day);
  await set(`files:${day.id}`, files);
}
async function idbList(): Promise<Day[]> {
  const ks = (await keys()).filter((k) => String(k).startsWith("day:"));
  const days = await Promise.all(ks.map((k) => get<Day>(k)));
  return days.filter(Boolean) as Day[];
}
async function idbGet(id: string): Promise<{ day: Day; media: DayMedia } | null> {
  const day = await get<Day>(`day:${id}`);
  if (!day) return null;
  const files = (await get<DayFiles>(`files:${id}`)) || { photos: [], depths: [] };
  return {
    day,
    media: {
      photos: files.photos.map((b) => URL.createObjectURL(b)),
      depths: files.depths.map((b) => URL.createObjectURL(b)),
      audioUrl: files.audio ? URL.createObjectURL(files.audio) : undefined,
    },
  };
}

// ---------- Supabase ----------
async function sbSave(s: SupabaseClient, day: Day, files: DayFiles) {
  const up = async (path: string, b: Blob) => {
    const { error } = await s.storage.from(BUCKET).upload(path, b, { upsert: true, contentType: b.type || undefined });
    if (error) throw error;
  };
  await Promise.all([
    ...files.photos.map((b, i) => up(`${day.id}/photo-${i}.jpg`, b)),
    ...files.depths.map((b, i) => up(`${day.id}/depth-${i}.png`, b)),
    ...(files.audio ? [up(`${day.id}/audio`, files.audio)] : []),
  ]);
  const { error } = await s.from("days").upsert({ id: day.id, created_at: day.createdAt, data: day });
  if (error) throw error;
}
async function sbList(s: SupabaseClient): Promise<Day[]> {
  const { data, error } = await s.from("days").select("data").order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []).map((r: any) => r.data as Day);
}
async function sbGet(s: SupabaseClient, id: string) {
  const { data, error } = await s.from("days").select("data").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const day = data.data as Day;
  const url = (p: string) => s.storage.from(BUCKET).getPublicUrl(`${id}/${p}`).data.publicUrl;
  return {
    day,
    media: {
      photos: day.photos.map((_, i) => url(`photo-${i}.jpg`)),
      depths: day.photos.map((_, i) => url(`depth-${i}.png`)),
      audioUrl: day.hasAudioFile ? url("audio") : undefined,
    } as DayMedia,
  };
}

// ---------- API ----------
export async function saveDay(day: Day, files: DayFiles) {
  const s = supa();
  if (s) {
    try { return await sbSave(s, day, files); } catch (e) { console.warn("Supabase save failed, saving locally", e); }
  }
  return idbSave(day, files);
}

export async function listDays(): Promise<Day[]> {
  const s = supa();
  let remote: Day[] = [];
  if (s) { try { remote = await sbList(s); } catch (e) { console.warn(e); } }
  const local = await idbList().catch(() => [] as Day[]);
  const seen = new Set(remote.map((d) => d.id));
  return [...remote, ...local.filter((d) => !seen.has(d.id))].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

export async function getDay(id: string) {
  const local = await idbGet(id).catch(() => null);
  if (local) return local;
  const s = supa();
  return s ? sbGet(s, id) : null;
}
