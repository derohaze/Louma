import { createFileRoute } from "@tanstack/react-router";
import { LoginContent } from "@/components/auth-pages";
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in" },
      { name: "description", content: "Log in to your Louma wallet." },
      { property: "og:title", content: "Log in" },
      { property: "og:description", content: "Log in to your Louma wallet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginContent,
});
