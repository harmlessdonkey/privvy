import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tmpData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "privvy-test-"));
}

/** A stand-in for the real collector: writes a small inspection.json into the output dir. */
export async function fakeCollector(dir: string, opts: { fail?: boolean } = {}): Promise<string> {
  const file = join(dir, "fake-collector.mjs");
  await writeFile(
    file,
    `import { mkdirSync, writeFileSync } from "node:fs";
const [url, outDir] = process.argv.slice(2);
${opts.fail ? 'console.error("boom"); process.exit(2);' : ""}
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + "/inspection.json", JSON.stringify({ url, cookies: [{ name: "_ga" }] }));
console.log("collected " + url);
`,
  );
  return file;
}
