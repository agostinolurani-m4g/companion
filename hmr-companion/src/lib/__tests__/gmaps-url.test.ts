import { describe, expect, it, vi } from "vitest";
import {
  GmapsParseError,
  googleMapsSearchUrl,
  googleMapsStreetViewLayerUrl,
  parseGoogleMapsUrl,
} from "../gmaps-url";

describe("parseGoogleMapsUrl", () => {
  it("estrae lat/lng e nome da /place/.../@.../!3d!4d", async () => {
    const r = await parseGoogleMapsUrl(
      "https://www.google.com/maps/place/Ristoro+Kaimaktsalan/@40.9306,21.7861,17z/data=!3d40.9306!4d21.7861"
    );
    expect(r.lat).toBeCloseTo(40.9306, 4);
    expect(r.lng).toBeCloseTo(21.7861, 4);
    expect(r.name).toBe("Ristoro Kaimaktsalan");
  });

  it("preferisce !3d!4d rispetto a @lat,lng se entrambi presenti", async () => {
    const r = await parseGoogleMapsUrl(
      "https://www.google.com/maps/place/X/@40.0,20.0,17z/data=!3d41.5!4d21.5"
    );
    expect(r.lat).toBeCloseTo(41.5, 4);
    expect(r.lng).toBeCloseTo(21.5, 4);
  });

  it("funziona con ?q=lat,lng", async () => {
    const r = await parseGoogleMapsUrl(
      "https://maps.google.com/?q=39.5041,21.1419"
    );
    expect(r.lat).toBeCloseTo(39.5041, 4);
    expect(r.lng).toBeCloseTo(21.1419, 4);
  });

  it("funziona con /maps/search/?api=1&query=lat,lng", async () => {
    const r = await parseGoogleMapsUrl(
      "https://www.google.com/maps/search/?api=1&query=38.91,21.80"
    );
    expect(r.lat).toBeCloseTo(38.91, 3);
    expect(r.lng).toBeCloseTo(21.8, 3);
  });

  it("decodifica caratteri URL nel nome (%C3%A9 → é, + → spazio)", async () => {
    const r = await parseGoogleMapsUrl(
      "https://www.google.com/maps/place/Caff%C3%A9+du+Village/@40.0,20.0,17z/data=!3d40.0!4d20.0"
    );
    expect(r.name).toBe("Caffé du Village");
  });

  it("estrae un URL anche se incollato dentro un testo", async () => {
    const r = await parseGoogleMapsUrl(
      "Ciao guarda qui https://www.google.com/maps/place/X/@40.0,20.0,17z/data=!3d40.0!4d20.0 🗺"
    );
    expect(r.lat).toBeCloseTo(40, 3);
  });

  it("ignora punteggiatura finale incollata con l'URL", async () => {
    const r = await parseGoogleMapsUrl(
      "https://www.google.com/maps/place/X/@40.0,20.0,17z/data=!3d40.0!4d20.0."
    );
    expect(r.lat).toBeCloseTo(40, 3);
  });

  it("lancia GmapsParseError su URL vuoto", async () => {
    await expect(parseGoogleMapsUrl("")).rejects.toBeInstanceOf(GmapsParseError);
  });

  it("lancia GmapsParseError se URL non contiene coordinate", async () => {
    await expect(
      parseGoogleMapsUrl("https://example.com/not-a-map")
    ).rejects.toBeInstanceOf(GmapsParseError);
  });

  it("segue i redirect per short URL maps.app.goo.gl", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://maps.app.goo.gl/")) {
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.google.com/maps/place/Melissourgi/@39.5041,21.1419,17z/data=!3d39.5041!4d21.1419",
          },
        });
      }
      throw new Error("unexpected fetch: " + url);
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    try {
      const r = await parseGoogleMapsUrl("https://maps.app.goo.gl/abc123");
      expect(r.lat).toBeCloseTo(39.5041, 4);
      expect(r.lng).toBeCloseTo(21.1419, 4);
      expect(r.name).toBe("Melissourgi");
      expect(r.googleUrl).toContain("google.com/maps/place");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("googleMapsSearchUrl", () => {
  it("genera URL search con coordinate", () => {
    const u = googleMapsSearchUrl(46.5, 10.3);
    expect(u).toContain("google.com/maps/search/");
    expect(u).toContain("query=46.5");
    expect(u).toContain("10.3");
  });

  it("include il nome se presente", () => {
    const u = googleMapsSearchUrl(46.5, 10.3, "Bivacco Tuckett");
    expect(u).toContain("Bivacco");
    expect(u).toContain("Tuckett");
  });
});

describe("googleMapsStreetViewLayerUrl", () => {
  it("usa map_action=pano e viewpoint", () => {
    const u = googleMapsStreetViewLayerUrl(40.1, 22.2);
    expect(u).toContain("map_action=pano");
    expect(u).toContain("viewpoint=");
    expect(u).toContain("40.1");
    expect(u).toContain("22.2");
  });
  it("include pano se passato", () => {
    const u = googleMapsStreetViewLayerUrl(40, 22, "abc123_xyz");
    expect(u).toContain("pano=abc123_xyz");
  });
});
