#!/usr/bin/env node
// Renders docs/STATUS.md from the per-task status ledger under docs/status/,
// and answers "what should I work on next?" without reading docs/STATUS.md.
//
// Dependency-free on purpose: it runs on Node 24+ with built-in TypeScript type
// stripping (`node tools/status.ts`), so it works in a fresh worktree before
// `npm ci` has ever run.
//
//   node tools/status.ts render   print the rendered docs/STATUS.md to stdout
//   node tools/status.ts write    rewrite docs/STATUS.md from the ledger
//   node tools/status.ts check    exit 1 if docs/STATUS.md is stale
//   node tools/status.ts next     pick the next task, honouring in-flight claims
//
// `next` reads the ledger from origin/main by default (the merged baseline) and
// treats any `codex/<id>-*` branch, local or on origin, as a claim. Pass
// `--local` to read the ledger from the working tree instead.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type TaskSpec = {
  id: string;
  title: string;
  file: string;
  phase: string;
  executor: string;
  deps: string[];
};

type TaskStatus = {
  id: string;
  status: string;
  updated: string;
  pr: string;
  note: string;
};

type OpenItem = {
  id: string;
  item: string;
  status: string;
  detail: string;
  resolvedBy: string[];
  updated: string;
  answer: string;
};

const FINISHED = new Set(["done", "skipped"]);
const TASKS_DIR = "docs/status/tasks";
const ITEMS_DIR = "docs/status/open-items";
const RUNBOOKS = "docs/tasks/README.md";
const SOURCES = "docs/planning/11-open-items-and-sources.md";
const RENDERED = "docs/STATUS.md";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(git(["rev-parse", "--show-toplevel"], here).trim());
}

function readAt(root: string, ref: string | null, path: string): string {
  if (ref === null) return readFileSync(join(root, path), "utf8");
  return git(["show", `${ref}:${path}`], root);
}

function listAt(root: string, ref: string | null, dir: string): string[] {
  const names =
    ref === null
      ? readdirSync(join(root, dir))
      : git(["ls-tree", "--name-only", `${ref}:${dir}`], root).split("\n");
  return names
    .map((n) => n.trim())
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .sort();
}

function parseDoc(text: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { fields, body: normalised.trim() };
  const end = normalised.indexOf("\n---", 3);
  const head = normalised.slice(4, end);
  const body = normalised.slice(normalised.indexOf("\n", end + 1) + 1);
  for (const line of head.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: body.trim() };
}

function cell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function idList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "-" && s !== "\u2014");
}

function loadSpecs(root: string, ref: string | null): TaskSpec[] {
  const specs: TaskSpec[] = [];
  for (const line of readAt(root, ref, RUNBOOKS).split(/\r?\n/)) {
    const match = /^\|\s*\[(T\d+[a-z]?)\s*\u2014\s*([^\]]+)\]\(([^)]+)\)\s*\|(.*)\|\s*$/.exec(line);
    if (match === null) continue;
    const rest = (match[4] ?? "").split("|").map((s) => s.trim());
    specs.push({
      id: (match[1] ?? "").trim(),
      title: (match[2] ?? "").trim(),
      file: (match[3] ?? "").trim(),
      phase: rest[0] ?? "",
      executor: rest[1] ?? "",
      deps: idList(rest[2] ?? ""),
    });
  }
  return specs;
}

function loadStatuses(root: string, ref: string | null): Map<string, TaskStatus> {
  const out = new Map<string, TaskStatus>();
  for (const name of listAt(root, ref, TASKS_DIR)) {
    const { fields, body } = parseDoc(readAt(root, ref, `${TASKS_DIR}/${name}`));
    const id = fields["id"] ?? name.replace(/\.md$/, "");
    out.set(id, {
      id,
      status: fields["status"] ?? "not started",
      updated: fields["updated"] ?? "",
      pr: fields["pr"] ?? "",
      note: body,
    });
  }
  return out;
}

