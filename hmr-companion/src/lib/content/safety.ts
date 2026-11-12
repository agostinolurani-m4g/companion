/**
 * Contenuti informativi della pagina Sicurezza (italiano).
 * Indicazioni generali e prudenti: non sostituiscono formazione, guide alpine
 * e bollettini ufficiali. Le scale di difficoltà stanno in `difficulty-scales.ts`.
 */

import type { UserRouteActivity } from "@/lib/sports";

export type EmergencyNumber = { number: string; label: string; where: string; note?: string };

export const EMERGENCY_NUMBERS: EmergencyNumber[] = [
  {
    number: "112",
    label: "Numero unico di emergenza europeo",
    where: "Italia, Svizzera, Francia e tutta l'Unione europea",
    note: "Gratuito, anche senza credito. Chiedi del Soccorso Alpino.",
  },
  {
    number: "118",
    label: "Emergenza sanitaria",
    where: "Italia",
    note: "Resta raggiungibile; dove è attivo il 112 la chiamata viene smistata alla centrale competente.",
  },
  {
    number: "1414",
    label: "Rega – soccorso aereo",
    where: "Svizzera",
  },
  {
    number: "144",
    label: "Ambulanza",
    where: "Svizzera",
  },
];

/** Cosa comunicare, nell'ordine in cui di solito viene chiesto. */
export const CALL_SCRIPT: { title: string; detail: string }[] = [
  { title: "Chi sei", detail: "Nome e numero di telefono da cui chiami. Tieni il telefono acceso e la linea libera dopo la chiamata." },
  { title: "Cosa è successo", detail: "Tipo di incidente (caduta, valanga, malore, persona dispersa, bloccati)." },
  {
    title: "Dove sei",
    detail: "Coordinate GPS (sopra trovi le tue), quota, nome del sentiero, del rifugio o della vetta più vicina, versante.",
  },
  { title: "Quante persone", detail: "Numero di feriti, condizioni (coscienti, respirano, sanguinano), età approssimativa." },
  { title: "Condizioni sul posto", detail: "Meteo, visibilità, vento, ostacoli per l'elicottero (cavi, teleferiche, alberi)." },
  { title: "Non riattaccare per primo", detail: "Rispondi alle domande dell'operatore e segui le sue istruzioni." },
];

export const RESCUE_TIPS: string[] = [
  "Mettiti al sicuro prima di soccorrere: non creare un secondo incidente.",
  "Se non c'è campo, prova a spostarti in un punto più aperto o più alto; il 112 può funzionare anche con la rete di un altro operatore.",
  "Proteggi il ferito dal freddo (coperta termica, vestiti asciutti) anche d'estate.",
  "Segnale internazionale di soccorso alpino: 6 segnali al minuto (fischio, luce o richiamo), un minuto di pausa, poi ripeti. La risposta è di 3 segnali al minuto.",
  "Verso l'elicottero: braccia alzate a «Y» = «Sì, abbiamo bisogno di aiuto»; un braccio alzato e uno abbassato = «Non serve aiuto».",
  "Non avvicinarti all'elicottero finché l'equipaggio non te lo indica e fissa gli oggetti leggeri.",
];

export type ChecklistGroup = { id: string; title: string; items: string[] };

const BASE: ChecklistGroup = {
  id: "base",
  title: "Sempre nello zaino",
  items: [
    "Telefono carico e batteria di riserva",
    "Acqua e cibo per l'intera uscita, più una scorta",
    "Giacca impermeabile e uno strato caldo",
    "Kit di primo soccorso e coperta termica",
    "Frontale (le giornate si accorciano, gli imprevisti allungano)",
    "Mappa o traccia scaricata offline",
    "Crema solare e occhiali da sole",
    "Fischietto",
  ],
};

const WINTER_SNOW: ChecklistGroup = {
  id: "avalanche",
  title: "Terreno innevato (autosoccorso valanga)",
  items: [
    "ARTVA acceso in trasmissione e controllato alla partenza",
    "Pala e sonda: ARTVA, pala e sonda vanno sempre insieme e per ogni componente del gruppo",
    "Zaino airbag (facoltativo, non sostituisce gli altri tre)",
    "Bollettino valanghe letto prima di partire",
    "Guanti e berretto di ricambio, thermos con bevanda calda",
  ],
};

const SKI_TOUR: ChecklistGroup = {
  id: "ski",
  title: "Scialpinismo",
  items: ["Pelli e coltelli (rampant)", "Ramponi e piccozza se il percorso lo richiede", "Casco nelle discese impegnative"],
};

const FERRATA: ChecklistGroup = {
  id: "ferrata",
  title: "Via ferrata",
  items: [
    "Casco",
    "Imbracatura",
    "Set da ferrata con dissipatore omologato (EN 958), controlla che non sia oggetto di richiami",
    "Guanti da ferrata",
    "Informati sulle condizioni dei cavi e sull'orario di eventuali temporali",
  ],
};

const ALPINISM: ChecklistGroup = {
  id: "alpinism",
  title: "Alpinismo",
  items: [
    "Casco e imbracatura",
    "Corda e materiale di assicurazione adeguati all'itinerario",
    "Ramponi e piccozza su neve o ghiaccio",
    "Materiale per autosoccorso in crepaccio sui ghiacciai",
  ],
};

