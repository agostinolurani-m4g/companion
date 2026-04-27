/** Link di ricerca Google Maps (nessuna API key; apre il sito Google). */
export function googleMapsSearchUrl(lat: number, lng: number, label?: string): string {
  const q = label?.trim()
    ? `${label.trim()} @ ${lat},${lng}`
    : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
