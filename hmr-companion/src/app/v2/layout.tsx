import { getCurrentSessionEmail, isAdminUser } from "@/lib/auth";
import V2Shell from "@/components/v2/V2Shell";

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const email = await getCurrentSessionEmail();
  return (
    <V2Shell isAdmin={email ? isAdminUser(email) : false} username={email ?? undefined}>
      {children}
    </V2Shell>
  );
}
