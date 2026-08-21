import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";

const manifestPath = resolve(".next/server/app/page_client-reference-manifest.js");
const sandbox = { __RSC_MANIFEST: {} as Record<string, { entryJSFiles?: Record<string, string[]> }> };
runInNewContext(readFileSync(manifestPath, "utf8"), sandbox);

const entryFiles = sandbox.__RSC_MANIFEST["/page"]?.entryJSFiles?.["[project]/src/app/page"];
if (!entryFiles?.length) throw new Error("Dashboard client entry files were not found; run pnpm build first");

const sizes = entryFiles.map((file) => {
  const path = resolve(".next", file);
  const source = readFileSync(path);
  return { file, rawBytes: statSync(path).size, gzipBytes: gzipSync(source).byteLength };
});
const totals = sizes.reduce((result, item) => ({ rawBytes: result.rawBytes + item.rawBytes, gzipBytes: result.gzipBytes + item.gzipBytes }), { rawBytes: 0, gzipBytes: 0 });
const largest = sizes.reduce((current, item) => item.rawBytes > current.rawBytes ? item : current);

const limits = { totalGzipBytes: 140_000, largestRawBytes: 430_000 };
console.log(`Dashboard entry JS: ${totals.rawBytes} raw bytes, ${totals.gzipBytes} gzip bytes across ${sizes.length} chunks`);
console.log(`Largest entry chunk: ${largest.rawBytes} raw bytes (${largest.file})`);

if (totals.gzipBytes > limits.totalGzipBytes || largest.rawBytes > limits.largestRawBytes) {
  throw new Error(`Dashboard bundle budget exceeded: gzip <= ${limits.totalGzipBytes}, largest raw chunk <= ${limits.largestRawBytes}`);
}
