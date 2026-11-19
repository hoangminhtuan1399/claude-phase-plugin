# phase-workflow

Plugin Claude Code để làm một tính năng lớn theo **phase**, mô phỏng một nhóm nhỏ:

| Vai      | Ai làm                                    | Việc                                                              |
| -------- | ----------------------------------------- | ----------------------------------------------------------------- |
| PM       | `feature-request`                         | hỏi làm rõ, viết test case                                        |
| Techlead | `feature-request`, `ticket-reviewer`, `merge-phase` | chia ticket, review code, merge vào nhánh gốc           |
| Dev      | `ticket-worker`                           | làm từng ticket, song song, mỗi ticket một worktree               |
| QA       | `phase-qa`                                | chạy kiểm tra cuối phase và test case, thu bằng chứng             |
| Bạn      |                                           | trả lời câu hỏi, duyệt, test và phản hồi                          |

Các lệnh:

1. `/phase-workflow:feature-request <mô tả>`: hỏi bạn mọi điểm chưa rõ, viết test case, rồi chia yêu cầu thành các ticket trong `.claude/phases/<slug>/`. Cảnh báo nếu phase chạm cùng file với phase khác đang chạy. Chỉ lập kế hoạch, không sửa code.
2. `/phase-workflow:start-phase <slug>`: giao từng ticket cho `ticket-worker`. Các ticket không phụ thuộc nhau chạy song song, mỗi ticket trong một git worktree riêng; ticket `normal` được `ticket-reviewer` review trước khi gộp. Mỗi ticket thành 1 commit trên nhánh `phase/<slug>`, nằm trong worktree riêng của phase. Khi mọi ticket xong: kiểm tra cuối phase, QA, rồi hỏi bạn duyệt hay có lỗi cần sửa (lỗi thành ticket sửa). Chạy lại được bất cứ lúc nào để tiếp tục.
3. `/phase-workflow:merge-phase <slug>`: sau khi bạn duyệt, rebase phase lên nhánh gốc mới nhất, chạy lại toàn bộ kiểm tra, rồi fast-forward vào nhánh gốc. Chạy từng phase một (có khoá). Kiểm tra đỏ thì không merge mà tạo ticket sửa. Không push.
4. `/phase-workflow:phase-status [slug]`: xem tiến độ (chỉ đọc).

Repo này vừa là plugin vừa là marketplace chứa chính nó.

## Làm nhiều tính năng cùng lúc

Mỗi phase là một tính năng, có nhánh và worktree riêng (`.claude/worktrees/phase-<slug>`). `start-phase` không đổi nhánh của checkout chính nên mở mỗi phase trong một phiên Claude Code riêng là được. Nên bắt đầu với 2 phase: bạn là nút cổ chai vì phải test từng phase, và mỗi phase nhân đôi số agent chạy cùng lúc (quota, RAM, cổng dev server).

```
nhánh gốc ← phase/<slug> ← ticket/<slug>/T01, T02, ...
```

`/phase-workflow:merge-phase` chạy lần lượt. Phase nào merge sau sẽ được rebase và chạy lại kiểm tra trên code của phase đã merge trước. `node scripts/phase-state.mjs --overlaps <slug>` cho biết các phase đang chạy có chạm cùng file không.

## Model và tốc độ

| Việc                                   | Model              |
| -------------------------------------- | ------------------ |
| `feature-request`, `start-phase`, `merge-phase`, `ticket-reviewer` | opus |
| `ticket-worker` (ticket `normal`)      | sonnet             |
| `ticket-worker` (ticket `simple`)      | haiku, không review |
| `phase-qa`                             | sonnet; haiku khi mọi test case đều loại `auto` |

Review là bước duy nhất làm mỗi ticket chậm hơn (thêm vài phút, thêm một vòng sửa nếu bị trả lại). Reviewer chạy nền nên không chặn các ticket độc lập. QA và merge tính theo phase, không theo ticket. Đặt `complexity: simple` chỉ cho thay đổi cơ học vì nó bỏ qua review.

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

- `.claude/worktrees/` **bị ignore** (worktree của phase và của từng ticket nằm ở đây);
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

## Nâng từ phiên bản 1.0

- Phase đã có vẫn dùng tiếp được; `complexity` thiếu thì coi là `normal`, và phase cũ chưa có mục "Test case" thì QA chỉ chạy "Kiểm tra cuối phase".
- Bản 1.0 để checkout chính đứng trên nhánh `phase/<slug>`. Nếu có phase đang dở theo cách đó, chạy `git switch <nhánh gốc>` ở checkout chính (cần sạch) trước khi chạy `start-phase` bản mới.
- Hàng đợi merge dùng khoá nằm trong `.git/phase-merge.lock`, không cần ignore thêm gì.

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
  merge-phase/SKILL.md
  phase-status/SKILL.md
agents/
  ticket-worker.md
  ticket-reviewer.md
  phase-qa.md
scripts/
  phase-state.mjs     tính trạng thái phase/ticket từ git, so chồng chéo giữa các phase,
                      khoá hàng đợi merge, kiểm tra .gitignore
```
