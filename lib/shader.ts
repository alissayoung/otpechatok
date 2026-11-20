// GLSL «Отпечатка»: страница дневника + окно с фото + 6 смешиваемых художественных режимов + частицы.

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTex0, uTex1, uDep0, uDep1, uOverlay;
uniform float uAsp0, uAsp1, uMix, uTime, uLow, uMid, uHigh, uBeat;
uniform float uEnergy, uValence, uWarmth, uNostalgia, uSeed;
uniform vec2 uRes, uMouse;
uniform vec4 uWin;        // окно фото в uv: x0, y0, x1, y1
uniform vec3 uWA, uWB;    // веса: импрессия, композиция, вырезки | ноктюрн, плёнка, ма
uniform vec3 uP0, uP1, uP2, uP3, uP4;
uniform vec3 uPaper, uInk;
uniform int uParticles;   // 0 нет, 1 листья, 2 снег, 3 дождь, 4 пыль, 5 лепестки

const float WIN_ASP = 0.8;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n) { return fract(sin(n * 91.345 + uSeed) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }

vec2 cover(vec2 w, float asp) {
  vec2 uv = w;
  if (asp > WIN_ASP) uv.x = 0.5 + (uv.x - 0.5) * (WIN_ASP / asp);
  else uv.y = 0.5 + (uv.y - 0.5) * (asp / WIN_ASP);
  return uv;
}

// Фото с параллаксом по карте глубины и медленным «дыханием» камеры
vec4 photoAt(sampler2D t, sampler2D d, float asp, vec2 w, float phase) {
  vec2 uv = cover(w, asp);
  float z0 = texture2D(d, uv).r;
  float zoom = 0.93 - 0.025 * sin(uTime * 0.07 + phase) - 0.01 * uLow;
  vec2 par = uMouse * (z0 - 0.45) * (0.04 + 0.02 * uLow);
  uv = 0.5 + (uv - 0.5) * zoom + par;
  float z = texture2D(d, uv).r;
  return vec4(texture2D(t, uv).rgb, z);
}
vec4 base(vec2 w) {
  vec4 a = photoAt(uTex0, uDep0, uAsp0, w, 0.0);
  if (uMix <= 0.001) return a;
  vec4 b = photoAt(uTex1, uDep1, uAsp1, w, 1.7);
  return mix(a, b, uMix);
}

vec3 nearestPal(vec3 c) {
  vec3 best = uP0; float bd = distance(c, uP0);
  float d1 = distance(c, uP1); if (d1 < bd) { bd = d1; best = uP1; }
  float d2 = distance(c, uP2); if (d2 < bd) { bd = d2; best = uP2; }
  float d3 = distance(c, uP3); if (d3 < bd) { bd = d3; best = uP3; }
  float d4 = distance(c, uP4); if (d4 < bd) { bd = d4; best = uP4; }
  return best;
}

// --- Импрессия: мазки по полю шума + фильтр Кувахары (4 квадранта) ---
vec3 impression(vec2 w) {
  float ang = fbm(w * 5.0 + uTime * 0.03) * 6.2831;
  vec2 dir = vec2(cos(ang), sin(ang));
  float r = 0.012 + 0.006 * uLow;
  vec3 m[4]; float v[4];
  for (int q = 0; q < 4; q++) {
    vec2 o = vec2(q == 0 || q == 2 ? -1.0 : 1.0, q < 2 ? -1.0 : 1.0) * r;
    vec3 s = vec3(0.0), s2 = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 off = o * (0.35 + 0.22 * float(k)) + dir * r * 0.6 * float(k - 1);
      vec3 c = base(w + off).rgb;
      s += c; s2 += c * c;
    }
    m[q] = s / 4.0;
    vec3 var3 = s2 / 4.0 - m[q] * m[q];
    v[q] = var3.r + var3.g + var3.b;
  }
  vec3 c = m[0]; float bv = v[0];
  if (v[1] < bv) { bv = v[1]; c = m[1]; }
  if (v[2] < bv) { bv = v[2]; c = m[2]; }
  if (v[3] < bv) { c = m[3]; }
  c = sat(c, 1.15);
  c += 0.18 * smoothstep(0.55, 1.0, luma(c)) * vec3(1.0, 0.92, 0.78);
  return c;
}

// --- Вырезки (Матисс): постеризация в палитру дня + рваный бумажный край ---
vec3 cutouts(vec2 w) {
  vec2 j = vec2(fbm(w * 18.0), fbm(w * 18.0 + 7.0)) * 0.012;
  vec3 c = base(w + j).rgb;
  vec3 p = nearestPal(sat(c, 1.4));
  float paper = 0.04 * (noise(w * 220.0) - 0.5);
  return sat(p, 1.35) + paper;
}

// --- Композиция (Кандинский): жёсткий контраст, цвет из палитры ---
vec3 composition(vec2 w) {
  vec3 c = base(w).rgb;
  float l = luma(c);
  l = smoothstep(0.25, 0.75, l);
  vec3 cold = mix(uInk, mix(uP2, vec3(0.75, 0.8, 0.9), 0.5), l);
  return mix(cold, nearestPal(c), 0.25);
}

