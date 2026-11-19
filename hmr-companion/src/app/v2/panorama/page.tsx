import { redirect } from "next/navigation";
import V2Panorama from "@/components/v2/V2Panorama";
import { getCurrentSessionEmail, isV2BetaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function V2PanoramaPage({ searchParams }: { searchParams: Promise<{ lat?: string; lng?: string }> }) {
  const sessionEmail = await getCurrentSessionEmail();
  if (!sessionEmail || !isV2BetaUser(sessionEmail)) redirect("/");
  const sp = await searchParams;
  const lat = Number(sp.lat);
  const lng = Number(sp.lng);
  const initial = Number.isFinite(lat) && Number.isFinite(lng) && sp.lat && sp.lng ? { lat, lng } : null;
  return <V2Panorama initial={initial} />;
}
