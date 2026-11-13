import { defineConfig } from "@neon/config/v1";

// SLTS — บริการ Neon ที่ใช้งาน
// - Lakebase Postgres (มีให้ทุกโปรเจกต์โดยอัตโนมัติ) → DATABASE_URL / DATABASE_URL_UNPOOLED
// - AI Gateway → NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN (ใช้ใน lib/ai.js อ่านบัญชีจ่ายหมาย)
export default defineConfig({
  aiGateway: true,
});
