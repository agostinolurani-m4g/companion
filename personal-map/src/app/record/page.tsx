import { redirect } from "next/navigation";
import RecordApp from "@/components/RecordApp";
import LoginGate from "@/components/LoginGate";
import { getCurrentSessionEmail } from "@/lib/auth";
import { getActiveRecordingForOwner } from "@/lib/db";

export default async function RecordPage() {
  const email = await getCurrentSessionEmail();
  if (!email) {
    return <LoginGate />;
  }

  const active = getActiveRecordingForOwner(email);

  return (
    <main className="h-full min-h-0">
      <RecordApp sessionEmail={email} initialActivityId={active?.id ?? null} />
    </main>
  );
}
