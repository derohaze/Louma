import { createFileRoute } from "@tanstack/react-router";
import { TicketDetailPage } from "@/features/tickets";

export const Route = createFileRoute("/tickets/$id")({ component: TicketDetailRoute });

function TicketDetailRoute() {
  const { id } = Route.useParams();
  return <TicketDetailPage ticketId={id} />;
}
