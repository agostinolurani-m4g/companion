import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Vecchio indirizzo: "Aggiungi gita" ora è unico per tutti gli sport. */
export default function V2SkiUploadRedirect() {
  redirect("/v2/gite/nuova?activity=ski");
}
