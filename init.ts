#!/usr/bin/env bun
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const projectDir = process.argv[2] || "my-rpe-project";

console.log(`🚀 Creating new rpe project in: ${projectDir}\n`);

// templates
const configJson = {
  individualFiles: ["chart.json"],
};

const runPs1 = `bun run reload.ts`;

const reloadTs = `import { serve } from "bun";
import { readdir, copyFile, mkdir } from "fs/promises";
import { watch } from "fs";
import { join, extname } from "path";

const PLAYER_URL = "https://player.phizone.cn";
const INPUT_DIR = "./INPUT";
const OUTPUT_DIR = "./OUTPUT";
const PORT = 9901;
const CONFIG_FILE = "./config.json";
const WATCH_FILES = true;

async function readIndividualFiles(): Promise<string[]> {
  try {
    const cfg = await Bun.file(CONFIG_FILE).json();
    return cfg.individualFiles ?? [];
  } catch {
    console.warn("[config] could not read config.json");
    return [];
  }
}

const getFileType = (name: string) => {
  const ext = extname(name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return 0;
  if ([".mp3", ".ogg", ".wav", ".flac"].includes(ext)) return 1;
  if ([".mp4", ".webm"].includes(ext)) return 2;
  if ([".json", ".txt", ".yml"].includes(ext)) return 3;
  if ([".shader", ".glsl", ".frag"].includes(ext)) return 4;
  return 5;
};

async function buildOutputFiles() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const files = await readIndividualFiles();
  for (const file of files) {
    const src = join(file);
    const dest = join(OUTPUT_DIR, file);
    const dir = join(OUTPUT_DIR, file.split("/").slice(0, -1).join("/"));
    await mkdir(dir, { recursive: true });
    await copyFile(src, dest);
    console.log(\`[copy] \${src} -> \${dest}\`);
  }
}

async function copyMediaFiles() {
  const inputFiles = await readdir(INPUT_DIR);
  for (const file of inputFiles) {
    const src = join(INPUT_DIR, file);
    const dest = join(OUTPUT_DIR, file);
    await copyFile(src, dest);
    console.log(\`[copy] \${src} -> \${dest}\`);
  }
}

async function getFileList(dir: string) {
  const files = await readdir(dir);
  return files.map((name) => ({
    name,
    type: getFileType(name),
  }));
}

async function main() {
  console.log("[build] starting build...");
  await buildOutputFiles();
  await copyMediaFiles();
  console.log("[build] done
");

  if (WATCH_FILES) {
    watch(INPUT_DIR, { recursive: true }, async () => {
      console.log("[watch] detected change, rebuilding...");
      await buildOutputFiles();
      await copyMediaFiles();
    });
  }

  serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return Response.redirect(\`\${PLAYER_URL}?local=http://localhost:\${PORT}\`);
      }
      if (url.pathname === "/files") {
        const files = await getFileList(OUTPUT_DIR);
        return Response.json(files);
      }
      const filePath = join(OUTPUT_DIR, url.pathname.slice(1));
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("not found", { status: 404 });
    },
  });

  console.log(\`[server] running at http://localhost:\${PORT}\`);
  console.log(\`[info] open browser to preview chart\`);
}

main();
`;

const indexTs = `import {
  ChartBuilder,
  ExtraBuilder,
  createExtra,
  preprocess,
  serializeChart,
  serializeExtra,
  type RpeJson,
} from "rpe-utils";

const chart = new ChartBuilder((await Bun.file("INPUT/chart.json").json()) as RpeJson);

// its a good idea to preprocess the chart data before manipulating it
// some timing calculations related problem would occur if you dont
preprocess(chart.data);

// your chart manipulation code here
console.log("lines:", chart.data.judgeLineList.length);
console.log("notes:", chart.data.judgeLineList.reduce((acc, line) => acc + line.numOfNotes, 0));

// write output
await Bun.write("chart.json", serializeChart(chart.data));
`;

const prettierrcJson = {
  printWidth: 120,
  useTabs: false,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "es5",
  bracketSpacing: true,
  arrowParens: "always",
};

const prettierignore = `node_modules
INPUT
OUTPUT
${projectDir}
*.json
*.yml
*.yaml
`;

try {
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "INPUT"), { recursive: true });

  await writeFile(join(projectDir, "config.json"), JSON.stringify(configJson, null, 2));
  await writeFile(join(projectDir, "run.ps1"), runPs1);
  await writeFile(join(projectDir, "reload.ts"), reloadTs);
  await writeFile(join(projectDir, "index.ts"), indexTs);
  await writeFile(join(projectDir, ".prettierrc.json"), JSON.stringify(prettierrcJson, null, 2));
  await writeFile(join(projectDir, ".prettierignore"), prettierignore);

  console.log("✅ Project created!");
  console.log("\nNext steps:");
  console.log(`  cd ${projectDir}`);
  console.log("  bun install rpe-utils");
  console.log("  bun run index.ts        # put your chart.json files in INPUT/ and run your script");
  console.log("  .\\run.ps1              # start dev server\n");
} catch (err: any) {
  console.error("❌ error:", err.message);
  process.exit(1);
}
