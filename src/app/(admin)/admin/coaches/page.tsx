import { redirect } from "next/navigation";

export default function CoachesRedirectPage() {
  redirect("/portal/trainers");
}
