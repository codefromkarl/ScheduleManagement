import { config } from "dotenv";
config({ path: ".env.local" });
import { seedDate } from "@/features/schedule/data/sqlite-store";

await seedDate(process.env.SEED_DATE ?? "2026-08-20");
console.info(`[goalset] seeded demo schedule for ${process.env.SEED_DATE ?? "2026-08-20"}`);
