import { NextResponse } from "next/server";
import { getActiveUserId, listFriendUsers } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const uid = getActiveUserId();
  if (!uid) {
    return NextResponse.json({ friends: [] as ReturnType<typeof listFriendUsers> });
  }
  return NextResponse.json({ friends: listFriendUsers(uid) });
}
