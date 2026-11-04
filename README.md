# phase-workflow

Plugin Claude Code để làm một tính năng lớn theo **phase**:

1. `/phase-workflow:feature-request <mô tả>`: hỏi bạn mọi điểm chưa rõ, rồi chia yêu cầu thành các ticket trong `.claude/phases/<slug>/`. Chỉ lập kế hoạch, không sửa code.
2. `/phase-workflow:start-phase <slug>`: giao từng ticket cho subagent `ticket-worker`. Các ticket không phụ thuộc nhau chạy song song, mỗi ticket trong một git worktree riêng. Mỗi ticket thành 1 commit trên nhánh `phase/<slug>`. Chạy lại được bất cứ lúc nào để tiếp tục.
3. `/phase-workflow:phase-status [slug]`: xem tiến độ (chỉ đọc).

Repo này vừa là plugin vừa là marketplace chứa chính nó.

## Yêu cầu

- Dự án là một git repo.
- Có `node` trong PATH (script trạng thái `scripts/phase-state.mjs` chỉ dùng Node và git, không cần cài thêm gì).
- Nên có `CLAUDE.md` ghi lệnh cài đặt, lint và test, để kế hoạch lấy đúng lệnh kiểm tra.

## Cài đặt

### Từ thư mục trên máy

```bash
claude plugin marketplace add C:/Users/AD/Documents/Work/claude-phase-workflow
claude plugin install phase-workflow@phase-workflow --scope project
```

Chạy lệnh thứ hai trong thư mục của dự án muốn dùng. `--scope project` ghi vào `.claude/settings.json` của dự án. Dùng `--scope user` nếu muốn bật cho mọi dự án trên máy.

### Từ GitHub (sau khi đẩy repo này lên)

```bash
claude plugin marketplace add <owner>/claude-phase-workflow
claude plugin install phase-workflow@phase-workflow --scope project
```

Để cả team tự được gợi ý cài khi mở dự án, thêm vào `.claude/settings.json` của dự án:

```json
{
  "extraKnownMarketplaces": {
    "phase-workflow": {
      "source": { "source": "github", "repo": "<owner>/claude-phase-workflow" }
    }
  },
  "enabledPlugins": {
    "phase-workflow@phase-workflow": true
  }
}
```

## Chuẩn bị `.gitignore` của dự án

Quy trình cần:

- `.claude/worktrees/` **bị ignore** (worktree của từng ticket nằm ở đây);
- `.claude/phases/*/runtime.json` **bị ignore** (trạng thái tạm);
- các file kế hoạch khác trong `.claude/phases/` **không bị ignore** (chúng được commit).

Thường chỉ cần thêm:

```gitignore
.claude/worktrees/
.claude/phases/*/runtime.json
```

Nếu dự án đang ignore cả `.claude/`, đổi thành:

```gitignore
.claude/*
!.claude/phases/
.claude/phases/*/runtime.json
```

Không cần nhớ: `feature-request` và `start-phase` tự kiểm tra bằng `node scripts/phase-state.mjs --check-setup`, đề xuất các dòng còn thiếu và chỉ sửa `.gitignore` khi bạn đồng ý.

## Chuyển từ skill trong dự án sang plugin

Nếu dự án đã có bản cũ trong `.claude/skills/{feature-request,start-phase,phase-status}` và `.claude/agents/ticket-worker.md`, hai bản sẽ cùng xuất hiện (`/feature-request` và `/phase-workflow:feature-request`). Sau khi cài plugin, xoá bản cũ để tránh nhầm. Các phase đã có trong `.claude/phases/` vẫn dùng tiếp được, vì định dạng không đổi.

## Kiểm tra plugin

```bash
claude plugin validate C:/Users/AD/Documents/Work/claude-phase-workflow
```

## Cấu trúc

```
.claude-plugin/
  plugin.json         manifest của plugin
  marketplace.json    marketplace chứa plugin này (source: "./")
skills/
  feature-request/SKILL.md
  start-phase/SKILL.md
  phase-status/SKILL.md
agents/
  ticket-worker.md
scripts/
  phase-state.mjs     tính trạng thái phase/ticket từ git, và kiểm tra .gitignore
```
