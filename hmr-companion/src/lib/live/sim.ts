/**
 * "Zwift su strada", versione simulata: rider virtuali che pedalano sulla traccia vera.
 * Velocità dal modello fisico (watt, peso, pendenza, aria), chat solo tra vicini.
 * Puro e deterministico (seed): niente DOM, niente maplibre → testabile in node.
 */

export type CoursePoint = readonly [number, number, number?, number?, ...unknown[]];

export type Course = {
  lng: Float64Array;
  lat: Float64Array;
  ele: Float64Array;
  /** Distanza cumulata in metri. */
  dist: Float64Array;
  lengthM: number;
};

export type RiderCircle = "me" | "friend" | "group" | "other";

export type Rider = {
  id: string;
  name: string;
  circle: RiderCircle;
  /** Gruppi in comune (nome), per il filtro "Gruppo". */
  groups: string[];
  color: string;
  /** Peso rider + bici + borse (kg). */
  massKg: number;
  /** Potenza "di crociera" (W); i bot oscillano attorno a questo valore. */
  baseWatts: number;
  watts: number;
  distM: number;
  speedMs: number;
};

export type ChatMessage = {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  /** Tempo di simulazione (s). */
  t: number;
  /** Distanza dal mio rider quando è stato inviato (m). */
  gapM: number;
  system?: boolean;
};

export type SimState = {
  t: number;
  riders: Rider[];
  chat: ChatMessage[];
  rng: number;
  /** Ultimo istante in cui ogni bot ha parlato (anti-spam). */
  lastTalk: Record<string, number>;
  /** Ordine di gara precedente rispetto a me: id → davanti (true) / dietro (false). */
  relPos: Record<string, boolean>;
  /** Risposte programmate dei bot ai miei messaggi. */
  pendingReplies: { at: number; fromId: string; text: string }[];
  msgSeq: number;
};

export const ME_ID = "me";
/** Raggio entro cui ci si legge in chat (m). */
export const CHAT_RADIUS_M = 200;
/** Raggio in cui si "vede" qualcuno nel gruppetto (m). */
export const NEARBY_RADIUS_M = 500;
const MAX_SPEED_MS = 18; // ~65 km/h in discesa, con le borse non di più
const G = 9.81;
const CRR = 0.006; // sterrato/asfalto misto
const CDA = 0.42; // bikepacking, posizione rilassata
const RHO = 1.15;
const DRIVETRAIN = 0.97;

/* ── PRNG deterministico (mulberry32) ── */
export function nextRandom(seed: number): [number, number] {
  let a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  a = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [a, (seed + 0x6d2b79f5) | 0];
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Costruisce il percorso; usa il km cumulato della traccia se c'è, altrimenti lo calcola. */
export function buildCourse(coords: readonly CoursePoint[]): Course {
  const n = coords.length;
  if (n < 2) throw new Error("Traccia troppo corta per la simulazione");
  const lng = new Float64Array(n);
  const lat = new Float64Array(n);
  const ele = new Float64Array(n);
  const dist = new Float64Array(n);
  const hasCum = coords.every((c) => typeof c[3] === "number");
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    lng[i] = c[0];
    lat[i] = c[1];
    ele[i] = typeof c[2] === "number" ? c[2] : i > 0 ? ele[i - 1] : 0;
    if (i === 0) dist[i] = 0;
    else if (hasCum) dist[i] = Math.max(dist[i - 1], (c[3] as number) * 1000);
    else dist[i] = dist[i - 1] + haversineM(lng[i - 1], lat[i - 1], lng[i], lat[i]);
  }
  return { lng, lat, ele, dist, lengthM: dist[n - 1] };
}

