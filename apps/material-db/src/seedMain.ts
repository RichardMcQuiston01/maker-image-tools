import { createPool, runMigrations } from "./db.js";
import { seedFromMaterialLibrary } from "./seed.js";

const pool = createPool();
await runMigrations(pool);
const { inserted, skipped } = await seedFromMaterialLibrary(pool);
console.log(
  `Seeded ${inserted} preset(s) from @maker/material-library (${skipped} already present, skipped).`,
);
await pool.end();
