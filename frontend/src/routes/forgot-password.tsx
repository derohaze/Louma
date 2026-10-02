import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordContent } from "@/features/auth";
export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password" },
      { name: "description", content: "Reset your Louma wallet password." },
      { property: "og:title", content: "Reset password" },
      { property: "og:description", content: "Reset your Louma wallet password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForgotPasswordContent,
});