function indexAt(course: Course, d: number): number {
  const { dist } = course;
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

function eleAt(course: Course, d: number): number {
  const x = Math.min(Math.max(d, 0), course.lengthM);
  const i = indexAt(course, x);
  const span = course.dist[i + 1] - course.dist[i];
  const f = span > 0 ? (x - course.dist[i]) / span : 0;
  return course.ele[i] + (course.ele[i + 1] - course.ele[i]) * f;
}

/** Posizione sulla traccia a `d` metri dalla partenza, con pendenza media su ±100 m. */
export function positionAt(course: Course, d: number): { lng: number; lat: number; ele: number; grade: number } {
  const x = Math.min(Math.max(d, 0), course.lengthM);
  const i = indexAt(course, x);
  const span = course.dist[i + 1] - course.dist[i];
  const f = span > 0 ? (x - course.dist[i]) / span : 0;
  const a = Math.max(0, x - 100);
  const b = Math.min(course.lengthM, x + 100);
  const grade = b > a ? (eleAt(course, b) - eleAt(course, a)) / (b - a) : 0;
  return {
    lng: course.lng[i] + (course.lng[i + 1] - course.lng[i]) * f,
    lat: course.lat[i] + (course.lat[i + 1] - course.lat[i]) * f,
    ele: course.ele[i] + (course.ele[i + 1] - course.ele[i]) * f,
    grade: Math.max(-0.3, Math.min(0.3, grade)),
  };
}

/** Velocità di equilibrio (m/s) per potenza, massa e pendenza: bisezione sul bilancio di potenza. */
export function speedFromPower(watts: number, massKg: number, grade: number): number {
  const theta = Math.atan(grade);
  const resist = (v: number) =>
    (v * (massKg * G * (Math.sin(theta) + CRR * Math.cos(theta)) + 0.5 * RHO * CDA * v * v)) / DRIVETRAIN;
  const p = Math.max(0, watts);
  if (resist(MAX_SPEED_MS) <= p) return MAX_SPEED_MS;
  let lo = 0;
  let hi = MAX_SPEED_MS;
  // In discesa ripida la resistenza è negativa a basse velocità: il rider va comunque.
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (resist(mid) > p) hi = mid;
    else lo = mid;
  }
  return Math.max(lo, 0.8); // a piedi spingendo, mai fermi
}

/* ── Roster ── */

const PALETTE = ["#e4572e", "#29a19c", "#f3a712", "#7b5ea7", "#2e86ab", "#c03221", "#4c956c", "#d1495b", "#00798c", "#edae49"];
const OTHER_NAMES = [
  "Nikos", "Eleni", "Lukas", "Sofia", "Marco", "Anna", "Jonas", "Chiara", "Pierre", "Ioanna",
  "Tomás", "Greta", "Yannis", "Lea", "Davide", "Maja", "Kostas", "Irene", "Felix", "Nina",
];

export type RosterInput = {
  me: string;
  friends: string[];
  /** Nome gruppo → membri. */
  groups: Record<string, string[]>;
  /** Quanti sconosciuti aggiungere ("tutti"). */
  others?: number;
  startM?: number;
  seed?: number;
};

