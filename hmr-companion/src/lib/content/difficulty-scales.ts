/**
 * Scale di difficoltà usate dai percorsi (OSM, camptocamp, upload utente) con una riga di
 * spiegazione in italiano per grado. Le spiegazioni sono volutamente sintetiche e prudenti:
 * il grado indica la difficoltà tecnica in condizioni normali, non la sicurezza del giorno.
 */
import type { UserRouteActivity } from "@/lib/sports";

export type ScaleId =
  | "sac"
  | "toponeige"
  | "ski_exposition"
  | "labande_ski"
  | "husler"
  | "wt"
  | "snowshoe_c2c"
  | "ifas"
  | "mtb_scale"
  | "mtb_c2c_down"
  | "mtb_c2c_up";

export type GradeDef = { value: string; label: string; explanation: string };

export type ScaleDef = {
  id: ScaleId;
  /** Nome esteso della scala. */
  name: string;
  /** Nome breve per chip/tooltip. */
  short: string;
  grades: GradeDef[];
};

export type Grade = {
  scale: ScaleId;
  scaleName: string;
  value: string;
  label: string;
  explanation: string;
};

export const DIFFICULTY_SCALES: Record<ScaleId, ScaleDef> = {
  sac: {
    id: "sac",
    name: "Scala escursionistica SAC (T1–T6)",
    short: "SAC",
    grades: [
      { value: "T1", label: "Escursione", explanation: "Sentiero ben tracciato e poco ripido, senza pericolo di caduta." },
      { value: "T2", label: "Escursione di montagna", explanation: "Sentiero continuo, a tratti ripido; serve passo sicuro e scarponcini." },
      { value: "T3", label: "Escursione di montagna impegnativa", explanation: "Tratti esposti o detritici, a volte con l'aiuto delle mani; serve passo molto sicuro." },
      { value: "T4", label: "Itinerario alpino", explanation: "Traccia non sempre evidente, terreno esposto e ripido; serve esperienza di montagna." },
      { value: "T5", label: "Itinerario alpino impegnativo", explanation: "Spesso senza traccia, passaggi di arrampicata facile e terreno delicato; esperienza alpina richiesta." },
      { value: "T6", label: "Itinerario alpino difficile", explanation: "Terreno alpino molto esposto e senza traccia, arrampicata facile; solo per alpinisti esperti." },
    ],
  },
  toponeige: {
    id: "toponeige",
    name: "Difficoltà tecnica sciistica (Toponeige 1–5)",
    short: "Toponeige",
    grades: [
      { value: "1", label: "Facile", explanation: "Pendii dolci e aperti, adatti a chi inizia lo scialpinismo." },
      { value: "2", label: "Poco difficile", explanation: "Pendenze moderate e qualche passaggio più stretto; serve buona tecnica di discesa." },
      { value: "3", label: "Abbastanza difficile", explanation: "Pendii sostenuti o tratti stretti; serve sciare con sicurezza su ogni tipo di neve." },
      { value: "4", label: "Difficile", explanation: "Pendii ripidi e lunghi o canali; richiede tecnica solida ed esperienza." },
      { value: "5", label: "Molto difficile / estremo", explanation: "Pendii molto ripidi o canali esposti: sci ripido riservato a esperti." },
    ],
  },
  ski_exposition: {
    id: "ski_exposition",
    name: "Esposizione (E1–E4)",
    short: "Esposizione",
    grades: [
      { value: "E1", label: "Poco esposto", explanation: "Una caduta ha conseguenze limitate, salvo ostacoli sotto il pendio." },
      { value: "E2", label: "Esposto", explanation: "Una caduta può portare a scivolate lunghe o contro ostacoli: conseguenze serie." },
      { value: "E3", label: "Molto esposto", explanation: "Sotto il pendio ci sono salti o rocce: una caduta può essere mortale." },
      { value: "E4", label: "Estremamente esposto", explanation: "Esposizione continua sopra grandi salti: una caduta è quasi certamente mortale." },
    ],
  },
  labande_ski: {
    id: "labande_ski",
    name: "Difficoltà sciistica Blachère/Labande (S1–S7)",
    short: "Labande",
    grades: [
      { value: "S1", label: "Molto facile", explanation: "Pendenze dolci, discesa alla portata di ogni sciatore." },
      { value: "S2", label: "Facile", explanation: "Pendenze moderate, paragonabili a una pista facile." },
      { value: "S3", label: "Abbastanza difficile", explanation: "Pendii più sostenuti; serve un buon livello di sci fuori pista." },
      { value: "S4", label: "Difficile", explanation: "Pendii ripidi o passaggi stretti; tecnica sicura richiesta." },
      { value: "S5", label: "Molto difficile", explanation: "Pendii molto ripidi e prolungati; per sciatori esperti." },
      { value: "S6", label: "Estremo", explanation: "Sci ripido con forte esposizione; riservato a specialisti." },
      { value: "S7", label: "Estremo con salti o passaggi aerei", explanation: "Il livello più alto della scala; solo per specialisti dello sci ripido." },
    ],
  },
  husler: {
    id: "husler",
    name: "Vie ferrate (Hüsler K1–K6)",
    short: "Hüsler",
    grades: [
      { value: "K1", label: "Facile", explanation: "Percorso attrezzato semplice, con cavi e gradini; adatto anche a principianti accompagnati." },
      { value: "K2", label: "Poco difficile", explanation: "Tratti ripidi ma ben attrezzati; servono un minimo di forza nelle braccia e assenza di vertigini." },
      { value: "K3", label: "Abbastanza difficile", explanation: "Tratti verticali e lunghi; servono allenamento ed esperienza di ferrata." },
      { value: "K4", label: "Difficile", explanation: "Passaggi verticali o strapiombanti con appoggi scarsi; richiede forza ed esperienza." },
      { value: "K5", label: "Molto difficile", explanation: "Lunghi tratti strapiombanti e faticosi; per ferratisti molto allenati." },
      { value: "K6", label: "Estremamente difficile", explanation: "Il livello più alto: passaggi atletici continui, riservati a esperti." },
    ],
  },
  wt: {
    id: "wt",
    name: "Escursioni invernali / racchette (WT1–WT6)",
    short: "WT",
    grades: [
      { value: "WT1", label: "Escursione facile con racchette", explanation: "Terreno pianeggiante o poco ripido, senza pericolo di valanghe o di caduta." },
      { value: "WT2", label: "Escursione con racchette", explanation: "Pendenze moderate; possibile esposizione limitata al pericolo valanghe." },
      { value: "WT3", label: "Escursione impegnativa con racchette", explanation: "Pendii più ripidi o brevi tratti esposti; serve saper valutare il pericolo valanghe." },
      { value: "WT4", label: "Itinerario con racchette", explanation: "Terreno ripido e a tratti esposto; esperienza invernale e valutazione valanghe necessarie." },
      { value: "WT5", label: "Itinerario alpino invernale", explanation: "Terreno alpino ripido, possibili passaggi su roccia o ghiaccio; esperienza alpina richiesta." },
      { value: "WT6", label: "Itinerario alpino invernale impegnativo", explanation: "Terreno alpino molto ripido ed esposto; riservato a esperti." },
    ],
  },
  snowshoe_c2c: {
    id: "snowshoe_c2c",
    name: "Racchette camptocamp (R1–R5)",
    short: "Racchette",
    grades: [
      { value: "R1", label: "Facile", explanation: "Terreno dolce e senza difficoltà particolari." },
      { value: "R2", label: "Poco difficile", explanation: "Qualche pendio più ripido; serve un minimo di esperienza." },
      { value: "R3", label: "Abbastanza difficile", explanation: "Pendii ripidi o terreno vario; servono esperienza e valutazione delle condizioni." },
      { value: "R4", label: "Difficile", explanation: "Terreno ripido e a tratti esposto; possono servire ramponi o piccozza." },
      { value: "R5", label: "Molto difficile", explanation: "Terreno alpino impegnativo; riservato a escursionisti invernali esperti." },
    ],
  },
  ifas: {
    id: "ifas",
    name: "Difficoltà alpinistica complessiva (IFAS F–ED)",
    short: "IFAS",
    grades: [
      { value: "F", label: "Facile", explanation: "Salita alpinistica semplice: terreno facile, ma possibili ghiacciai o creste." },
      { value: "PD", label: "Poco difficile", explanation: "Brevi passaggi di arrampicata o pendii di neve; serve conoscere le manovre di corda." },
      { value: "AD", label: "Abbastanza difficile", explanation: "Arrampicata o pendii più ripidi e continui; esperienza alpinistica richiesta." },
      { value: "D", label: "Difficile", explanation: "Passaggi tecnici sostenuti e itinerario lungo; per alpinisti esperti." },
      { value: "TD", label: "Molto difficile", explanation: "Difficoltà tecniche elevate e continue; per alpinisti molto esperti." },
      { value: "ED", label: "Estremamente difficile", explanation: "Difficoltà estreme e grande impegno; riservato ad alpinisti di alto livello." },
    ],
  },
  mtb_scale: {
    id: "mtb_scale",
    name: "Difficoltà sentiero MTB (mtb:scale 0–6)",
    short: "mtb:scale",
    grades: [
      { value: "0", label: "Molto facile", explanation: "Strada o sentiero largo e compatto, senza ostacoli." },
      { value: "1", label: "Facile", explanation: "Fondo a tratti sconnesso, piccole radici o sassi; serve un minimo di tecnica." },
      { value: "2", label: "Medio", explanation: "Ostacoli più grandi, gradini e tornanti larghi; buona tecnica di guida." },
      { value: "3", label: "Difficile", explanation: "Gradini alti, tornanti stretti e fondo scivoloso; ottima tecnica richiesta." },
      { value: "4", label: "Molto difficile", explanation: "Passaggi molto ripidi e tecnici; per biker molto esperti." },
      { value: "5", label: "Estremo", explanation: "Terreno quasi impraticabile in sella; solo specialisti." },
      { value: "6", label: "Non ciclabile", explanation: "Di norma non percorribile in bici." },
    ],
  },
  mtb_c2c_down: {
    id: "mtb_c2c_down",
    name: "Difficoltà in discesa MTB camptocamp (V1–V5)",
    short: "Discesa MTB",
    grades: [
      { value: "V1", label: "Facile", explanation: "Discesa su strade o sentieri larghi e senza ostacoli." },
      { value: "V2", label: "Poco difficile", explanation: "Sentiero con qualche ostacolo; serve una tecnica di base." },
      { value: "V3", label: "Abbastanza difficile", explanation: "Ostacoli frequenti, tratti ripidi o tornanti; buona tecnica richiesta." },
      { value: "V4", label: "Difficile", explanation: "Passaggi tecnici impegnativi; per biker esperti." },
      { value: "V5", label: "Molto difficile", explanation: "Discesa molto tecnica; riservata a specialisti." },
    ],
  },
  mtb_c2c_up: {
    id: "mtb_c2c_up",
    name: "Difficoltà in salita MTB camptocamp (M1–M5)",
    short: "Salita MTB",
    grades: [
      { value: "M1", label: "Facile", explanation: "Salita pedalabile senza difficoltà tecniche." },
      { value: "M2", label: "Poco difficile", explanation: "Salita con qualche tratto ripido o sconnesso." },
      { value: "M3", label: "Abbastanza difficile", explanation: "Tratti ripidi o tecnici; può servire spingere la bici." },
      { value: "M4", label: "Difficile", explanation: "Lunghi tratti molto ripidi o tecnici; spesso a spinta." },
      { value: "M5", label: "Molto difficile", explanation: "In gran parte non pedalabile; bici a spinta o in spalla." },
    ],
  },
};

