// Песня по ссылке или названию → метаданные + официальное 30-секундное превью Deezer.
// Саму песню не храним: только id, по которому превью подтягивается заново.
export const runtime = "nodejs";

const UA = { "User-Agent": "otpechatok-diary/0.1" };

async function getJson(url: string) {
  const r = await fetch(url, { headers: UA, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function clean(s: string) {
  return s
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(official (music )?video|lyrics?|hd|4k)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ссылка на сервис → «исполнитель название» для поиска */
async function queryFromLink(link: string): Promise<string | null> {
  try {
    const u = new URL(link);
    const host = u.hostname;
    if (host.includes("deezer.com")) {
      const m = u.pathname.match(/track\/(\d+)/);
      if (m) return `id:${m[1]}`;
    }
    if (host.includes("spotify.com")) {
      const o = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(link)}`);
      return o?.title ? clean(o.title) : null;
    }
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      const o = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`);
      if (!o?.title) return null;
      const t = clean(o.title);
      return t.includes("-") ? t : `${(o.author_name || "").replace(/ - Topic$/, "")} ${t}`;
    }
    const o = await getJson(`https://noembed.com/embed?url=${encodeURIComponent(link)}`);
    return o?.title ? clean(`${o.author_name || ""} ${o.title}`) : null;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** Поиск в Deezer: сначала точный artist/track, потом общий; лучший — где совпал исполнитель */
async function searchDeezer(query: string) {
  const parts = query.split(/\s+[—–-]\s+/);
  const urls: string[] = [];
  if (parts.length === 2) urls.push(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(`artist:"${parts[0]}" track:"${parts[1]}"`)}`);
  urls.push(`https://api.deezer.com/search?limit=10&q=${encodeURIComponent(query.replace(/[—–-]/g, " "))}`);
  const q = norm(query);
  for (const url of urls) {
    const s = await getJson(url).catch(() => null);
    const hits: any[] = (s?.data ?? []).filter((h: any) => h.preview);
    if (!hits.length) continue;
    const scored = hits.map((h) => {
      const a = norm(h.artist?.name ?? ""), t = norm(h.title ?? "");
      return { h, score: (a && q.includes(a) ? 2 : 0) + (t && q.includes(t.split(" (")[0]) ? 1 : 0) };
    });
    scored.sort((x, y) => y.score - x.score);
    if (scored[0].score > 0 || parts.length < 2) return scored[0].h;
  }
  return null;
}

async function track(id: number | string) {
  return getJson(`https://api.deezer.com/track/${id}`);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const id = searchParams.get("id");

  try {
    let t: any = null;
    let link: string | undefined;

    if (id) {
      t = await track(id);
    } else if (q) {
      let query = q;
      if (/^https?:\/\//i.test(q)) {
        link = q;
        const fromLink = await queryFromLink(q);
        if (!fromLink) return Response.json({ found: false, link, reason: "Не удалось распознать ссылку — впишите «Исполнитель — песня»." });
        query = fromLink;
      }
      if (query.startsWith("id:")) {
        t = await track(query.slice(3));
      } else {
        const hit = await searchDeezer(query);
        if (hit) t = await track(hit.id);
      }
    }

    if (!t || t.error) return Response.json({ found: false, link });
    const year = t.release_date ? Number(String(t.release_date).slice(0, 4)) : t.album?.release_date ? Number(String(t.album.release_date).slice(0, 4)) : undefined;
    return Response.json({
      found: true,
      link: link || t.link,
      deezerId: t.id,
      title: t.title,
      artist: t.artist?.name,
      year: year || undefined,
      bpm: t.bpm || 0,
      cover: t.album?.cover_medium,
      hasPreview: Boolean(t.preview),
    });
  } catch (e) {
    return Response.json({ found: false, reason: String(e) }, { status: 200 });
  }
}