// --- Ноктюрн (Уистлер): туман по глубине, приглушённый тон ---
vec3 nocturne(vec2 w) {
  vec4 b = base(w);
  float l = luma(b.rgb);
  vec3 tone = mix(uInk * 0.9, sat(uP0, 0.35) * 1.1 + 0.08, l);
  float drift = fbm(w * 3.0 + vec2(uTime * 0.02, 0.0));
  float fog = clamp((1.0 - b.a) * 0.9 + drift * 0.35 - 0.2, 0.0, 0.85);
  vec3 fogC = mix(tone, sat(uPaper, 0.4), 0.55);
  return mix(tone, fogC, fog);
}

// --- Плёнка: хроматическое смещение, ореол, зерно, засветка, виньетка ---
vec3 film(vec2 w) {
  float ca = 0.0025 + 0.002 * uHigh;
  vec3 c = vec3(base(w + vec2(ca, 0.0)).r, base(w).g, base(w - vec2(ca, 0.0)).b);
  float hal = 0.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.047;
    hal += smoothstep(0.7, 1.0, luma(base(w + vec2(cos(a), sin(a)) * 0.014).rgb));
  }
  c += vec3(0.9, 0.35, 0.15) * hal / 6.0 * 0.35;
  c = mix(c, c * vec3(1.06, 1.0, 0.86), 0.6);
  float leak = smoothstep(0.55, 1.0, w.x + 0.3 * sin(uTime * 0.2)) * smoothstep(0.0, 0.8, w.y);
  c += vec3(1.0, 0.45, 0.2) * leak * 0.22;
  float vig = smoothstep(0.85, 0.25, distance(w, vec2(0.5)));
  return c * mix(0.65, 1.0, vig);
}

// --- Ма: контур Собеля на бумаге, плоские заливки, пустота ---
vec3 ma(vec2 w) {
  float e = 0.004;
  float tl = luma(base(w + vec2(-e, e)).rgb), t = luma(base(w + vec2(0, e)).rgb), tr = luma(base(w + vec2(e, e)).rgb);
  float l = luma(base(w + vec2(-e, 0)).rgb), r = luma(base(w + vec2(e, 0)).rgb);
  float bl = luma(base(w + vec2(-e, -e)).rgb), b = luma(base(w + vec2(0, -e)).rgb), br = luma(base(w + vec2(e, -e)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = smoothstep(0.18, 0.6, length(vec2(gx, gy)));
  float lum = luma(base(w).rgb);
  float band = floor(lum * 3.0) / 3.0;
  vec3 fill = mix(uPaper, sat(uP0, 0.45), (1.0 - band) * 0.55);
  return mix(fill, uInk, edge * 0.85);
}

// Геометрия Кандинского поверх страницы
vec4 kandinsky(vec2 p, float asp) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(hash1(fi) * asp, 0.15 + hash1(fi + 3.1) * 0.75);
    c += 0.02 * vec2(sin(uTime * 0.4 + fi), cos(uTime * 0.3 + fi * 2.0));
    float rad = 0.03 + hash1(fi + 5.0) * 0.09;
    rad *= 1.0 + 0.25 * uBeat * step(fi, 2.0);
    float d = length(p - c);
    vec3 col = i == 0 ? uP1 : i == 1 ? uP2 : i == 2 ? uP3 : i == 3 ? uInk : uP4;
    float ring = hash1(fi + 9.0) > 0.5 ? smoothstep(0.004, 0.0, abs(d - rad) - 0.002) : smoothstep(rad, rad - 0.003, d);
    acc = mix(acc, vec4(sat(col, 1.5), 0.85), ring * 0.8);
  }
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = hash1(fi + 20.0) * 3.1416 + uBeat * 0.05 * (fi - 2.5);
    vec2 n = vec2(cos(a), sin(a));
    vec2 o = vec2(hash1(fi + 30.0) * asp, hash1(fi + 40.0));
    float d = abs(dot(p - o, n));
    float len = smoothstep(0.35, 0.3, abs(dot(p - o, vec2(-n.y, n.x))));
    float th = 0.0012 + 0.003 * hash1(fi + 50.0);
    acc = mix(acc, vec4(uInk, 1.0), smoothstep(th, 0.0, d) * len * 0.9);
  }
  return acc;
}

