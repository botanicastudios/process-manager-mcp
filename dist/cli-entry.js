#!/usr/bin/env node
import { runCLI } from "./cli.js";
runCLI().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=cli-entry.js.map