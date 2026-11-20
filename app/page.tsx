"use client";
// Архив: созвездие дней на карте «тон × энергия» + лента страниц дневника.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listDays, storageLabel } from "@/lib/store";
import { MODE_LABELS, type Day } from "@/lib/types";
import { topMode } from "@/lib/vector";
import { paperColors } from "@/lib/overlay";

export default function Archive() {
  const [days, setDays] = useState<Day[] | null>(null);
  const router = useRouter();
  useEffect(() => { listDays().then(setDays).catch(() => setDays([])); }, []);

  const W = 1000, H = 420, pad = 50;
  return (
    <main className="wrap">
      <header className="top">
        <Link href="/" className="logo">
          Отпечаток
          <small>дневник, который помнит, как ощущался день</small>
        </Link>
        <Link href="/new" className="btn solid">+ Записать день</Link>
      </header>

      {days === null && <p className="muted">Открываю дневник…</p>}

      {days && days.length === 0 && (
        <div className="empty">
          <h2>Дневник пока пуст</h2>
          <p className="muted">Расскажите, как прошёл день, приложите фото и песню — система соберёт из этого живую страницу.</p>
          <p><Link href="/new" className="btn solid">Записать первый день</Link></p>
        </div>
      )}

      {days && days.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Созвездие дней · {days.length} · хранится в {storageLabel()}</div>
          <div className="sky">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Дни на карте настроения">
              <defs>
                <radialGradient id="glow"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
              </defs>
              {Array.from({ length: 70 }, (_, i) => (
                <circle key={i} cx={(i * 137.5) % W} cy={(i * 71.3) % H} r={0.8} fill="#ece6da" opacity={0.25} />
              ))}
              <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke="#2c2f36" />
              <line x1={W / 2} x2={W / 2} y1={pad / 2} y2={H - pad / 2} stroke="#2c2f36" />
              <text className="axis" x={pad} y={H / 2 - 8}>← ГРУСТНЕЕ</text>
              <text className="axis" x={W - pad} y={H / 2 - 8} textAnchor="end">РАДОСТНЕЕ →</text>
              <text className="axis" x={W / 2 + 8} y={pad / 2 + 10}>НАПРЯЖЁННЕЕ</text>
              <text className="axis" x={W / 2 + 8} y={H - pad / 2}>СПОКОЙНЕЕ</text>
              {days.length > 1 && (
                <polyline
                  fill="none" stroke="#ece6da" strokeOpacity=".18" strokeDasharray="2 6"
                  points={[...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => `${pad + d.vector.valence * (W - 2 * pad)},${H - pad / 2 - d.vector.energy * (H - pad)}`).join(" ")}
                />
              )}
              {days.map((d) => {
                const x = pad + d.vector.valence * (W - 2 * pad);
                const y = H - pad / 2 - d.vector.energy * (H - pad);
                const c = paperColors(d).accent;
                const r = 7 + d.vector.density * 10;
                return (
                  <g key={d.id} className="star" onClick={() => router.push(`/day/${d.id}`)}>
                    <circle cx={x} cy={y} r={r * 3} fill="url(#glow)" opacity=".25" />
                    <circle cx={x} cy={y} r={r} fill={c} stroke="#ece6da" strokeWidth="1" />
                    <text x={x + r + 8} y={y + 5}>{d.title}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="grid">
            {days.map((d) => {
              const pc = paperColors(d);
              return (
                <Link key={d.id} href={`/day/${d.id}`} className="card" style={{ background: pc.paper, color: pc.ink }}>
                  <div className="date">{d.date.split("-").reverse().join(".")}</div>
                  <div className="stripes">{(d.photos[0]?.palette ?? []).map((c, i) => <span key={i} style={{ background: c }} />)}</div>
                  <div className="title">{d.title}</div>
                  <div className="mode">{MODE_LABELS[topMode(d.weights)].name}</div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
