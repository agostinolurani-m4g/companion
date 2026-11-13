/** Metadati estratti dal racconto (voce o testo) di una gita fatta. */
export type OutingExtractMeta = {
  name: string;
  zone: string;
  elev_gain_m: number | null;
  elev_loss_m: number | null;
  difficulty: string | null;
  exposition: string | null;
  elevation_max_m: number | null;
  notes: string | null;
};

export function emptyOutingExtractMeta(): OutingExtractMeta {
  return {
    name: "",
    zone: "",
    elev_gain_m: null,
    elev_loss_m: null,
    difficulty: null,
    exposition: null,
    elevation_max_m: null,
    notes: null,
  };
}
