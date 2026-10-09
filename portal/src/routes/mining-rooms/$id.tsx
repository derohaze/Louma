import { createFileRoute } from "@tanstack/react-router";
import { MiningRoomDetailPage } from "@/features/mining-rooms";

export const Route = createFileRoute("/mining-rooms/$id")({ component: MiningRoomDetailRoute });

function MiningRoomDetailRoute() {
  const { id } = Route.useParams();
  return <MiningRoomDetailPage roomId={id} />;
}
