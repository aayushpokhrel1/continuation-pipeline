import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";
import { SdkSessionSource } from "./sdkSource.ts";
import { PushService } from "./push.ts";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(join(here, "..", "config.json"));
const push = config.vapid
  ? new PushService(config.vapid, join(here, "..", "subscriptions.json"))
  : undefined;
const server = createServer(config, new SdkSessionSource(), push);
server.listen(config.port, "127.0.0.1", () => {
  console.log(`bridge listening on 127.0.0.1:${config.port}`);
});
