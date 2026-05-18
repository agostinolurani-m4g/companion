/**
 * Dati statici estratti direttamente dal "HMR 2026 Race Manual".
 * Tutti gli `along_km` sono quelli dichiarati dagli organizzatori: il vero lat/lng
 * del POI viene derivato in fase di ingest proiettando `along_km` sulla traccia.
 */

export type StaticCheckpointSeed = {
  id: string;
  name: string;
  label: string;
  /** Coordinate dichiarate nel manuale (fallback se la proiezione non è attendibile). */
  lat: number;
  lng: number;
  along_km: number;
  cutoff_utc: number;
  kind: "cp" | "finish" | "start";
  notes: string;
};

/**
 * Cutoffs: nel manuale i CP1/CP2/Finish chiudono "midnight" ossia a fine giornata
 * locale (Europe/Athens, GMT+3 a maggio); CP3 chiude alle 12:00 locali.
 *
 * Grecia a maggio è UTC+3 (EEST): 24:00 locali di un giorno = 21:00 UTC
 * dello stesso giorno. 12:00 locali = 09:00 UTC.
 *
 * Nota: il manuale scrive "(GMT +1)" ma CET non è il fuso greco in maggio.
 * Usiamo EEST (UTC+3) perché la gara si corre in Grecia.
 */
const UTC = (isoLocal: string, offsetMinutes: number) =>
  Date.parse(isoLocal + "Z") - offsetMinutes * 60 * 1000;

const EEST_OFFSET_MIN = 3 * 60;

export const STATIC_CHECKPOINTS: StaticCheckpointSeed[] = [
  {
    id: "cp0-start",
    name: "Start",
    label: "Agios Athanasios (Pella)",
    kind: "start",
    // Primo <trkpt> del GPX ufficiale (elev ≈1211 m). Le coordinate del paese
    // di Agios Athanasios (40.9687, 21.9025) cadono a ~9.5 km dalla traccia
    // e proiettano CP0 a km 17.8 — allineiamo al reale inizio GPX.
    lat: 40.839747,
    lng: 21.767284,
    along_km: 0,
    cutoff_utc: UTC("2026-05-23T09:00:00", EEST_OFFSET_MIN),
    notes: "Partenza ufficiale HMR 2026 · 09:00 locali (GMT+3).",
  },
  {
    id: "cp1-smolikas",
    name: "CP1 Smolikas",
    label: "Munti Smolikas refuge (Pades)",
    kind: "cp",
    // Allineato a Pades del resupply (stesso punto del manuale).
    // Il "km 247" che avevo letto prima era la distanza a Konitsa, non al CP.
    lat: 40.039507,
    lng: 20.908737,
    along_km: 238,
    cutoff_utc: UTC("2026-05-27T00:00:00", EEST_OFFSET_MIN),
    notes:
      "Hot food, snacks, dormitory. Salì a piedi + singletrack in discesa. Chiude a fine martedì 26 maggio (mezzanotte locale).",
  },
  {
    id: "cp2-melissourgi",
    name: "CP2 Melissourgi",
    label: "Melissourgiotiko Mountain Refuge",
    kind: "cp",
    lat: 39.5051,
    lng: 21.1415,
    along_km: 484,
    cutoff_utc: UTC("2026-05-29T00:00:00", EEST_OFFSET_MIN),
    notes:
      "Hot food 24/7, snacks, dormitory. Ultimo rifugio prima dei tratti più remoti. Chiude a fine mercoledì 28 maggio (mezzanotte locale).",
  },
  {
    id: "cp3-karpenisi",
    name: "CP3 Karpenisi",
    label: "Hotel Elevetia",
    kind: "cp",
    lat: 38.9146,
    lng: 21.7947,
    along_km: 729,
    cutoff_utc: UTC("2026-05-30T12:00:00", EEST_OFFSET_MIN),
    notes:
      "Hotel + ristoranti in paese. Checkpoint senza cibo 24/7 (gyros aperto fino a tardi). Chiude venerdì 30 maggio 12:00 locali.",
  },
  {
    id: "finish-nafpaktos",
    name: "Finish",
    label: "Nafpaktos (Lepanto Beach Hotel)",
    kind: "finish",
    lat: 38.3913,
    lng: 21.838,
    along_km: 922,
    cutoff_utc: UTC("2026-05-31T00:00:00", EEST_OFFSET_MIN),
    notes: "Arrivo. Party finisher sabato 30 maggio ore 21:00 locali.",
  },
];

export type StaticResupplySeed = {
  id: string;
  name: string;
  along_km: number;
  leg_km: number | null;
  notes: string;
  /** Se presenti, ingest proietta sulla traccia e ricava `along_km` (GPX FINAL). */
  lat?: number;
  lng?: number;
};

