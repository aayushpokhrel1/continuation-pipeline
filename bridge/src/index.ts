import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";
import { SdkSessionSource } from "./sdkSource.ts";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(join(here, "..", "config.json"));
const server = createServer(config, new SdkSessionSource());
server.listen(config.port, "127.0.0.1", () => {
  console.log(`bridge listening on 127.0.0.1:${config.port}`);
});
