import { redirect } from "next/navigation";

export default function CoachProfileRedirect({ params }: { params: { coachId: string } }) {
  redirect(`/portal/trainers/${params.coachId}`);
}
