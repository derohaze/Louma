import { createFileRoute } from "@tanstack/react-router";
import { SignupContent } from "@/components/auth-pages";
export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign up" },
      { name: "description", content: "Create your Louma wallet account in seconds." },
      { property: "og:title", content: "Sign up" },
      { property: "og:description", content: "Create your Louma wallet account in seconds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupContent,
});
