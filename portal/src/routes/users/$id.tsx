import { createFileRoute } from "@tanstack/react-router";
import { UserDetailPage } from "@/features/users";

export const Route = createFileRoute("/users/$id")({ component: UserDetailRoute });

function UserDetailRoute() {
  const { id } = Route.useParams();
  return <UserDetailPage userId={id} />;
}
