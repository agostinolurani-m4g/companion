import { describe, expect, it } from "vitest";
import {
  displayNameForAmaroMember,
  exchangeAmaroCode,
  usernameForAmaroMember,
} from "@/lib/amaro-sso";

const member = { id: 42, email: "M@Example.test", firstName: "Niccolò", lastName: "De Rossi", membershipStatus: "active" };

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("usernameForAmaroMember", () => {
  it("builds nome.cognome without accents or spaces", () => {
    expect(usernameForAmaroMember(member, () => false)).toBe("niccolo.derossi");
  });

  it("appends the Amaro id when the username is taken", () => {
    expect(usernameForAmaroMember(member, (u) => u === "niccolo.derossi")).toBe("niccolo.derossi.42");
  });

  it("falls back to the id when the name is empty", () => {
    expect(usernameForAmaroMember({ id: 7, firstName: " ", lastName: "" }, () => false)).toBe("tesserato7");
  });
});

describe("displayNameForAmaroMember", () => {
  it("joins first and last name", () => {
    expect(displayNameForAmaroMember(member)).toBe("Niccolò De Rossi");
  });
});

describe("exchangeAmaroCode", () => {
  it("returns the member on success, with normalized email", async () => {
    const res = await exchangeAmaroCode("c", fakeFetch(200, { member }));
    expect(res).toEqual({ ok: true, member: { ...member, email: "m@example.test" } });
  });

  it("maps 401 to invalid and 403 to inactive", async () => {
    expect(await exchangeAmaroCode("c", fakeFetch(401, {}))).toEqual({ ok: false, reason: "invalid" });
    expect(await exchangeAmaroCode("c", fakeFetch(403, {}))).toEqual({ ok: false, reason: "inactive" });
  });

  it("rejects an expired membership even on 200", async () => {
    const res = await exchangeAmaroCode("c", fakeFetch(200, { member: { ...member, membershipStatus: "expired" } }));
    expect(res).toEqual({ ok: false, reason: "inactive" });
  });

  it("rejects malformed payloads and network failures", async () => {
    expect(await exchangeAmaroCode("c", fakeFetch(200, { member: { id: "x" } }))).toEqual({ ok: false, reason: "invalid" });
    expect(await exchangeAmaroCode("c", fakeFetch(500, {}))).toEqual({ ok: false, reason: "unreachable" });
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await exchangeAmaroCode("c", boom)).toEqual({ ok: false, reason: "unreachable" });
  });
});