/** Tabella resupply ufficiale (Race Manual pag. 7). */
export const STATIC_RESUPPLY: StaticResupplySeed[] = [
  { id: "r-achlada", name: "Achlada", along_km: 48, leg_km: 48, notes: "Village shop." },
  { id: "r-ammochori", name: "Ammochori", along_km: 63, leg_km: 15, notes: "Several shops & restaurants." },
  { id: "r-kastoria", name: "Kastoria", along_km: 130, leg_km: 67, notes: "Many shops, hotels, restaurants." },
  { id: "r-fourka", name: "Fourka", along_km: 211, leg_km: 81, notes: "Two restaurants & a hotel." },
  { id: "r-agia-paraskevi", name: "Agia Paraskevi", along_km: 222, leg_km: 11, notes: "Shop & hotel & restaurants." },
  {
    id: "r-pades",
    name: "Pades",
    along_km: 238,
    leg_km: 16,
    notes: "CP1: hot food, snacks, dormitory.",
  },
  { id: "r-konitsa", name: "Konitsa", along_km: 267, leg_km: 29, notes: "Shops, restaurants, hotels." },
  { id: "r-klidonia", name: "Klidonia", along_km: 279, leg_km: 12, notes: "Petrol station shop." },
  {
    id: "r-aristi",
    name: "Aristi",
    along_km: 0,
    leg_km: null,
    notes: "Hotels (GPX FINAL).",
    lat: 39.93456,
    lng: 20.67135,
  },
  { id: "r-monodendri", name: "Monodendri", along_km: 314, leg_km: 35, notes: "Restaurants and hotels." },
  {
    id: "r-vitsa",
    name: "Vitsa",
    along_km: 0,
    leg_km: null,
    notes: "Lodging and shops (GPX FINAL).",
    lat: 39.87365356384967,
    lng: 20.751893022973945,
  },
  { id: "r-kipoi", name: "Kipoi", along_km: 323, leg_km: 9, notes: "Shop and restaurant." },
  { id: "r-metsovo", name: "Metsovo", along_km: 406, leg_km: 83, notes: "Hotels, restaurants & shops." },
  { id: "r-syrrako", name: "Syrrako", along_km: 458, leg_km: 52, notes: "Hotels, restaurants." },
  {
    id: "r-melissourgi",
    name: "Melissourgi",
    along_km: 485,
    leg_km: 27,
    notes: "CP2: hot food 24/7, snacks, dormitory.",
  },
  { id: "r-kastanea", name: "Kastanea", along_km: 540, leg_km: 55, notes: "Cafe (possibilmente l'unico del tratto)." },
  { id: "r-miliana", name: "Miliana", along_km: 551, leg_km: 11, notes: "Restaurant & shop." },
  { id: "r-piges", name: "Piges", along_km: 567, leg_km: 16, notes: "Restaurant." },
  { id: "r-raptopoulou", name: "Raptopoulou", along_km: 615, leg_km: 48, notes: "Restaurants & shops." },
  { id: "r-limeri", name: "Limeri", along_km: 638, leg_km: 23, notes: "Restaurants & coffee shops." },
  { id: "r-krentis", name: "Krentis", along_km: 660, leg_km: 22, notes: "Petrol station shop." },
  {
    id: "r-hotel-makkas",
    name: "Hotel Makkas",
    along_km: 0,
    leg_km: null,
    notes: "Friendly hotel that have hosted riders in the past.",
    lat: 39.000049972702556,
    lng: 21.61845636264573,
  },
  { id: "r-agia-triada", name: "Agia Triada", along_km: 704, leg_km: 44, notes: "Hotel." },
  {
    id: "r-karpenissi",
    name: "Karpenissi",
    along_km: 729,
    leg_km: 25,
    notes: "CP3: hotels & restaurants (niente cibo 24/7 al CP).",
  },
  {
    id: "r-kastania-2",
    name: "Kastania (sud)",
    along_km: 810,
    leg_km: 81,
    notes: "Restaurant possibly closed — non fare affidamento.",
  },
  { id: "r-thermo", name: "Thermo", along_km: 874, leg_km: 64, notes: "Several shops & restaurants." },
  {
    id: "r-nafpaktos",
    name: "Nafpaktos",
    along_km: 922,
    leg_km: 48,
    notes: "FINISH: all you need in town.",
  },
];

export type StaticSectionSeed = {
  id: string;
  label: string;
  km_start: number;
  km_end: number;
  severity: "info" | "warn" | "hard";
  description: string;
  description_en: string;
  /** GPX waypoint: ingest proietta e imposta km ± span_km/2 (ignora km_start/km_end se presenti). */
  anchor_lat?: number;
  anchor_lng?: number;
  span_km?: number;
};

