import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ELK from "elkjs/lib/elk.bundled.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const defaultInspectDir = path.join(repoRoot, "out", "elk-probe", "inspect");

const command = process.argv[2] ?? "inspect";
const args = parseArgs(process.argv.slice(3));

try {
  switch (command) {
    case "inspect":
      await runInspect(args);
      break;
    case "probe":
      await runProbe(args);
      break;
    default:
      throw new Error(`Unknown command '${command}'. Use 'inspect' or 'probe'.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function runInspect(args) {
  const outDir = resolveMaybeRelative(args["out-dir"] ?? defaultInspectDir);
  const elk = createElk();
  const algorithms = await elk.knownLayoutAlgorithms();
  const options = await elk.knownLayoutOptions();

  await fs.mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "known-layout-algorithms.json"), algorithms);
  await writeJson(path.join(outDir, "known-layout-options.json"), options);

  console.log(`Wrote algorithm inventory to ${outDir}`);
  console.log("");
  console.log("Algorithms:");
  for (const algorithm of algorithms) {
    console.log(`- ${algorithm.id}`);
  }
  console.log("");
  console.log(`Options: ${options.length}`);
}

async function runProbe(args) {
  const renderDir = args["render-dir"]
    ? resolveMaybeRelative(args["render-dir"])
    : await findLatestBenchmarkRenderDir();
  const outDir = resolveMaybeRelative(
    args["out-dir"] ?? path.join(repoRoot, "out", "elk-probe", timestampNow()),
  );
  const sourceTreeAlgorithm = args["source-tree-algorithm"] ?? "org.eclipse.elk.layered";
  const controlFlowAlgorithm = args["control-flow-algorithm"] ?? "org.eclipse.elk.stress";

  await assertFile(path.join(renderDir, "source-tree.json"));
  await assertFile(path.join(renderDir, "control-flow.json"));

  const elk = createElk();
  const algorithms = await elk.knownLayoutAlgorithms();
  const algorithmIds = new Set(algorithms.map((algorithm) => algorithm.id));

  ensureAlgorithmAvailable(sourceTreeAlgorithm, algorithmIds);
  ensureAlgorithmAvailable(controlFlowAlgorithm, algorithmIds);

  await fs.mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "known-layout-algorithms.json"), algorithms);

  const partitions = [
    {
      graphKey: "source-tree",
      algorithm: sourceTreeAlgorithm,
    },
    {
      graphKey: "control-flow",
      algorithm: controlFlowAlgorithm,
    },
  ];

  for (const partition of partitions) {
    const inputPath = path.join(renderDir, `${partition.graphKey}.json`);
    const report = JSON.parse(await fs.readFile(inputPath, "utf8"));
    const partitionOutDir = path.join(outDir, partition.graphKey);
    await fs.mkdir(partitionOutDir, { recursive: true });

    const elkGraph = buildElkGraph(report, partition.algorithm);
    const layout = await elk.layout(elkGraph);
    const summary = buildLayoutSummary(report, layout, partition.algorithm);
    const svg = renderSvg(layout, report, partition.algorithm);

    await writeJson(path.join(partitionOutDir, "input.json"), report);
    await writeJson(path.join(partitionOutDir, "elk-graph.json"), elkGraph);
    await writeJson(path.join(partitionOutDir, "elk-layout.json"), layout);
    await writeJson(path.join(partitionOutDir, "layout-summary.json"), summary);
    await fs.writeFile(path.join(partitionOutDir, "layout.svg"), svg, "utf8");

    console.log(
      `[${partition.graphKey}] ${partition.algorithm} -> ${path.join(partitionOutDir, "layout.svg")}`,
    );
  }

  console.log("");
  console.log(`Probe output: ${outDir}`);
}

async function findLatestBenchmarkRenderDir() {
  const benchmarkRoot = path.join(repoRoot, "out", "benchmarks", "aetheria-source-tree-map");
  const runEntries = await fs.readdir(benchmarkRoot, { withFileTypes: true });
  const runNames = runEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const runName of runNames) {
    const candidateRoot = path.join(benchmarkRoot, runName, "candidates");
    try {
      const candidateEntries = await fs.readdir(candidateRoot, { withFileTypes: true });
      const candidateNames = candidateEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => {
          const leftScore = left.includes("rich") ? 0 : 1;
          const rightScore = right.includes("rich") ? 0 : 1;
          return leftScore - rightScore || left.localeCompare(right);
        });

      for (const candidateName of candidateNames) {
        const renderDir = path.join(candidateRoot, candidateName, "render");
        try {
          await assertFile(path.join(renderDir, "source-tree.json"));
          await assertFile(path.join(renderDir, "control-flow.json"));
          return renderDir;
        } catch {
          // Keep walking until we find a valid render directory.
        }
      }
    } catch {
      // Ignore missing candidate folders and keep scanning older runs.
    }
  }

  throw new Error(
    "Could not find a benchmark render directory automatically. Pass --render-dir explicitly.",
  );
}

function createElk() {
  return new ELK();
}

function buildElkGraph(report, algorithm) {
  return {
    id: report.GraphKey,
    layoutOptions: {
      "elk.algorithm": algorithm,
      ...baseGraphOptions(report.GraphKey, algorithm),
    },
    children: report.Nodes.map((node) => ({
      id: node.Id,
      width: normalizeSize(node.Bounds.Width, 68, 260),
      height: normalizeSize(node.Bounds.Height, 34, 110),
      labels: [
        {
          text: node.Title,
        },
      ],
      layoutOptions: {
        ...nodeOptions(node, report.GraphKey),
      },
    })),
    edges: report.Edges.map((edge, index) => ({
      id: `${report.GraphKey}-edge-${index}`,
      sources: [edge.SourceId],
      targets: [edge.TargetId],
    })),
  };
}

function baseGraphOptions(graphKey, algorithm) {
  const layered = algorithm === "org.eclipse.elk.layered";
  if (graphKey === "source-tree") {
    return layered
      ? {
          "elk.direction": "DOWN",
          "elk.layered.spacing.nodeNodeBetweenLayers": "92",
          "elk.spacing.nodeNode": "42",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
          "elk.edgeRouting": "SPLINES",
        }
      : {
          "elk.spacing.nodeNode": "48",
          "elk.padding": "[top=40,left=40,bottom=40,right=40]",
        };
  }

  return layered
    ? {
        "elk.direction": "DOWN",
        "elk.layered.spacing.nodeNodeBetweenLayers": "124",
        "elk.spacing.nodeNode": "84",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.edgeRouting": "SPLINES",
      }
    : {
        "elk.spacing.nodeNode": "80",
        "elk.padding": "[top=60,left=60,bottom=60,right=60]",
      };
}

function nodeOptions(node, graphKey) {
  if (graphKey === "source-tree") {
    return {
      "elk.nodeSize.constraints": "MINIMUM_SIZE",
    };
  }

  return {
    "elk.nodeSize.constraints": "MINIMUM_SIZE",
  };
}

function buildLayoutSummary(report, layout, algorithm) {
  return {
    graphKey: report.GraphKey,
    graphTitle: report.GraphTitle,
    nodeCount: report.NodeCount,
    edgeCount: report.EdgeCount,
    algorithm,
    width: layout.width ?? 0,
    height: layout.height ?? 0,
    children: layout.children?.length ?? 0,
    edgesWithSections:
      layout.edges?.filter((edge) => Array.isArray(edge.sections) && edge.sections.length > 0).length ?? 0,
  };
}

function renderSvg(layout, report, algorithm) {
  const nodeLookup = new Map(report.Nodes.map((node) => [node.Id, node]));
  const width = Math.max(1280, Math.ceil((layout.width ?? 0) + 120));
  const height = Math.max(860, Math.ceil((layout.height ?? 0) + 140));
  const headerHeight = 92;
  const offsetX = 60;
  const offsetY = headerHeight;

  const children = [...(layout.children ?? [])];
  const edges = [...(layout.edges ?? [])];

  const svg = [];
  svg.push(`<?xml version="1.0" encoding="utf-8"?>`);
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
  );
  svg.push(`  <title id="title">${escapeXml(report.GraphTitle)} ELK layout</title>`);
  svg.push(
    `  <desc id="desc">ELK probe render for ${escapeXml(report.GraphKey)} using ${escapeXml(algorithm)}.</desc>`,
  );
  svg.push(`  <defs>`);
  svg.push(`    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">`);
  svg.push(`      <stop offset="0%" stop-color="#09111c" />`);
  svg.push(`      <stop offset="100%" stop-color="${report.GraphKey === "control-flow" ? "#190d12" : "#111827"}" />`);
  svg.push(`    </linearGradient>`);
  svg.push(`    <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`);
  svg.push(`      <path d="M 0 0 L 12 6 L 0 12 z" fill="${report.GraphKey === "control-flow" ? "#fb7185" : "#22d3ee"}" />`);
  svg.push(`    </marker>`);
  svg.push(`  </defs>`);
  svg.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />`);
  svg.push(
    `  <rect x="20" y="20" width="${width - 40}" height="54" rx="18" fill="#0c1626" stroke="${report.GraphKey === "control-flow" ? "#fb7185" : "#22d3ee"}" stroke-opacity="0.5" />`,
  );
  svg.push(
    `  <text x="38" y="44" fill="#f8fafc" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="28" font-weight="700">${escapeXml(report.GraphTitle)}</text>`,
  );
  svg.push(
    `  <text x="38" y="62" fill="${report.GraphKey === "control-flow" ? "#fdba74" : "#a5f3fc"}" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="12" letter-spacing="0.16em">${escapeXml(algorithm)}</text>`,
  );

  svg.push(`  <g id="edges" fill="none">`);
  for (const edge of edges) {
    const points = edgeSectionsToPoints(edge.sections, offsetX, offsetY);
    if (points.length < 2) {
      continue;
    }

    svg.push(
      `    <path d="${polylinePath(points)}" stroke="${report.GraphKey === "control-flow" ? "#fb7185" : "#22d3ee"}" stroke-opacity="0.42" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)" />`,
    );
  }
  svg.push(`  </g>`);

  svg.push(`  <g id="nodes">`);
  for (const child of children) {
    const x = (child.x ?? 0) + offsetX;
    const y = (child.y ?? 0) + offsetY;
    const widthValue = child.width ?? 80;
    const heightValue = child.height ?? 42;
    const node = nodeLookup.get(child.id);
    const color = nodeColor(node, report.GraphKey);
    const lines = wrapLabel(node?.Title ?? child.id, widthValue < 120 ? 16 : 20, 2);

    svg.push(
      `    <rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(widthValue)}" height="${fmt(heightValue)}" rx="16" fill="#101827" fill-opacity="0.92" stroke="${color}" stroke-width="${node?.IsEntry ? "2.2" : "1.4"}" />`,
    );
    if (node?.IsEntry) {
      svg.push(
        `    <rect x="${fmt(x - 5)}" y="${fmt(y - 5)}" width="${fmt(widthValue + 10)}" height="${fmt(heightValue + 10)}" rx="20" fill="none" stroke="#fde68a" stroke-width="2.1" stroke-opacity="0.9" />`,
      );
    }
    svg.push(
      `    <circle cx="${fmt(x + 14)}" cy="${fmt(y + 14)}" r="9" fill="${color}" stroke="#e5e7eb" stroke-opacity="0.4" />`,
    );
    svg.push(
      `    <text x="${fmt(x + 14)}" y="${fmt(y + 18)}" text-anchor="middle" fill="#0b1220" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="9" font-weight="700">${escapeXml(tokenFor(node))}</text>`,
    );

    for (const [index, line] of lines.entries()) {
      svg.push(
        `    <text x="${fmt(x + widthValue / 2)}" y="${fmt(y + 24 + index * 14)}" text-anchor="middle" fill="#f8fafc" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="11.5" font-weight="${node?.IsEntry ? "700" : "600"}">${escapeXml(line)}</text>`,
      );
    }
  }
  svg.push(`  </g>`);
  svg.push(`</svg>`);
  return svg.join("\n");
}

function edgeSectionsToPoints(sections = [], offsetX, offsetY) {
  const points = [];
  for (const section of sections ?? []) {
    if (section.startPoint) {
      points.push({
        x: section.startPoint.x + offsetX,
        y: section.startPoint.y + offsetY,
      });
    }
    for (const bendPoint of section.bendPoints ?? []) {
      points.push({
        x: bendPoint.x + offsetX,
        y: bendPoint.y + offsetY,
      });
    }
    if (section.endPoint) {
      points.push({
        x: section.endPoint.x + offsetX,
        y: section.endPoint.y + offsetY,
      });
    }
  }

  return dedupeSequential(points);
}

function polylinePath(points) {
  const [first, ...rest] = points;
  return `M ${fmt(first.x)} ${fmt(first.y)} ${rest.map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`).join(" ")}`;
}

function dedupeSequential(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      deduped.push(point);
    }
  }

  return deduped;
}

function nodeColor(node, graphKey) {
  if (node?.IsEntry) {
    return "#fde68a";
  }
  if (node?.Role === "anchor") {
    return "#94a3b8";
  }
  if (graphKey === "control-flow") {
    return node?.Title?.includes("Server") ? "#60a5fa" : "#fb7185";
  }
  if (node?.Title?.includes("Shared")) {
    return "#67e8f9";
  }
  if (node?.Title?.includes("UI") || node?.Title?.includes("Client")) {
    return "#4ade80";
  }
  if (node?.Title?.includes("Simulation") || node?.Title?.includes("Zone") || node?.Title?.includes("Galaxy")) {
    return "#c084fc";
  }
  return "#22d3ee";
}

function tokenFor(node) {
  if (!node) {
    return "N";
  }
  if (node.IsEntry) {
    return "E";
  }
  if (node.Role === "anchor") {
    return "A";
  }
  const words = node.Title.split(/[\s/_-]+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] ?? "N"}${words[1][0] ?? ""}`.toUpperCase();
}

function wrapLabel(label, maxChars, maxLines) {
  const words = label.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === 0) {
    lines.push(label);
  }
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[lines.length - 1];
    if (last.length > maxChars - 3) {
      lines[lines.length - 1] = `${last.slice(0, Math.max(1, maxChars - 3))}...`;
    }
  }
  return lines;
}

function ensureAlgorithmAvailable(algorithm, knownAlgorithms) {
  if (!knownAlgorithms.has(algorithm)) {
    throw new Error(
      `Algorithm '${algorithm}' is not available in this elkjs build.`,
    );
  }
}

async function assertFile(filePath) {
  await fs.access(filePath);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSize(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function resolveMaybeRelative(targetPath) {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath);
}

function timestampNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fmt(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}
