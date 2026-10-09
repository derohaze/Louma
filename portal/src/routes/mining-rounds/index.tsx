import { createFileRoute } from "@tanstack/react-router";
import { MiningRoundsPage } from "@/features/mining-rounds";

export const Route = createFileRoute("/mining-rounds/")({ component: MiningRoundsPage });
