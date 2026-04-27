import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/itineraries/route";
import { GET as GET_SOCIAL_ME } from "@/app/api/social/me/route";
import { PATCH } from "@/app/api/itineraries/[id]/stops/reorder/route";
import {
  addStop,
  createItinerary,
  listCanonicalRoutesForUser,
  listOutingsForUser,
  listStops,
  resetTrailPlannerDbConnection,
} from "@/lib/db";
import { DEMO_USER_SELF } from "@/lib/social-constants";

const TEST_DB = path.join(process.cwd(), ".test", "trail-planner-test.db");

function freshDb() {
  process.env.TRAIL_PLANNER_DB_PATH = TEST_DB;
  resetTrailPlannerDbConnection();
  const dir = path.dirname(TEST_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
}

beforeEach(() => {
  freshDb();
});

afterEach(() => {
  delete process.env.TRAIL_PLANNER_DB_PATH;
  resetTrailPlannerDbConnection();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

describe("itinerari API", () => {
  it("GET restituisce una lista", async () => {
    createItinerary({ name: "Test A" });
    const res = await GET();
    expect(res.ok).toBe(true);
    const j = (await res.json()) as { itineraries: { name: string }[] };
    expect(Array.isArray(j.itineraries)).toBe(true);
    expect(j.itineraries.some((x) => x.name === "Test A")).toBe(true);
  });

  it("POST 400 senza nome", async () => {
    const res = await POST(
      new Request("http://localhost/api/itineraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  " }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST crea itinerario", async () => {
    const res = await POST(
      new Request("http://localhost/api/itineraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nuovo giro", activity: "hiking" }),
      })
    );
    expect(res.ok).toBe(true);
    const j = (await res.json()) as { itinerary: { id: string; name: string } };
    expect(j.itinerary.name).toBe("Nuovo giro");
  });
});

describe("reorder stops API", () => {
  it("PATCH riordina le tappe", async () => {
    const it = createItinerary({ name: "Ordine" });
    const a = addStop({
      itinerary_id: it.id,
      segment_type: "stop",
      name: "Prima",
      lat: 46,
      lng: 11,
    });
    const b = addStop({
      itinerary_id: it.id,
      segment_type: "stop",
      name: "Seconda",
      lat: 46.1,
      lng: 11.1,
    });

    const before = listStops(it.id);
    expect(before[0].name).toBe("Prima");
    expect(before[1].name).toBe("Seconda");

    const res = await PATCH(
      new Request(`http://localhost/api/itineraries/${it.id}/stops/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: [b.id, a.id] }),
      }),
      { params: Promise.resolve({ id: it.id }) }
    );
    expect(res.ok).toBe(true);

    const after = listStops(it.id);
    expect(after[0].name).toBe("Seconda");
    expect(after[1].name).toBe("Prima");
  });

  it("PATCH 400 con orderedIds non valido", async () => {
    const it = createItinerary({ name: "X" });
    const res = await PATCH(
      new Request(`http://localhost/api/itineraries/${it.id}/stops/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: "bad" }),
      }),
      { params: Promise.resolve({ id: it.id }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("hub utente / social me", () => {
  it("GET /api/social/me restituisce aggregato con utente attivo demo", async () => {
    const res = await GET_SOCIAL_ME();
    expect(res.ok).toBe(true);
    const j = (await res.json()) as {
      user: { id: string };
      friends: unknown[];
      following: unknown[];
      routes: unknown[];
      outings: unknown[];
      itineraries: unknown[];
    };
    expect(j.user.id).toBe(DEMO_USER_SELF);
    expect(Array.isArray(j.friends)).toBe(true);
    expect(Array.isArray(j.following)).toBe(true);
    expect(Array.isArray(j.routes)).toBe(true);
    expect(Array.isArray(j.outings)).toBe(true);
    expect(Array.isArray(j.itineraries)).toBe(true);
  });

  it("listOutingsForUser include autore e partecipante", () => {
    const rows = listOutingsForUser(DEMO_USER_SELF, 20);
    const roles = new Set(rows.map((r) => r.role));
    expect(roles.has("author")).toBe(true);
    expect(roles.has("participant")).toBe(true);
  });

  it("listCanonicalRoutesForUser restituisce almeno un percorso seed per demo self", () => {
    const routes = listCanonicalRoutesForUser(DEMO_USER_SELF, 10);
    expect(routes.some((r) => r.name.includes("laghi demo"))).toBe(true);
  });
});
