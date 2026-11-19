#!/usr/bin/env node
// Read-only (except --lock/--unlock): computes phase and ticket status from the plan files and git.
//
// Usage:
//   node phase-state.mjs                     list every phase
//   node phase-state.mjs <slug>              show one phase as a table
//   node phase-state.mjs <slug> --json       same, as JSON (used by start-phase)
//   node phase-state.mjs <slug> --json --running T01,T03
//        also computes `next_batch`: tickets that can start now without
//        overlapping (by `touches`) the tickets currently running.
//        `running` lists every ticket that has an agent working on it (worker or reviewer).
//   node phase-state.mjs --overlaps <slug>   compare the phase's `touches` with every other
//        phase that is not merged yet, and flag hot spots (lockfiles, migrations, i18n)
//   node phase-state.mjs --overlaps --touches a/,b.ts [--json]
//        same, for a plan that is not written yet (used by feature-request)
//   node phase-state.mjs --lock <slug>       take the merge queue lock (exit 1 if held)
//   node phase-state.mjs --unlock <slug> [--force]   release it
//   node phase-state.mjs --check-setup       check that .gitignore fits the workflow
//        (exit 1 and print what to add when it does not)
//
// Status rules (highest wins):
//   done        a commit on phase/<slug> has the trailer "Ticket: <slug>/<id>"
//   blocked     runtime.json marks the ticket blocked
//   in_progress branch ticket/<slug>/<id> exists (work started, maybe interrupted)
//   ready       every dependency is done
//   waiting     some dependency is not done yet
//
// A phase is `merged` when phase/<slug> is an ancestor of its base branch.

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
    issues.push('Thư mục .claude/worktrees/ chưa được ignore: worktree của phase và ticket sẽ làm checkout chính bị bẩn.');
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

const VALUE_FLAGS = new Set(['--running', '--touches']);
const flagValue = (name) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : null;
};
const splitList = (v) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const asJson = args.includes('--json');
const runningProvided = args.includes('--running');
const running = new Set(splitList(flagValue('--running')));
const slug = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));

const branchExists = (name) =>
  git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null;

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---- merge queue lock (lives inside .git, so it never shows up in the working tree) ----

function lockCommand(action) {
  const dir = path.join(commonDir, 'phase-merge.lock');
  const infoFile = path.join(dir, 'info.json');
  if (!slug) {
    process.stderr.write(`phase-state: --${action} needs a phase slug\n`);
    return 2;
  }
  if (action === 'lock') {
    try {
      fs.mkdirSync(dir); // atomic: fails when the lock already exists
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const info = readJsonFile(infoFile) ?? {};
      process.stdout.write(
        `Hàng đợi merge đang bị khoá bởi phase "${info.slug ?? '?'}" từ ${info.locked_at ?? '?'}.\n` +
          `Nếu chắc chắn phiên đó đã dừng, mở khoá bằng: --unlock ${info.slug ?? '<slug>'} --force\n`,
      );
      return 1;
    }
    fs.writeFileSync(
      infoFile,
      `${JSON.stringify({ slug, locked_at: new Date().toISOString() }, null, 2)}\n`,
    );
    process.stdout.write(`Đã khoá hàng đợi merge cho phase "${slug}".\n`);
    return 0;
  }
  if (!fs.existsSync(dir)) {
    process.stdout.write('Hàng đợi merge không bị khoá.\n');
    return 0;
  }
  const info = readJsonFile(infoFile) ?? {};
  if (info.slug && info.slug !== slug && !args.includes('--force')) {
    process.stdout.write(`Khoá thuộc về phase "${info.slug}", không phải "${slug}". Thêm --force để mở khoá.\n`);
    return 1;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write('Đã mở khoá hàng đợi merge.\n');
  return 0;
}

if (args.includes('--lock')) process.exit(lockCommand('lock'));
if (args.includes('--unlock')) process.exit(lockCommand('unlock'));

// ---- plan and state ----

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

function pathsOverlap(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

function overlaps(a, b) {
  const ta = a.touches ?? [];
  const tb = b.touches ?? [];
  // A ticket without `touches` is treated as touching everything.
  if (ta.length === 0 || tb.length === 0) return true;
  return ta.some((x) => tb.some((y) => pathsOverlap(x, y)));
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
      complexity: t.complexity ?? 'normal',
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
    if (rt.review_rounds) info.review_rounds = rt.review_rounds;
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

  const baseBranch = plan.base_branch;
  const merged =
    started &&
    Boolean(baseBranch) &&
    branchExists(baseBranch) &&
    git(['merge-base', '--is-ancestor', `refs/heads/${phaseBranch}`, `refs/heads/${baseBranch}`]) !== null;

  const state = {
    slug: phaseSlug,
    title: plan.title,
    base_branch: baseBranch,
    branch: phaseBranch,
    started,
    merged,
    // Where phase/<slug> is checked out right now (null when nowhere), and where start-phase puts it.
    phase_worktree: worktrees.get(phaseBranch) ?? null,
    phase_worktree_path: path.join(mainRoot, '.claude', 'worktrees', `phase-${phaseSlug}`).replace(/\\/g, '/'),
    main_root: mainRoot.replace(/\\/g, '/'),
    plan_source: source,
    max_parallel: plan.max_parallel ?? 3,
    total: result.length,
    counts,
    complete: result.length > 0 && counts.done === result.length,
    tickets: result,
    phase_runtime: runtime.phase ?? null,
    warnings,
  };

  if (runningProvided) {
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
      complexity: b.complexity,
    }));
  }
  return state;
}

// ---- overlaps between phases ----

