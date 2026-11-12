import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePolyline } from "@/lib/polyline";
import { encryptToken, decryptToken } from "@/lib/crypto-tokens";
import { getExternalAccount, listActivities, migrateActivitiesStore, upsertExternalAccount } from "@/lib/activities/store";
import { mapStravaSport } from "@/lib/activities/sport-map";
import { buildStravaAuthorizeUrl, mapStravaActivity, type StravaActivity } from "@/lib/integrations/strava";
import { getValidStravaToken, handleStravaWebhookEvent, purgeStravaData, syncStravaAccount } from "@/lib/integrations/sync";

const COORDS: [number, number][] = [
  [9.9, 46.3],
  [9.91, 46.301],
  [9.92, 46.302],
];

function act(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 123,
    name: "Uscita gravel",
    sport_type: "GravelRide",
    type: "Ride",
    start_date: "2026-11-01T08:00:00Z",
    distance: 42000.4,
    total_elevation_gain: 650.2,
    moving_time: 7200,
    map: { summary_polyline: encodePolyline(COORDS) },
    ...over,
  };
}

describe("strava mapping", () => {
  it("sport_type → sport app", () => {
    expect(mapStravaSport("GravelRide")).toBe("gravel");
    expect(mapStravaSport("BackcountrySki")).toBe("ski");
    expect(mapStravaSport("VirtualRide")).toBeNull();
    expect(mapStravaSport(undefined, "Hike")).toBe("hike");
    expect(mapStravaSport("Kitesurf")).toBeNull();
  });

  it("attività → riga", () => {
    const m = mapStravaActivity(act())!;
    expect(m.external_id).toBe("123");
    expect(m.sport).toBe("gravel");
    expect(m.distance_m).toBe(42000);
    expect(m.elev_gain_m).toBe(650);
    expect(m.start_time).toBe(Date.parse("2026-11-01T08:00:00Z"));
    expect(m.line.coordinates[0]).toEqual([9.9, 46.3]);
  });

  it("scarta indoor, manuali e senza traccia", () => {
    expect(mapStravaActivity(act({ trainer: true }))).toBeNull();
    expect(mapStravaActivity(act({ manual: true }))).toBeNull();
    expect(mapStravaActivity(act({ map: { summary_polyline: "" } }))).toBeNull();
    expect(mapStravaActivity(act({ sport_type: "Swim" }))).toBeNull();
  });

  it("URL di autorizzazione", () => {
    const u = new URL(buildStravaAuthorizeUrl({ clientId: "42", clientSecret: "s" }, "http://localhost:3002/cb", "st"));
    expect(u.searchParams.get("client_id")).toBe("42");
    expect(u.searchParams.get("scope")).toBe("read,activity:read_all");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("strava sync (fetch mockato)", () => {
  let db: Database.Database;
  const nowS = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = "42";
    process.env.STRAVA_CLIENT_SECRET = "secret";
    process.env.HMR_TOKEN_KEY = "test-key";
    db = new Database(":memory:");
    migrateActivitiesStore(db);
    upsertExternalAccount(db, {
      owner: "ago",
      provider: "strava",
      athlete_id: "777",
      athlete_name: "Ago",
      access_token_enc: encryptToken("old-access"),
      refresh_token_enc: encryptToken("old-refresh"),
      expires_at: nowS - 10,
      scopes: "read,activity:read_all",
      now: Date.now(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refresh del token scaduto", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_at: nowS + 21600 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tok = await getValidStravaToken(db, getExternalAccount(db, "ago", "strava")!);
    expect(tok).toBe("new-access");
    const body = String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=old-refresh");
    const acc = getExternalAccount(db, "ago", "strava")!;
    expect(decryptToken(acc.refresh_token_enc)).toBe("new-refresh");
  });

  it("sync importa, salta indoor, avanza il cursore e non duplica", async () => {
    const page = [act({ id: 1 }), act({ id: 2, trainer: true, start_date: "2026-11-02T08:00:00Z" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: nowS + 21600 }));
        }
        const after = Number(new URL(url).searchParams.get("after"));
        const items = page.filter((a) => Date.parse(a.start_date) / 1000 > after);
        return new Response(JSON.stringify(items));
      }),
    );
    const r = await syncStravaAccount(db, "ago");
    expect(r.error).toBeUndefined();
    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.done).toBe(true);
    const acc = getExternalAccount(db, "ago", "strava")!;
    expect(acc.sync_cursor).toBe(Date.parse("2026-11-02T08:00:00Z") / 1000);
    expect(acc.last_sync_at).not.toBeNull();

    const again = await syncStravaAccount(db, "ago");
    expect(again.imported).toBe(0);
    const rows = listActivities(db, "ago");
    expect(rows).toHaveLength(1);
    expect(rows[0].heat_scopes).toBe("u:ago,community");
  });

  it("429 → errore registrato senza perdere l'account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/oauth/token")
          ? new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: nowS + 21600 }))
          : new Response("rate", { status: 429 }),
      ),
    );
    const r = await syncStravaAccount(db, "ago");
    expect(r.error).toMatch(/Limite/);
    expect(getExternalAccount(db, "ago", "strava")!.status).toBe("active");
  });

  it("webhook delete e deauthorize ripuliscono i dati", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: nowS + 21600 }));
        }
        return new Response(JSON.stringify(act({ id: 55, map: { polyline: encodePolyline(COORDS) } })));
      }),
    );
    await handleStravaWebhookEvent(db, { object_type: "activity", object_id: 55, aspect_type: "create", owner_id: 777 });
    expect(listActivities(db, "ago")).toHaveLength(1);
    await handleStravaWebhookEvent(db, { object_type: "activity", object_id: 55, aspect_type: "delete", owner_id: 777 });
    expect(listActivities(db, "ago")).toHaveLength(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM heat_cells`).get() as { n: number }).n).toBe(0);

    await handleStravaWebhookEvent(db, { object_type: "activity", object_id: 56, aspect_type: "create", owner_id: 777 });
    await handleStravaWebhookEvent(db, {
      object_type: "athlete",
      object_id: 777,
      aspect_type: "update",
      owner_id: 777,
      updates: { authorized: "false" },
    });
    expect(getExternalAccount(db, "ago", "strava")).toBeUndefined();
    expect(listActivities(db, "ago")).toHaveLength(0);
    expect(purgeStravaData(db, "ago")).toBe(0);
  });
});
