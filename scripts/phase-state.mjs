#!/usr/bin/env node
// Read-only: computes phase and ticket status from the plan files and git.
//
// Usage:
//   node phase-state.mjs                     list every phase
//   node phase-state.mjs <slug>              show one phase as a table
//   node phase-state.mjs <slug> --json       same, as JSON (used by start-phase)
//   node phase-state.mjs <slug> --json --running T01,T03
//        also computes `next_batch`: tickets that can start now without
//        overlapping (by `touches`) the tickets currently running.
//   node phase-state.mjs --check-setup       check that .gitignore fits the workflow
//        (exit 1 and print what to add when it does not)
//
// Status rules (highest wins):
//   done        a commit on phase/<slug> has the trailer "Ticket: <slug>/<id>"
//   blocked     runtime.json marks the ticket blocked
//   in_progress branch ticket/<slug>/<id> exists (work started, maybe interrupted)
//   ready       every dependency is done
//   waiting     some dependency is not done yet

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PHASES_REL = '.claude/phases';

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: mainRoot ?? process.cwd(),
    }).trim();
  } catch {
    return null;
  }
}

let mainRoot = null;
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
if (!commonDir) {
  process.stderr.write('phase-state: not inside a git repository\n');
  process.exit(1);
}
mainRoot = path.dirname(commonDir);
const phasesDir = path.join(mainRoot, PHASES_REL);

const args = process.argv.slice(2);

