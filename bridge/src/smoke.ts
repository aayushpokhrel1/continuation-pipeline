import { SdkSessionSource } from "./sdkSource.ts";

const repo = process.argv[2] ?? process.cwd();
const src = new SdkSessionSource();
const { sessionId } = await src.send({
  repoPath: repo,
  text: "In one sentence, what is in the current directory? Do not use any tools.",
  onEvent: (e) => console.log(JSON.stringify(e)),
  canUseTool: async () => "deny",
});
console.log("sessionId:", sessionId);
