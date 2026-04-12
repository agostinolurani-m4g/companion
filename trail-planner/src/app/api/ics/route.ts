import { NextResponse } from "next/server";

export const runtime = "nodejs";

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string;
      start?: string;
      end?: string;
      description?: string;
    };
    const title = body.title?.trim() ?? "Itinerario";
    const start = body.start?.trim();
    const end = body.end?.trim();
    if (!start || !end) {
      return NextResponse.json({ error: "start e end ISO richiesti" }, { status: 400 });
    }
    const uid = `${Date.now()}@trail-planner-local`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Trail Planner//IT",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(new Date(start))}`,
      `DTEND:${formatIcsDate(new Date(end))}`,
      `SUMMARY:${escapeIcs(title)}`,
      body.description ? `DESCRIPTION:${escapeIcs(body.description)}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");

    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.ics"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore" },
      { status: 500 }
    );
  }
}

function formatIcsDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
