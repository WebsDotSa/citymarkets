import { redirect } from "next/navigation";

/**
 * M2 (PCP-101 dogfood): the driver app lives at `/admin/driver/*` (admin-side
 * dashboard) and the public recruitment page is at `/delegate`. Users typing
 * `/driver` would otherwise land on a 404. Redirect transparently.
 */
export default function DriverRedirectPage() {
  redirect("/delegate");
}