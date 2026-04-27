import { NextResponse } from "next/server";
import {
  getActiveUserId,
  getUser,
  listCanonicalRoutesForUser,
  listFollowingUsers,
  listFriendUsers,
  listItineraries,
  listOutingsForUser,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const uid = getActiveUserId();
    if (!uid) {
      return NextResponse.json(
        { error: "Imposta un utente attivo nel profilo (POC social)." },
        { status: 400 }
      );
    }
    const user = getUser(uid);
    if (!user) {
      return NextResponse.json({ error: "Utente attivo non trovato." }, { status: 400 });
    }
    return NextResponse.json({
      user,
      friends: listFriendUsers(uid),
      following: listFollowingUsers(uid),
      routes: listCanonicalRoutesForUser(uid),
      outings: listOutingsForUser(uid),
      itineraries: listItineraries(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
