import { createFileRoute } from "@tanstack/react-router";
import { AuditLogsPage } from "@/features/audit-logs";

export const Route = createFileRoute("/audit-logs/")({ component: AuditLogsPage });