// Worktrees and runtime.json must be ignored; the plan files must not be,
// because start-phase commits them as the first commit of the phase branch.
function checkSetup() {
  const isIgnored = (rel) => git(['check-ignore', '-q', '--no-index', rel]) !== null;
  const runtimeLine = `${PHASES_REL}/*/runtime.json`;
  const issues = [];
  const add = [];
  if (!isIgnored('.claude/worktrees/probe/file')) {
    issues.push('Thư mục .claude/worktrees/ chưa được ignore: worktree của ticket sẽ làm checkout chính bị bẩn.');
    add.push('.claude/worktrees/');
  }
  const planFiles = ['tickets.json', 'PHASE.md', 'tickets/T01-probe.md'];
  if (planFiles.some((f) => isIgnored(`${PHASES_REL}/probe/${f}`))) {
    issues.push(
      'File kế hoạch trong .claude/phases/ đang bị ignore nên không commit được. ' +
        'Nếu .gitignore có ".claude/" thì đổi thành ".claude/*" (để vẫn ignore phần còn lại của .claude/) rồi thêm các dòng bên dưới.',
    );
    // Un-ignoring the phases folder also un-ignores runtime.json, so re-ignore it after.
    add.push(`!${PHASES_REL}/`, runtimeLine);
  } else if (!isIgnored(`${PHASES_REL}/probe/runtime.json`)) {
    issues.push('File runtime.json của phase chưa được ignore: trạng thái tạm sẽ bị commit nhầm.');
    add.push(runtimeLine);
  }
  if (issues.length === 0) {
    process.stdout.write('OK: .gitignore đã phù hợp với quy trình phase.\n');
    return 0;
  }
  const lines = ['Chưa sẵn sàng:'];
  for (const issue of issues) lines.push(`- ${issue}`);
  lines.push('', `Đề xuất thêm vào cuối ${path.join(mainRoot, '.gitignore')}:`);
  for (const line of add) lines.push(`  ${line}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 1;
}

if (args.includes('--check-setup')) process.exit(checkSetup());

const asJson = args.includes('--json');
const runningIdx = args.indexOf('--running');
const running = new Set(
  runningIdx >= 0 && args[runningIdx + 1]
    ? args[runningIdx + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
);
const slug = args.find((a, i) => !a.startsWith('--') && (runningIdx < 0 || i !== runningIdx + 1));

const branchExists = (name) =>
  git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null;

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readPlan(phaseSlug) {
  const rel = `${PHASES_REL}/${phaseSlug}/tickets.json`;
  const branch = `phase/${phaseSlug}`;
  const started = branchExists(branch);
  if (started) {
    const raw = git(['show', `${branch}:${rel}`]);
    if (raw) {
      try {
        return { plan: JSON.parse(raw), started, source: `branch ${branch}` };
      } catch {
        // fall through to the working tree copy
      }
    }
  }
  const plan = readJsonFile(path.join(mainRoot, rel));
  return plan ? { plan, started, source: 'working tree' } : null;
}

function listSlugs() {
  const slugs = new Set();
  if (fs.existsSync(phasesDir)) {
    for (const entry of fs.readdirSync(phasesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(phasesDir, entry.name, 'tickets.json'))) {
        slugs.add(entry.name);
      }
    }
  }
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/phase/']);
  for (const ref of (refs ?? '').split('\n').filter(Boolean)) {
    slugs.add(ref.replace(/^phase\//, ''));
  }
  return [...slugs].sort((a, b) => a.localeCompare(b));
}

function doneIds(phaseSlug) {
  const branch = `phase/${phaseSlug}`;
  if (!branchExists(branch)) return new Set();
  const out = git([
    'log',
    `refs/heads/${branch}`,
    '--format=%(trailers:key=Ticket,valueonly=true,separator=%x2C)',
  ]);
  const ids = new Set();
  for (const value of (out ?? '').split(/[\n,]/)) {
    const v = value.trim();
    if (v.startsWith(`${phaseSlug}/`)) ids.add(v.slice(phaseSlug.length + 1));
  }
  return ids;
}

function worktreesByBranch() {
  const out = git(['worktree', 'list', '--porcelain']) ?? '';
  const map = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line.startsWith('branch ') && current) {
      map.set(line.slice('branch refs/heads/'.length), current);
    }
  }
  return map;
}

const normalize = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

function overlaps(a, b) {
  const ta = (a.touches ?? []).map(normalize);
  const tb = (b.touches ?? []).map(normalize);
  // A ticket without `touches` is treated as touching everything.
  if (ta.length === 0 || tb.length === 0) return true;
  return ta.some((x) => tb.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}

function phaseState(phaseSlug) {
  const loaded = readPlan(phaseSlug);
  if (!loaded) return { slug: phaseSlug, error: 'plan not found (no tickets.json)' };
  const { plan, started, source } = loaded;
  const tickets = plan.tickets ?? [];
  const ids = new Set(tickets.map((t) => t.id));
  const done = doneIds(phaseSlug);
  const runtime = readJsonFile(path.join(phasesDir, phaseSlug, 'runtime.json')) ?? {};
  const rtTickets = runtime.tickets ?? {};
  const worktrees = worktreesByBranch();
  const phaseBranch = `phase/${phaseSlug}`;
  const warnings = [];

  const result = tickets.map((t) => {
    const deps = t.depends_on ?? [];
    for (const d of deps) if (!ids.has(d)) warnings.push(`${t.id} depends on unknown ticket ${d}`);
    const ticketBranch = `ticket/${phaseSlug}/${t.id}`;
    const hasBranch = branchExists(ticketBranch);
    const rt = rtTickets[t.id] ?? {};
    let status;
    if (done.has(t.id)) status = 'done';
    else if (rt.status === 'blocked') status = 'blocked';
    else if (hasBranch) status = 'in_progress';
    else if (deps.every((d) => done.has(d))) status = 'ready';
    else status = 'waiting';

    const info = {
      id: t.id,
      title: t.title,
      status,
      depends_on: deps,
      touches: t.touches ?? [],
      file: t.file,
    };
    if (hasBranch && status !== 'done') {
      const wt = worktrees.get(ticketBranch) ?? null;
      info.branch = ticketBranch;
      info.worktree = wt;
      info.commits_ahead = Number(
        git(['rev-list', '--count', `${phaseBranch}..${ticketBranch}`]) ?? 0,
      );
      info.dirty = wt ? Boolean(git(['-C', wt, 'status', '--porcelain'])) : null;
    }
    if (rt.attempts) info.attempts = rt.attempts;
    if (rt.reason) info.blocked_reason = rt.reason;
    if (rt.questions?.length) info.questions = rt.questions;
    if (rt.clarifications?.length) info.clarifications = rt.clarifications;
    return info;
  });

  const counts = Object.fromEntries(
    ['done', 'in_progress', 'blocked', 'ready', 'waiting'].map((s) => [
      s,
      result.filter((r) => r.status === s).length,
    ]),
  );

  const state = {
    slug: phaseSlug,
    title: plan.title,
    base_branch: plan.base_branch,
    branch: phaseBranch,
    started,
    plan_source: source,
    max_parallel: plan.max_parallel ?? 3,
    total: result.length,
    counts,
    complete: result.length > 0 && counts.done === result.length,
    tickets: result,
    warnings,
  };

  if (runningIdx >= 0) {
    // Interrupted tickets (in_progress, not running) resume before new ones start.
    const busy = result.filter((r) => running.has(r.id));
    const slots = Math.max(0, state.max_parallel - busy.length);
    const candidates = [
      ...result.filter((r) => r.status === 'in_progress' && !running.has(r.id)),
      ...result.filter((r) => r.status === 'ready' && !running.has(r.id)),
    ];
    const batch = [];
    for (const c of candidates) {
      if (batch.length >= slots) break;
      if ([...busy, ...batch].some((o) => overlaps(c, o))) continue;
      batch.push(c);
    }
    state.running = [...running];
    state.next_batch = batch.map((b) => ({
      id: b.id,
      mode: b.status === 'in_progress' ? 'resume' : 'new',
    }));
  }
  return state;
}

const LABELS = {
  done: 'xong',
  in_progress: 'đang làm',
  blocked: 'bị chặn',
  ready: 'sẵn sàng',
  waiting: 'chờ',
};

function printPhase(s) {
  if (s.error) {
    process.stdout.write(`Phase ${s.slug}: ${s.error}\n`);
    return;
  }
  const pct = s.total ? Math.round((s.counts.done / s.total) * 100) : 0;
  const lines = [
    `Phase: ${s.slug} — ${s.title ?? ''}`,
    `Nhánh: ${s.branch} (${s.started ? 'đã bắt đầu' : 'chưa bắt đầu'}), base: ${s.base_branch ?? '?'}`,
    `Tiến độ: ${s.counts.done}/${s.total} ticket xong (${pct}%)` +
      ` — đang làm ${s.counts.in_progress}, bị chặn ${s.counts.blocked}, sẵn sàng ${s.counts.ready}, chờ ${s.counts.waiting}`,
    '',
  ];
  for (const t of s.tickets) {
    const deps = t.depends_on.length ? ` (cần: ${t.depends_on.join(', ')})` : '';
    lines.push(`  ${t.id.padEnd(5)} ${LABELS[t.status].padEnd(9)} ${t.title}${deps}`);
    if (t.status === 'in_progress') {
      lines.push(
        `        ${t.commits_ahead} commit trên ${t.branch}${t.dirty ? ', có thay đổi chưa commit' : ''}${t.worktree ? '' : ', không có worktree'}`,
      );
    }
    if (t.status === 'blocked') {
      if (t.blocked_reason) lines.push(`        Lý do: ${t.blocked_reason}`);
      for (const q of t.questions ?? []) lines.push(`        ? ${q}`);
    }
  }
  for (const w of s.warnings) lines.push(`  ! ${w}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (slug) {
  const state = phaseState(slug);
  if (asJson) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  else printPhase(state);
} else {
  const all = listSlugs().map(phaseState);
  if (asJson) process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
  else if (all.length === 0) process.stdout.write('Chưa có phase nào.\n');
  else {
    for (const s of all) {
      if (s.error) {
        process.stdout.write(`- ${s.slug}: ${s.error}\n`);
        continue;
      }
      process.stdout.write(
        `- ${s.slug}: ${s.counts.done}/${s.total} xong` +
          `${s.counts.in_progress ? `, ${s.counts.in_progress} đang làm` : ''}` +
          `${s.counts.blocked ? `, ${s.counts.blocked} bị chặn` : ''}` +
          ` — ${s.started ? (s.complete ? 'hoàn thành' : 'đã bắt đầu') : 'chưa bắt đầu'} — ${s.title ?? ''}\n`,
      );
    }
  }
}
