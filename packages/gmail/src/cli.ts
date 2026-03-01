#!/usr/bin/env node
import { runServer } from "./server.js";

runServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: "error", message })}\n`
  );
  process.exitCode = 1;
});
