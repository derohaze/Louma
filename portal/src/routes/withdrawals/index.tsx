import { createFileRoute } from "@tanstack/react-router";
import { WithdrawalsPage } from "@/features/withdrawals";

export const Route = createFileRoute("/withdrawals/")({ component: WithdrawalsPage });