vec4 particles(vec2 p, float asp) {
  if (uParticles == 0) return vec4(0.0);
  vec4 acc = vec4(0.0);
  float sp = 0.3 + uEnergy * 0.9;
  for (int i = 0; i < 46; i++) {
    float fi = float(i);
    float x = hash1(fi * 1.3) * asp;
    float y = fract(hash1(fi * 2.7) - uTime * sp * (0.03 + 0.04 * hash1(fi)));
    vec2 c;
    if (uParticles == 4) { // пыль поднимается
      y = fract(hash1(fi * 2.7) + uTime * 0.012 * (0.5 + hash1(fi)));
      c = vec2(x + 0.02 * sin(uTime * 0.5 + fi), y);
      float d = length(p - c);
      float fl = 0.6 + 0.4 * sin(uTime * 2.0 + fi * 3.0);
      acc += vec4(vec3(1.0, 0.92, 0.75), 1.0) * smoothstep(0.006, 0.0, d) * fl * 0.7;
      continue;
    }
    c = vec2(x + 0.04 * sin(uTime * 0.7 + fi), y);
    vec2 d = p - c;
    if (uParticles == 3) { // дождь — косые штрихи
      d = mat2(0.96, -0.28, 0.28, 0.96) * d;
      float m = smoothstep(0.0012, 0.0, abs(d.x)) * smoothstep(0.03, 0.0, abs(d.y));
      acc = mix(acc, vec4(mix(uPaper, vec3(0.8, 0.85, 0.95), 0.5), 1.0), m * 0.55);
    } else if (uParticles == 2) { // снег
      float m = smoothstep(0.0045 + 0.003 * hash1(fi), 0.0, length(d));
      acc = mix(acc, vec4(1.0), m * 0.9);
    } else { // листья / лепестки — вращающиеся эллипсы
      float a = uTime * (0.8 + hash1(fi + 2.0)) + fi;
      d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
      float s = uParticles == 1 ? 0.011 : 0.008;
      float m = smoothstep(1.0, 0.8, length(d / vec2(s, s * 0.45)));
      vec3 col = uParticles == 1 ? mix(vec3(0.85, 0.45, 0.12), uP1, 0.3) * (0.8 + 0.4 * hash1(fi + 4.0)) : vec3(1.0, 0.78, 0.84);
      acc = mix(acc, vec4(col, 1.0), m * 0.9);
    }
  }
  return acc;
}

float roundRect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * asp, vUv.y);

  // Бумага страницы
  vec3 col = uPaper * (0.97 + 0.05 * fbm(vUv * vec2(asp, 1.0) * 140.0));

  // Окно фото
  vec2 wc = (uWin.xy + uWin.zw) * 0.5;
  vec2 wh = (uWin.zw - uWin.xy) * 0.5;
  vec2 lp = (vUv - wc) * vec2(asp, 1.0);
  float dWin = roundRect(lp, wh * vec2(asp, 1.0), 0.018);
  // мягкая тень
  col = mix(col, col * 0.86, smoothstep(0.03, 0.0, dWin - 0.004) * 0.5);

  if (dWin < 0.0) {
    vec2 w = (vUv - uWin.xy) / (uWin.zw - uWin.xy);
    float wsum = uWA.x + uWA.y + uWA.z + uWB.x + uWB.y + uWB.z;
    vec3 c = vec3(0.0);
    if (uWA.x > 0.03) c += uWA.x * impression(w);
    if (uWA.y > 0.03) c += uWA.y * composition(w);
    if (uWA.z > 0.03) c += uWA.z * cutouts(w);
    if (uWB.x > 0.03) c += uWB.x * nocturne(w);
    if (uWB.y > 0.03) c += uWB.y * film(w);
    if (uWB.z > 0.03) c += uWB.z * ma(w);
    float used = (uWA.x > 0.03 ? uWA.x : 0.0) + (uWA.y > 0.03 ? uWA.y : 0.0) + (uWA.z > 0.03 ? uWA.z : 0.0)
               + (uWB.x > 0.03 ? uWB.x : 0.0) + (uWB.y > 0.03 ? uWB.y : 0.0) + (uWB.z > 0.03 ? uWB.z : 0.0);
    c /= max(used, 0.001);

    // общий грейдинг по вектору
    c = sat(c, 0.7 + 0.5 * uValence);
    c += vec3(0.05, 0.015, -0.05) * (uWarmth - 0.5) * 2.0;
    c *= 1.0 + uBeat * 0.07 * (0.3 + uEnergy);
    // плёночное зерно поверх всего — сильнее при ностальгии
    c += (hash(w * uRes + fract(uTime * 13.0)) - 0.5) * (0.025 + 0.06 * uNostalgia);
    float edge = smoothstep(0.0, -0.004, dWin);
    col = mix(col, c, edge);
  }
  col = mix(col, uInk, smoothstep(0.0015, 0.0, abs(dWin)) * 0.25);

  // Кандинский выходит за рамки окна
  if (uWA.y > 0.12) {
    vec4 k = kandinsky(p, asp);
    col = mix(col, k.rgb, k.a * clamp(uWA.y * 1.4, 0.0, 0.9));
  }

  vec4 pt = particles(p, asp);
  col = mix(col, pt.rgb, clamp(pt.a, 0.0, 1.0));

  // Постоянные элементы страницы (дата, название, подпись, «Партитура»)
  vec4 ov = texture2D(uOverlay, vUv);
  col = mix(col, ov.rgb, ov.a);

  gl_FragColor = vec4(col, 1.0);
}
`;
