import type { MetadataRoute } from "next"

// Lets Hermes be added to a phone's Home Screen. On iPhone that is what allows alerts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hermes",
    short_name: "Hermes",
    description: "Compare live Solana yields and deposit from your own wallet.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6ead0",
    theme_color: "#f6ead0",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  }
}