/** "Toughest Sections & Notable Difficulties" (Race Manual pag. 8). */
export const STATIC_SECTIONS: StaticSectionSeed[] = [
  {
    id: "sec-kajmakcalan",
    label: "Kajmakčalan",
    km_start: 14,
    km_end: 29,
    severity: "hard",
    description:
      "Grande salita ripida, meteo esposto e notoriamente brutto. Track a tratti difficile da seguire.",
    description_en:
      "Steep climb to an exposed summit with notoriously bad weather. Track difficult to follow in places.",
  },
  {
    id: "sec-smolikas",
    label: "Smolikas hike + singletrack",
    km_start: 222,
    km_end: 238,
    severity: "hard",
    description:
      "~9 km di hike in salita, poi uno dei singletrack più belli della Grecia in discesa — vero mountain bike.",
    description_en:
      "~9 km steep hike on foot to the summit, then one of Greece's finest singletrack descents — true mountain-bike terrain.",
  },
  {
    id: "sec-steep-hike-298",
    label: "Hike senza traccia visibile",
    km_start: 298,
    km_end: 300,
    severity: "warn",
    description: "Hike ripido breve, traccia quasi invisibile.",
    description_en: "Short steep hike, track almost invisible on the ground.",
  },
  {
    id: "sec-stone-path-317",
    label: "Stone paved pathway",
    km_start: 317,
    km_end: 319,
    severity: "warn",
    description: "Mulattiera lastricata: tecnica in discesa, hike in salita, scivolosa se bagnata.",
    description_en: "Stone paved mule path: technical descent, hike uphill, very slippery when wet.",
  },
  {
    id: "sec-vikos-gorge",
    label: "Vikos Gorge",
    km_start: 300,
    km_end: 310,
    severity: "hard",
    description: "Salita ripida a Vikos, traccia quasi assente; vista obbligatoria sul gorge.",
    description_en:
      "Steep hike to the top of Vikos Gorge — trail almost non-existent. Mandatory viewpoint into the gorge.",
  },
  {
    id: "sec-washed-out-cp2",
    label: "Washed out roads after CP2",
    km_start: 486,
    km_end: 492,
    severity: "warn",
    description: "Strade danneggiate / franate subito dopo CP2.",
    description_en: "Several washed-out and badly damaged road sections just after CP2.",
  },
  {
    id: "sec-road-damaged",
    label: "Road damaged",
    km_start: 0,
    km_end: 0,
    severity: "warn",
    description: "Tratto con strada danneggiata (waypoint GPX).",
    description_en: "Road damaged.",
    anchor_lat: 39.83756890943954,
    anchor_lng: 21.039143268008644,
    span_km: 4,
  },
  {
    id: "sec-post-cp2-high",
    label: "High mountains after CP2",
    km_start: 484,
    km_end: 510,
    severity: "hard",
    description:
      "Montagne alte, strade ripide e a tratti danneggiate. Se il tempo peggiora non è facile.",
    description_en:
      "High mountain terrain with steep and partially damaged roads. Gets serious if weather deteriorates.",
  },
  {
    id: "sec-steep-hike-673",
    label: "Steep hike to main road",
    km_start: 673,
    km_end: 678,
    severity: "warn",
    description: "Salita ripida a piedi da ponte fino alla strada principale.",
    description_en: "Steep hike on foot from the bridge up to the main road.",
  },
  {
    id: "sec-karpenisi-climb",
    label: "Big tarmac climb → Karpenisi",
    km_start: 704,
    km_end: 718,
    severity: "warn",
    description: "Lunga salita asfaltata di accesso a Karpenisi (CP3).",
    description_en: "Long tarmac climb up to Karpenisi (CP3).",
  },
  {
    id: "sec-kaliakoudas",
    label: "Kaliakoudas pass",
    km_start: 775,
    km_end: 780,
    severity: "hard",
    description: "Grande salita e discesa sopra il passo Diaselo Kaliakoudas.",
    description_en: "Big climb and descent over the Diaselo Kaliakoudas pass.",
  },
  {
    id: "sec-final-nafpaktos",
    label: "Final Nafpaktos climb",
    km_start: 896,
    km_end: 906,
    severity: "hard",
    description:
      "Ultima sfida prima dell'arrivo: salita massiccia in cima alla montagna sopra Nafpaktos.",
    description_en:
      "Final challenge before the finish: massive climb to the mountain top above Nafpaktos.",
  },
];

/** Ponti dal GPX FINAL (RideWithGPS) — unico layer con colore dedicato in mappa. */
export type StaticBridgeSeed = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description_en: string;
};

export const STATIC_BRIDGES: StaticBridgeSeed[] = [
  {
    id: "br-konitsa-stone",
    name: "Stone bridge (Konitsa)",
    lat: 40.0365253046175,
    lng: 20.745136960206793,
    description_en: "A rather pretty stone bridge. More to come.",
  },
  {
    id: "br-misiou",
    name: "Misiou Bridge",
    lat: 39.86953025989115,
    lng: 20.764246251613287,
    description_en: "Misiou Bridge — stone arch on the Zagori route.",
  },
  {
    id: "br-kalogeriko",
    name: "Kalogeriko Bridge",
    lat: 39.86166756642584,
    lng: 20.78631792003631,
    description_en: "Kalogeriko Bridge — triple-arch stone bridge near Kipoi.",
  },
  {
    id: "br-stenoma-viniani",
    name: "Stenoma-Viniani Bridge",
    lat: 38.97964244322915,
    lng: 21.69855574647343,
    description_en: "Stenoma-Viniani Bridge.",
  },
];
