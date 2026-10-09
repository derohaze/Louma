import { createFileRoute } from "@tanstack/react-router";
import { MiningRoomsPage } from "@/features/mining-rooms";

export const Route = createFileRoute("/mining-rooms/")({ component: MiningRoomsPage });
