import { describe, expect, it } from "vitest";
import { classifyOutdoor } from "@/lib/outdoor/taxonomy";
import { keyFactsFromTags, tagLabel } from "@/lib/outdoor/tag-labels";

describe("classifyOutdoor", () => {
  it("riconosce cartello, bivacco, sorgente, ferrata", () => {
    expect(classifyOutdoor("node", { information: "guidepost", name: "Palina" })?.kind).toBe("guidepost");
    expect(classifyOutdoor("node", { tourism: "wilderness_hut", name: "Biv. Test" })?.kind).toBe(
      "wilderness_hut",
    );
    expect(classifyOutdoor("node", { natural: "spring", drinking_water: "yes" })?.kind).toBe("spring");
    expect(classifyOutdoor("way", { highway: "via_ferrata", name: "Ferrata X" })?.kind).toBe("via_ferrata");
  });

  it("sentiero abbandonato", () => {
    expect(classifyOutdoor("way", { "abandoned:highway": "path" })?.kind).toBe("trail_abandoned");
  });

  it("relazione cartello destinazioni", () => {
    expect(classifyOutdoor("relation", { type: "destination_sign" })?.kind).toBe("destination_sign");
  });
});

describe("tag-labels", () => {
  it("formatta sac_scale e chip", () => {
    const facts = keyFactsFromTags({ sac_scale: "mountain_hiking", ele: "2100" });
    expect(facts.some((f) => f.value.includes("T2"))).toBe(true);
    expect(tagLabel("ele")).toBe("Quota (m)");
  });
});
