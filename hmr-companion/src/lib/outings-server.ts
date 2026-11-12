import { isKnownHmrUser, normalizeUsername } from "@/lib/auth";
import {
  getGroupMember,
  replaceOutingStops,
  setOutingGroups,
  setOutingParticipants,
  type OutingPatch,
} from "@/lib/db";
import {
  normalizeOutingDate,
  normalizeStartTime,
  parseOutingConditions,
  parseOutingStops,
} from "@/lib/outings-types";

/** Corpo comune a POST /outings e PATCH /outings/[id]. */
export type OutingBody = {
  title?: string;
  outing_date?: string | null;
  start_time?: string | null;
  status?: string;
  visibility?: string;
  notes?: string;
  story?: string;
  conditions?: unknown;
  participants?: string[];
  group_ids?: string[];
  stops?: unknown;
};

/** Estrae i campi scalari validati (solo quelli presenti nel body). */
export function outingPatchFromBody(body: OutingBody): OutingPatch {
  const p: OutingPatch = {};
  if (typeof body.title === "string" && body.title.trim()) p.title = body.title.trim().slice(0, 160);
  if (body.outing_date !== undefined) p.outing_date = normalizeOutingDate(body.outing_date);
  if (body.start_time !== undefined) p.start_time = normalizeStartTime(body.start_time);
  if (body.status === "planned" || body.status === "done") p.status = body.status;
  if (body.visibility === "participants" || body.visibility === "public") p.visibility = body.visibility;
  if (typeof body.notes === "string") p.notes = body.notes.trim().slice(0, 5000);
  if (typeof body.story === "string") p.story = body.story.trim().slice(0, 20000);
  if (body.conditions !== undefined) {
    const c = parseOutingConditions(body.conditions);
    p.conditions_json = c ? JSON.stringify(c) : null;
  }
  return p;
}

/** Applica partecipanti / gruppi / soste se presenti nel body. Il proprietario resta sempre partecipante. */
export function applyOutingRelations(outingId: string, owner: string, body: OutingBody): void {
  if (Array.isArray(body.participants)) {
    const ownerU = normalizeUsername(owner);
    const users = [ownerU];
    for (const raw of body.participants) {
      if (typeof raw !== "string") continue;
      const u = raw.trim().toLowerCase();
      if (u && u !== ownerU && isKnownHmrUser(u)) users.push(u);
    }
    setOutingParticipants(outingId, users);
  }
  if (Array.isArray(body.group_ids)) {
    const gids = body.group_ids
      .filter((g): g is string => typeof g === "string")
      .map((g) => g.trim())
      .filter((g) => g && getGroupMember(g, owner));
    setOutingGroups(outingId, gids);
  }
  if (body.stops !== undefined) {
    replaceOutingStops(outingId, parseOutingStops(body.stops));
  }
}
