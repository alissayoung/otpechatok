// Прокси официального 30-секундного превью Deezer (обходит CORS для Web Audio).
export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return new Response("bad id", { status: 400 });
  const t = await fetch(`https://api.deezer.com/track/${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const preview: string | undefined = t?.preview;
  if (!preview) return new Response("no preview", { status: 404 });
  const host = new URL(preview).hostname;
  if (!host.endsWith("dzcdn.net") && !host.endsWith("deezer.com")) return new Response("bad host", { status: 400 });
  const audio = await fetch(preview, { cache: "no-store" });
  if (!audio.ok || !audio.body) return new Response("preview failed", { status: 502 });
  return new Response(audio.body, {
    headers: {
      "Content-Type": audio.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "public, max-age=600",
    },
  });
}
