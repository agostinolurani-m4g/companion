import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function V2ScialpinismoEsploraRedirect() {
  redirect("/v2/esplora?activity=ski");
}
