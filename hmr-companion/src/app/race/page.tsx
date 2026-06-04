import { redirect } from "next/navigation";
import { HMR_OFFICIAL_TRACK_ID } from "@/lib/track-ingest";

export default function RaceRedirectPage() {
  redirect(`/track/${HMR_OFFICIAL_TRACK_ID}/race`);
}