/** Valori `sac_scale` di OpenStreetMap → grado SAC. */
export const OSM_SAC_TO_T: Record<string, string> = {
  hiking: "T1",
  mountain_hiking: "T2",
  demanding_mountain_hiking: "T3",
  alpine_hiking: "T4",
  demanding_alpine_hiking: "T5",
  difficult_alpine_hiking: "T6",
};

function normalizeValue(scale: ScaleId, raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  switch (scale) {
    case "sac": {
      const osm = OSM_SAC_TO_T[raw.trim().toLowerCase()];
      if (osm) return osm;
      const m = s.match(/^T([1-6])[+-]?$/);
      return m ? `T${m[1]}` : null;
    }
    case "toponeige": {
      const m = s.match(/^([1-5])(?:\.\d)?$/);
      return m ? m[1]! : null;
    }
    case "ifas": {
      // F, PD+, AD-, ED4 → grado base
      const m = s.match(/^(F|PD|AD|D|TD|ED)[+-]?\d*$/);
      return m ? m[1]! : null;
    }
    case "mtb_scale": {
      const m = s.match(/^([0-6])[+-]?$/);
      return m ? m[1]! : null;
    }
    default:
      return s.replace(/[+-]$/, "");
  }
}

/** Cerca un grado in una scala (tollerante su maiuscole, spazi, sottogradi). */
export function lookupGrade(scale: ScaleId, raw: unknown): Grade | null {
  if (raw == null) return null;
  const str = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : null;
  if (!str) return null;
  const def = DIFFICULTY_SCALES[scale];
  const norm = normalizeValue(scale, str);
  if (!norm) return null;
  const g = def.grades.find((x) => x.value === norm);
  if (!g) return null;
  // Mostra il valore originale quando è più preciso (2.3, PD+), ma per sac_scale OSM il grado T.
  const shown = scale === "sac" ? norm : str.trim().toUpperCase();
  return { scale, scaleName: def.name, value: shown, label: g.label, explanation: g.explanation };
}

/** Scala principale suggerita per uno sport (null se non ne esiste una di riferimento). */
export function scaleForSport(activity: UserRouteActivity): ScaleId | null {
  switch (activity) {
    case "hike":
    case "walk":
    case "trail_run":
    case "run":
      return "sac";
    case "ski":
      return "toponeige";
    case "snowshoe":
      return "wt";
    case "ferrata":
      return "husler";
    case "alpinism":
      return "ifas";
    case "mtb":
    case "ebike":
      return "mtb_scale";
    default:
      return null;
  }
}
