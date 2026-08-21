import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "goalset · 个人日程调度",
    short_name: "goalset",
    description: "用规则安排个人日程，需要时再用自然语言快速添加任务。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#f5f6fb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
