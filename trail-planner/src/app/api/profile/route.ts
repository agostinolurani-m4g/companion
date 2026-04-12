import { NextResponse } from "next/server";
import { getProfile, updateProfile } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ profile: getProfile() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Partial<{
      display_name: string;
      units: "km" | "mi";
      sports_json: string;
      rain_mm_h: number;
      wind_ms: number;
      frost_temp_c: number;
      timezone: string;
    }>;
    updateProfile(body);
    return NextResponse.json({ profile: getProfile() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}