export function createSim(course: Course, input: RosterInput): SimState {
  let rng = input.seed ?? 42;
  const rand = () => {
    const [v, s] = nextRandom(rng);
    rng = s;
    return v;
  };
  const start = Math.min(Math.max(input.startM ?? 0, 0), course.lengthM - 5000);
  const groupsOf = (u: string) => Object.entries(input.groups).filter(([, m]) => m.includes(u)).map(([g]) => g);

  const names = new Map<string, RiderCircle>();
  for (const f of input.friends) if (f !== input.me) names.set(f, "friend");
  for (const members of Object.values(input.groups)) {
    for (const u of members) if (u !== input.me && !names.has(u)) names.set(u, "group");
  }
  const nOthers = input.others ?? 14;
  for (let i = 0; i < nOthers; i++) names.set(OTHER_NAMES[i % OTHER_NAMES.length] + (i >= OTHER_NAMES.length ? ` ${i}` : ""), "other");

  const riders: Rider[] = [
    {
      id: ME_ID,
      name: input.me,
      circle: "me",
      groups: groupsOf(input.me),
      color: "#111827",
      massKg: 92,
      baseWatts: 180,
      watts: 180,
      distM: start,
      speedMs: 0,
    },
  ];
  let k = 0;
  for (const [name, circle] of names) {
    const massKg = 80 + rand() * 25;
    // W/kg tra 1.6 e 2.6: c'è chi ti stacca e chi riprendi.
    const baseWatts = Math.round(massKg * (1.6 + rand() * 1.0));
    // Amici e gruppo partono vicini (si vedono subito), gli altri sparsi su 3 km.
    const spread = circle === "other" ? 3000 : 700;
    riders.push({
      id: `r${k}`,
      name,
      circle,
      groups: groupsOf(name),
      color: PALETTE[k % PALETTE.length],
      massKg,
      baseWatts,
      watts: baseWatts,
      distM: Math.max(0, start + (rand() - 0.35) * spread),
      speedMs: 0,
    });
    k++;
  }
  const state: SimState = { t: 0, riders, chat: [], rng, lastTalk: {}, relPos: {}, pendingReplies: [], msgSeq: 0 };
  const me = riders[0];
  for (const r of riders) if (r.id !== ME_ID) state.relPos[r.id] = r.distM > me.distM;
  return state;
}

/* ── Chat ── */

const CHEERS = ["Dai che ci sei!", "Tieni la ruota!", "Bella salita eh 💪", "Ci vediamo al prossimo rifornimento", "Che gambe oggi?", "Spingi, spingi!"];
const PASSED_BY_ME = ["Eh no, ora ti riprendo…", "Vai vai, ci vediamo in salita 😅", "Ma che hai mangiato?!", "Ok, ti seguo"];
const PASSING_ME = ["Ciao! Attaccati 😉", "Su, vieni con me!", "Dai che il gruppetto è qui davanti", "Passo! Non mollare"];
const REPLIES = ["😂", "Ahah sì!", "Concordo", "Dai che manca poco", "Ci sto!", "Forza!", "👍"];

function pick<T>(state: SimState, arr: readonly T[]): T {
  const [v, s] = nextRandom(state.rng);
  state.rng = s;
  return arr[Math.floor(v * arr.length) % arr.length];
}

function roll(state: SimState): number {
  const [v, s] = nextRandom(state.rng);
  state.rng = s;
  return v;
}

function me(state: SimState): Rider {
  return state.riders.find((r) => r.id === ME_ID)!;
}

function pushMsg(state: SimState, from: Rider, text: string, system = false): void {
  const m = me(state);
  state.chat.push({
    id: `m${++state.msgSeq}`,
    fromId: from.id,
    fromName: from.name,
    text,
    t: state.t,
    gapM: from.distM - m.distM,
    system,
  });
  if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
  state.lastTalk[from.id] = state.t;
}

/** Il mio messaggio: lo leggono solo i rider entro CHAT_RADIUS_M; qualcuno risponde. */
export function sendMyMessage(state: SimState, text: string): number {
  const body = text.trim().slice(0, 280);
  if (!body) return 0;
  const m = me(state);
  pushMsg(state, m, body);
  const listeners = state.riders.filter((r) => r.id !== ME_ID && Math.abs(r.distM - m.distM) <= CHAT_RADIUS_M);
  for (const r of listeners) {
    if (roll(state) < 0.6) state.pendingReplies.push({ at: state.t + 2 + roll(state) * 5, fromId: r.id, text: pick(state, REPLIES) });
  }
  return listeners.length;
}

/** Messaggi che vedo: quelli inviati entro il raggio della chat (o miei). */
export function visibleChat(state: SimState): ChatMessage[] {
  return state.chat.filter((c) => c.fromId === ME_ID || c.system || Math.abs(c.gapM) <= CHAT_RADIUS_M);
}

/* ── Passo di simulazione ── */

export type StepInput = { myWatts: number; dt: number };

