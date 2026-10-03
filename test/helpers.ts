import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function tmpData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "privvy-test-"));
}

/** A stand-in for the real collector: writes a small inspection.json into the output dir. */
export async function fakeCollector(dir: string, opts: { fail?: boolean; profile?: boolean } = {}): Promise<string> {
  const file = join(dir, "fake-collector.mjs");
  await writeFile(
    file,
    `import { mkdirSync, writeFileSync } from "node:fs";
const [url, outDir, ...extra] = process.argv.slice(2);
${opts.fail ? 'console.error("boom"); process.exit(2);' : ""}
mkdirSync(outDir, { recursive: true });
${opts.profile ? 'mkdirSync(outDir + "/browser-profile/Default", { recursive: true }); writeFileSync(outDir + "/browser-profile/Default/Cookies", "volatile");' : ""}
writeFileSync(outDir + "/inspection.json", JSON.stringify({ url, cookies: [{ name: "_ga" }], extra }));
console.log("collected " + url);
`,
  );
  return file;
}