const BIKE: ChecklistGroup = {
  id: "bike",
  title: "Bici",
  items: [
    "Casco",
    "Camera d'aria o kit tubeless, pompa, smagliacatena e multiattrezzo",
    "Luci anteriore e posteriore",
    "Antivento per le discese",
  ],
};

const EBIKE: ChecklistGroup = {
  id: "ebike",
  title: "E-bike",
  items: ["Autonomia della batteria calcolata sul dislivello, con margine", "Caricabatterie se prevedi soste lunghe"],
};

const RUN: ChecklistGroup = {
  id: "run",
  title: "Corsa e trail",
  items: [
    "Giacca antivento leggera anche se parti col caldo",
    "Coperta termica e telefono raggiungibile senza togliere lo zaino",
    "Comunica il percorso e l'orario di rientro a qualcuno",
  ],
};

const HIKE: ChecklistGroup = {
  id: "hike",
  title: "Escursionismo",
  items: ["Scarpe con suola scolpita", "Bastoncini sui tratti ripidi", "Comunica il percorso e l'orario di rientro a qualcuno"],
};

const NORDIC: ChecklistGroup = {
  id: "nordic",
  title: "Sci di fondo",
  items: ["Abbigliamento a strati traspirante", "Sciolina o pelli adatte alla neve del giorno", "Fuori dalle piste battute vale anche la checklist del terreno innevato"],
};

const BY_SPORT: Record<UserRouteActivity, ChecklistGroup[]> = {
  road: [BIKE],
  gravel: [BIKE],
  mtb: [BIKE],
  ebike: [BIKE, EBIKE],
  bikepacking: [BIKE],
  hike: [HIKE],
  walk: [HIKE],
  trail_run: [RUN],
  run: [RUN],
  ferrata: [FERRATA],
  alpinism: [ALPINISM],
  ski: [WINTER_SNOW, SKI_TOUR],
  snowshoe: [WINTER_SNOW],
  nordic: [NORDIC],
};

export function checklistForSport(activity: UserRouteActivity): ChecklistGroup[] {
  return [BASE, ...(BY_SPORT[activity] ?? [])];
}

export type AvalancheDangerLevel = {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  snowpack: string;
  triggering: string;
  advice: string;
};

/**
 * Scala europea del pericolo valanghe (EAWS), sintesi in italiano.
 * Il grado vale per una regione, non per il singolo pendio.
 */
export const AVALANCHE_DANGER_SCALE: AvalancheDangerLevel[] = [
  {
    level: 1,
    name: "Debole",
    snowpack: "Manto nevoso in generale ben consolidato e stabile.",
    triggering: "Distacco in generale possibile solo con forte sovraccarico, in punti isolati su terreno ripido estremo. Possibili solo valanghe spontanee piccole o medie.",
    advice: "Condizioni generalmente favorevoli; restano possibili punti pericolosi isolati.",
  },
  {
    level: 2,
    name: "Moderato",
    snowpack: "Manto moderatamente consolidato su alcuni pendii ripidi, altrimenti ben consolidato.",
    triggering: "Distacco possibile soprattutto con forte sovraccarico, in particolare sui pendii ripidi indicati nel bollettino. Valanghe spontanee molto grandi improbabili.",
    advice: "Valuta pendio per pendio, in particolare le esposizioni e le quote indicate.",
  },
  {
    level: 3,
    name: "Marcato",
    snowpack: "Manto da moderatamente a debolmente consolidato su molti pendii ripidi.",
    triggering: "Distacco possibile già con debole sovraccarico (anche un singolo escursionista), in particolare sui pendii ripidi indicati. In certe situazioni possibili alcune valanghe spontanee grandi, in casi isolati molto grandi.",
    advice: "Situazione critica: esperienza e capacità di valutazione necessarie; evita i pendii ripidi nelle esposizioni indicate. Una parte rilevante degli incidenti avviene ai gradi 2 e 3.",
  },
  {
    level: 4,
    name: "Forte",
    snowpack: "Manto debolmente consolidato sulla maggior parte dei pendii ripidi.",
    triggering: "Distacco probabile già con debole sovraccarico su molti pendii ripidi. In alcuni casi da attendersi numerose valanghe spontanee grandi, spesso molto grandi.",
    advice: "Limitati a terreno poco ripido e lontano dalle zone di scorrimento delle valanghe.",
  },
  {
    level: 5,
    name: "Molto forte",
    snowpack: "Manto nevoso in generale debolmente consolidato e instabile.",
    triggering: "Da attendersi numerose valanghe spontanee molto grandi, spesso estremamente grandi, anche su terreno moderatamente ripido.",
    advice: "Rinuncia alle escursioni su terreno innevato.",
  },
];

export const AVALANCHE_SCALE_NOTE =
  "Il grado di pericolo è una sintesi regionale: leggi sempre anche problemi valanghivi, quote ed esposizioni del bollettino e osserva il terreno sul posto.";

export const SAFETY_SOURCES: { label: string; url: string }[] = [
  { label: "EAWS – scala europea del pericolo valanghe", url: "https://www.avalanches.org/standards/avalanche-danger-scale/" },
  { label: "AINEVA – bollettini valanghe in Italia", url: "https://www.aineva.it" },
  { label: "CNSAS – Corpo Nazionale Soccorso Alpino e Speleologico", url: "https://www.cnsas.it" },
];