export function step(state: SimState, course: Course, { myWatts, dt }: StepInput): SimState {
  state.t += dt;
  const m = me(state);
  m.watts = Math.max(0, myWatts);
  for (const r of state.riders) {
    if (r.id !== ME_ID) {
      // Bot: oscillano ±15% e spingono un po' di più in salita.
      const g = positionAt(course, r.distM).grade;
      const target = r.baseWatts * (1 + Math.max(0, g) * 1.5) * (0.88 + roll(state) * 0.24);
      r.watts = r.watts + (target - r.watts) * Math.min(1, dt / 8);
    }
    const g = positionAt(course, r.distM).grade;
    // Scia: chi ha qualcuno 2–15 m davanti risparmia ~25% sull'aria in piano (meno in salita).
    const draft = state.riders.some((o) => o !== r && o.distM - r.distM > 2 && o.distM - r.distM < 15) && g < 0.04;
    const eff = draft ? r.watts * 1.18 : r.watts;
    const vTarget = speedFromPower(eff, r.massKg, g);
    // Inerzia semplice: ~5 s per arrivare alla velocità di equilibrio.
    r.speedMs = r.speedMs + (vTarget - r.speedMs) * Math.min(1, dt / 5);
    r.distM = Math.min(course.lengthM, r.distM + r.speedMs * dt);
  }

  // Sorpassi e incitamenti, solo tra vicini.
  for (const r of state.riders) {
    if (r.id === ME_ID) continue;
    const ahead = r.distM > m.distM;
    const gap = Math.abs(r.distM - m.distM);
    const was = state.relPos[r.id];
    state.relPos[r.id] = ahead;
    const quiet = state.t - (state.lastTalk[r.id] ?? -1e9) > 45;
    if (was !== undefined && was !== ahead && gap < 60) {
      pushMsg(state, r, ahead ? `${r.name} ti ha passato`: `Hai passato ${r.name}`, true);
      if (quiet && roll(state) < 0.7) pushMsg(state, r, pick(state, ahead ? PASSING_ME : PASSED_BY_ME));
    } else if (quiet && gap < 80 && roll(state) < 0.004 * dt) {
      pushMsg(state, r, pick(state, CHEERS));
    }
  }

  const due = state.pendingReplies.filter((p) => p.at <= state.t);
  state.pendingReplies = state.pendingReplies.filter((p) => p.at > state.t);
  for (const p of due) {
    const r = state.riders.find((x) => x.id === p.fromId);
    if (r) pushMsg(state, r, p.text);
  }
  return state;
}

/* ── Viste derivate ── */

export type CircleFilter = "all" | "friends" | "group";

export function matchesFilter(r: Rider, filter: CircleFilter, group?: string | null): boolean {
  if (r.circle === "me") return true;
  if (filter === "friends") return r.circle === "friend";
  if (filter === "group") return group ? r.groups.includes(group) : r.circle === "group" || r.groups.length > 0;
  return true;
}

export type RelativeRider = { rider: Rider; gapM: number; gapS: number };

/** I più vicini davanti e dietro a me, con distacco in metri e secondi (al mio passo attuale). */
export function aroundMe(state: SimState, filter: CircleFilter = "all", group?: string | null, n = 4): {
  ahead: RelativeRider[];
  behind: RelativeRider[];
  position: number;
  total: number;
} {
  const m = me(state);
  const pool = state.riders.filter((r) => matchesFilter(r, filter, group));
  const sorted = [...pool].sort((a, b) => b.distM - a.distM);
  const v = Math.max(m.speedMs, 1);
  const rel = (r: Rider): RelativeRider => ({ rider: r, gapM: r.distM - m.distM, gapS: (r.distM - m.distM) / v });
  const others = pool.filter((r) => r.id !== ME_ID);
  return {
    ahead: others.filter((r) => r.distM > m.distM).sort((a, b) => a.distM - b.distM).slice(0, n).map(rel),
    behind: others.filter((r) => r.distM <= m.distM).sort((a, b) => b.distM - a.distM).slice(0, n).map(rel),
    position: sorted.findIndex((r) => r.id === ME_ID) + 1,
    total: sorted.length,
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}
