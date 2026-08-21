import { headers } from "next/headers";
import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { isMobileUserAgent } from "@/lib/user-agent";

export default async function Home() {
  const userAgent = (await headers()).get("user-agent") ?? "";
  return <ScheduleDashboard initialMobile={isMobileUserAgent(userAgent)} />;
}
