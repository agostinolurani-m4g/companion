import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline } from "@/lib/polyline";
import { decryptToken, encryptToken } from "@/lib/crypto-tokens";

describe("polyline", () => {
  it("decodifica il vettore di riferimento Google", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("encode/decode round trip", () => {
    const coords: [number, number][] = [
      [9.19, 45.4642],
      [9.2001, 45.47],
      [9.21234, 45.48888],
    ];
    expect(decodePolyline(encodePolyline(coords))).toEqual(coords);
  });

  it("stringa vuota → nessun punto", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("crypto-tokens", () => {
  it("cifra e decifra", () => {
    const enc = encryptToken("secret-access-token", "k1");
    expect(enc).not.toContain("secret");
    expect(decryptToken(enc, "k1")).toBe("secret-access-token");
  });

  it("IV casuale: due cifrature diverse", () => {
    expect(encryptToken("x", "k1")).not.toBe(encryptToken("x", "k1"));
  });

  it("chiave sbagliata → errore", () => {
    const enc = encryptToken("x", "k1");
    expect(() => decryptToken(enc, "k2")).toThrow();
  });
});