function loadItems(root: string, ref: string | null): OpenItem[] {
  const out: OpenItem[] = [];
  for (const name of listAt(root, ref, ITEMS_DIR)) {
    const { fields, body } = parseDoc(readAt(root, ref, `${ITEMS_DIR}/${name}`));
    out.push({
      id: fields["id"] ?? name.replace(/\.md$/, ""),
      item: fields["item"] ?? "",
      status: fields["status"] ?? "unresolved",
      detail: fields["detail"] ?? "",
      resolvedBy: idList(fields["resolved_by"] ?? ""),
      updated: fields["updated"] ?? "",
      answer: body,
    });
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}

// The question itself is spec, not status: \u00a715 of the sources chunk defines it, and the
// ledger carries only what changes. An `item:` field in a ledger file is a fallback for an
// item that has no \u00a715 row yet.
function loadItemTexts(root: string, ref: string | null): Map<string, string> {
  const texts = new Map<string, string>();
  for (const line of readAt(root, ref, SOURCES).split(/\r?\n/)) {
    const match = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/.exec(line);
    if (match === null) continue;
    texts.set(match[1] ?? "", match[2] ?? "");
  }
  return texts;
}

function isFinished(statuses: Map<string, TaskStatus>, id: string): boolean {
  return FINISHED.has(statuses.get(id)?.status ?? "not started");
}

function unmetDeps(spec: TaskSpec, statuses: Map<string, TaskStatus>): string[] {
  return spec.deps.filter((d) => !isFinished(statuses, d));
}

function renderStatus(
  specs: TaskSpec[],
  statuses: Map<string, TaskStatus>,
  items: OpenItem[],
  itemTexts: Map<string, string>,
): string {
  const stamps = [...statuses.values()].map((s) => s.updated).filter((s) => s.length > 0);
  const lastUpdated = stamps.sort().at(-1) ?? "";

  const ready = specs.filter(
    (s) => !isFinished(statuses, s.id) && unmetDeps(s, statuses).length === 0,
  );
  const focus = ready[0];

  const out: string[] = [];
  out.push("---");
  out.push("status: generated");
  out.push("source: docs/status/");
  out.push(`last-updated: ${lastUpdated}`);
  out.push("---");
  out.push("");
  out.push("<!-- Generated by `npm run status:write` from docs/status/. Do not edit by hand:");
  out.push("     edit docs/status/tasks/<id>.md or docs/status/open-items/<n>.md instead. -->");
  out.push("");
  out.push("\u2190 [Index](PLANNING.md) \u00b7 [Task runbooks](tasks/README.md) \u00b7 [Status ledger](status/README.md)");
  out.push("");
  out.push("# Build status");
  out.push("");
  out.push(
    "This is a **rendered view**. Status lives one file per task in [status/tasks/](status/README.md)" +
      " so that tasks running in parallel never edit the same file. Regenerate with `npm run status:write`.",
  );
  out.push("");
  if (focus !== undefined) {
    out.push(
      `**Next up:** [${focus.id} \u2014 ${focus.title}](tasks/${focus.file}) \u2014 the earliest task that is not finished and whose dependencies are all \`done\` on \`main\`.`,
    );
    out.push("");
    out.push(
      `**Ready now:** ${ready.map((s) => `[${s.id}](tasks/${s.file}) (${s.executor})`).join(" \u00b7 ")}`,
    );
  } else {
    out.push("**Next up:** nothing is ready \u2014 every remaining task is waiting on a dependency.");
  }
  out.push("");
  out.push(
    "A task already claimed by an in-flight branch still shows as `not started` here until its PR merges." +
      " Run `npm run status:next` for the live picture, which folds in `codex/<id>-*` branches.",
  );
  out.push("");
  out.push("Status values: `not started` \u00b7 `in progress` \u00b7 `done` \u00b7 `blocked` \u00b7 `skipped`.");
  out.push("");
  out.push("## Tasks");
  out.push("");
  out.push("| ID | Task | Phase \u2014 [\u00a713](planning/10-build-order-and-client.md#13-build-order) | Executor | Status | Notes |");
  out.push("| -- | ---- | ----- | -------- | ------ | ----- |");
  for (const spec of specs) {
    const status = statuses.get(spec.id);
    const notes: string[] = [];
    if (status !== undefined && status.note.length > 0) notes.push(cell(status.note));
    if (status !== undefined && status.pr.length > 0) notes.push(cell(`PR: ${status.pr}`));
    out.push(
      `| ${spec.id} | [${cell(spec.title)}](tasks/${spec.file}) | ${cell(spec.phase)} | ${cell(spec.executor)} | ${status?.status ?? "not started"} | ${notes.join(" \u2014 ")} |`,
    );
  }
  out.push("");
  out.push("Dependencies live in [tasks/README.md](tasks/README.md) and in each task's header; they are not duplicated here.");
  out.push("");
  out.push("## Open items");
  out.push("");
  out.push("| # | Item \u2014 defined in [\u00a715](planning/11-open-items-and-sources.md#15-open-items) | Status | Resolved by |");
  out.push("| - | ---- | ------ | ----------- |");
  const byId = new Map(specs.map((s) => [s.id, s]));
  for (const item of items) {
    const bits = [item.status];
    if (item.detail.length > 0) bits.push(item.detail);
    if (item.answer.length > 0) bits.push(cell(item.answer));
    const links = item.resolvedBy.map((id) => {
      const spec = byId.get(id);
      return spec === undefined ? id : `[${id}](tasks/${spec.file})`;
    });
    const question = itemTexts.get(item.id) ?? item.item;
    out.push(`| ${item.id} | ${cell(question)} | ${bits.map(cell).join(" \u2014 ")} | ${links.join(", ")} |`);
  }
  out.push("");
  out.push("## Changing status");
  out.push("");
  out.push("Edit the one file that owns the row \u2014 never this file. See [status/README.md](status/README.md).");
  out.push("");
  out.push("---");
  out.push("");
  out.push("\u2190 [Index](PLANNING.md) \u00b7 [Task runbooks](tasks/README.md) \u00b7 [Status ledger](status/README.md)");
  out.push("");
  return out.join("\n");
}

function claimedIds(root: string): Map<string, string[]> {
  const refs: string[] = [];
  try {
    refs.push(...git(["branch", "--list", "codex/*", "--format=%(refname:short)"], root).split("\n"));
  } catch {
    // no local branches is fine
  }
  try {
    for (const line of git(["ls-remote", "--heads", "origin", "codex/*"], root).split("\n")) {
      const ref = line.split("\t")[1];
      if (ref !== undefined) refs.push(`origin/${ref.replace("refs/heads/", "")}`);
    }
  } catch {
    // offline: local branches still give a partial picture
  }
  const claims = new Map<string, string[]>();
  for (const raw of refs) {
    const ref = raw.trim();
    const match = /^(?:origin\/)?codex\/(T\d+[a-z]?)-/.exec(ref);
    if (match === null) continue;
    const id = match[1] ?? "";
    const list = claims.get(id) ?? [];
    list.push(ref);
    claims.set(id, list);
  }
  return claims;
}

// The ledger only exists on branches that have it. Fall back to the working tree
// rather than failing when the requested ref predates docs/status/.
function resolveRef(root: string, ref: string | null): string | null {
  if (ref === null) return null;
  try {
    git(["ls-tree", "--name-only", `${ref}:${TASKS_DIR}`], root);
    return ref;
  } catch {
    process.stderr.write(`note: ${ref} has no ${TASKS_DIR}; reading the ledger from the working tree\n`);
    return null;
  }
}

function reportNext(root: string, requested: string | null): void {
  const ref = resolveRef(root, requested);
  const specs = loadSpecs(root, ref);
  const statuses = loadStatuses(root, ref);
  const claims = claimedIds(root);
  const baseline = ref === null ? "working tree" : `${ref} (${git(["rev-parse", "--short", ref], root).trim()})`;

  const open = specs.filter((s) => !isFinished(statuses, s.id));
  const ready = open.filter((s) => unmetDeps(s, statuses).length === 0);
  const unclaimed = ready.filter((s) => !claims.has(s.id) && statuses.get(s.id)?.status !== "in progress");
  const agentReady = unclaimed.filter((s) => s.executor.includes("agent"));
  const pick = agentReady[0] ?? unclaimed[0];

  const lines: string[] = [];
  lines.push(`ledger baseline: ${baseline}`);
  lines.push("");
  if (pick === undefined) {
    lines.push("recommended: none \u2014 every ready task is already claimed by a branch.");
  } else {
    lines.push(`recommended: ${pick.id} \u2014 ${pick.title}`);
    lines.push(`  runbook:   docs/tasks/${pick.file}`);
    lines.push(`  executor:  ${pick.executor}   phase: ${pick.phase}`);
    lines.push(`  status:    ${statuses.get(pick.id)?.status ?? "not started"}   deps: ${pick.deps.join(", ") || "none"}`);
    lines.push(`  branch:    codex/${pick.id}-${pick.file.replace(/^T\d+[a-z]?-/, "").replace(/\.md$/, "")}`);
  }
  lines.push("");
  lines.push("ready and unclaimed:");
  for (const s of unclaimed) lines.push(`  ${s.id.padEnd(5)} ${s.executor.padEnd(19)} ${s.title}`);
  if (unclaimed.length === 0) lines.push("  (none)");
  lines.push("");
  lines.push("claimed / in flight:");
  for (const s of open) {
    const refs = claims.get(s.id);
    const inProgress = statuses.get(s.id)?.status === "in progress";
    if (refs === undefined && !inProgress) continue;
    lines.push(`  ${s.id.padEnd(5)} ${(refs ?? ["ledger says in progress"]).join(", ")}`);
  }
  lines.push("");
  lines.push("waiting on dependencies:");
  for (const s of open) {
    const missing = unmetDeps(s, statuses);
    if (missing.length === 0) continue;
    lines.push(`  ${s.id.padEnd(5)} needs ${missing.join(", ")}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function main(): void {
  const root = repoRoot();
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith("-")) ?? "render";
  const local = args.includes("--local");

  if (command === "next") {
    reportNext(root, local ? null : "origin/main");
    return;
  }

  const rendered = renderStatus(
    loadSpecs(root, null),
    loadStatuses(root, null),
    loadItems(root, null),
    loadItemTexts(root, null),
  );
  const target = join(root, RENDERED);

  if (command === "render") {
    process.stdout.write(rendered);
    return;
  }
  if (command === "write") {
    writeFileSync(target, rendered, "utf8");
    process.stdout.write(`wrote ${RENDERED}\n`);
    return;
  }
  if (command === "check") {
    const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== rendered) {
      process.stderr.write(`${RENDERED} is stale \u2014 run \`npm run status:write\`\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${RENDERED} is up to date\n`);
    return;
  }

  process.stderr.write(`unknown command: ${command}\nusage: node tools/status.ts [render|write|check|next] [--local]\n`);
  process.exitCode = 2;
}

main();