const HOT_SPOTS = [
  {
    kind: 'lockfile',
    re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
    advice: 'Không giải xung đột lockfile bằng tay: lấy bản của nhánh gốc rồi chạy lại lệnh cài đặt để sinh lại.',
  },
  {
    kind: 'migration',
    re: /(^|\/)(migrations?|db\/migrate)(\/|$)/i,
    advice: 'Đặt tên migration theo timestamp (không đánh số thứ tự) và kiểm tra lại thứ tự khi merge.',
  },
  {
    kind: 'i18n',
    re: /(^|\/)(locales?|i18n)(\/|$)/i,
    advice: 'Chỉ thêm khoá mới, không sửa dòng cũ, để hai phase thêm khoá song song không xung đột.',
  },
];

function overlapReport(selfSlug, touches) {
  const mine = touches.map(normalize).filter(Boolean);
  const others = [];
  for (const s of listSlugs()) {
    if (s === selfSlug) continue;
    const st = phaseState(s);
    if (st.error || st.merged) continue;
    const seen = new Set();
    const hits = [];
    for (const t of st.tickets) {
      // Tickets without `touches` (e.g. fix tickets) would flag everything: skip them here.
      for (const theirs of (t.touches ?? []).map(normalize)) {
        for (const m of mine) {
          const key = `${t.id}|${theirs}|${m}`;
          if (!pathsOverlap(m, theirs) || seen.has(key)) continue;
          seen.add(key);
          hits.push({ ticket: t.id, their_path: theirs, your_path: m });
        }
      }
    }
    if (hits.length) {
      others.push({
        phase: s,
        title: st.title,
        started: st.started,
        done: st.counts.done,
        total: st.total,
        hits,
      });
    }
  }
  const hotSpots = [];
  for (const m of mine) {
    for (const h of HOT_SPOTS) if (h.re.test(m)) hotSpots.push({ path: m, kind: h.kind, advice: h.advice });
  }
  return { phase: selfSlug ?? null, touches: mine, overlapping_phases: others, hot_spots: hotSpots };
}

function printOverlaps(r) {
  const lines = [];
  if (r.overlapping_phases.length === 0) {
    lines.push('Không có phase nào khác (chưa merge) chạm tới cùng file/thư mục.');
  } else {
    lines.push('Chồng chéo với các phase chưa merge:');
    for (const o of r.overlapping_phases) {
      lines.push(`- ${o.phase} (${o.started ? 'đã bắt đầu' : 'chưa bắt đầu'}, ${o.done}/${o.total} ticket xong) — ${o.title ?? ''}`);
      for (const h of o.hits) lines.push(`    ${h.ticket}: ${h.their_path}  ↔  ${h.your_path}`);
    }
    lines.push('Phase nào merge sau sẽ phải rebase và có thể xung đột. Nên merge lần lượt, hoặc tách phần dùng chung thành ticket merge trước.');
  }
  if (r.hot_spots.length) {
    lines.push('', 'Điểm nóng dễ xung đột:');
    for (const h of r.hot_spots) lines.push(`- ${h.path} (${h.kind}): ${h.advice}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (args.includes('--overlaps')) {
  let touches = splitList(flagValue('--touches'));
  if (touches.length === 0 && slug) {
    const st = phaseState(slug);
    if (st.error) {
      process.stdout.write(`Phase ${slug}: ${st.error}\n`);
      process.exit(1);
    }
    touches = st.tickets.flatMap((t) => t.touches);
  }
  if (touches.length === 0) {
    process.stderr.write('phase-state: --overlaps needs a phase slug or --touches a,b,c\n');
    process.exit(2);
  }
  const report = overlapReport(slug ?? null, touches);
  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printOverlaps(report);
  process.exit(0);
}

// ---- printing ----

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
    `Nhánh: ${s.branch} (${s.merged ? `đã merge vào ${s.base_branch}` : s.started ? 'đã bắt đầu' : 'chưa bắt đầu'}), base: ${s.base_branch ?? '?'}`,
    `Tiến độ: ${s.counts.done}/${s.total} ticket xong (${pct}%)` +
      ` — đang làm ${s.counts.in_progress}, bị chặn ${s.counts.blocked}, sẵn sàng ${s.counts.ready}, chờ ${s.counts.waiting}`,
  ];
  if (s.phase_runtime?.qa_rounds) lines.push(`QA: đã chạy ${s.phase_runtime.qa_rounds} vòng`);
  lines.push('');
  for (const t of s.tickets) {
    const deps = t.depends_on.length ? ` (cần: ${t.depends_on.join(', ')})` : '';
    const simple = t.complexity === 'simple' ? ' [đơn giản]' : '';
    lines.push(`  ${t.id.padEnd(5)} ${LABELS[t.status].padEnd(9)} ${t.title}${simple}${deps}`);
    if (t.status === 'in_progress') {
      lines.push(
        `        ${t.commits_ahead} commit trên ${t.branch}${t.dirty ? ', có thay đổi chưa commit' : ''}${t.worktree ? '' : ', không có worktree'}` +
          `${t.review_rounds ? `, đã review lại ${t.review_rounds} lần` : ''}`,
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
      const label = s.merged
        ? 'đã merge'
        : s.started
          ? s.complete
            ? 'hoàn thành, chờ merge'
            : 'đã bắt đầu'
          : 'chưa bắt đầu';
      process.stdout.write(
        `- ${s.slug}: ${s.counts.done}/${s.total} xong` +
          `${s.counts.in_progress ? `, ${s.counts.in_progress} đang làm` : ''}` +
          `${s.counts.blocked ? `, ${s.counts.blocked} bị chặn` : ''}` +
          ` — ${label} — ${s.title ?? ''}\n`,
      );
    }
  }
}
