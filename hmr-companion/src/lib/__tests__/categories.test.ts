import { describe, expect, it } from "vitest";
import {
  matchSearchKinds,
  poiMatchesKind,
  POI_KIND_META,
  resolvePoiKind,
} from "../categories";

describe("resolvePoiKind", () => {
  it("distinguishes hut sub_kinds", () => {
    expect(resolvePoiKind("hut", "alpine_hut").id).toBe("rifugio");
    expect(resolvePoiKind("hut", "wilderness_hut").id).toBe("bivacco");
    expect(resolvePoiKind("hut", "shelter").id).toBe("shelter");
  });

  it("maps shop and restaurant", () => {
    expect(resolvePoiKind("shop", "supermarket").id).toBe("supermercato");
    expect(resolvePoiKind("shop", "convenience").id).toBe("market");
    expect(resolvePoiKind("restaurant", "restaurant").id).toBe("ristorante");
    expect(resolvePoiKind("lodging", "hotel").id).toBe("hotel");
    expect(resolvePoiKind("water", "spring").id).toBe("acqua");
  });
});

describe("poiMatchesKind", () => {
  it("filters by sub_kind for hut kinds", () => {
    expect(poiMatchesKind("hut", "wilderness_hut", POI_KIND_META.bivacco)).toBe(true);
    expect(poiMatchesKind("hut", "alpine_hut", POI_KIND_META.bivacco)).toBe(false);
    expect(poiMatchesKind("hut", "shelter", POI_KIND_META.shelter)).toBe(true);
  });
});

describe("matchSearchKinds", () => {
  it("suggests bivacco from partial query", () => {
    const hits = matchSearchKinds("biv");
    expect(hits.some((k) => k.id === "bivacco")).toBe(true);
  });

  it("suggests shelter from tettoia", () => {
    const hits = matchSearchKinds("tettoia");
    expect(hits.some((k) => k.id === "shelter")).toBe(true);
  });
});
