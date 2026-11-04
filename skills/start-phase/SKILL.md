---
name: start-phase
description: Bắt đầu hoặc tiếp tục một phase đã lập bằng /phase-workflow:feature-request. Chia các ticket cho subagent ticket-worker, chạy song song các ticket không phụ thuộc nhau, mỗi ticket trong một git worktree riêng, rồi gộp mỗi ticket thành 1 commit trên nhánh phase/<slug>. Chỉ chạy khi người dùng gọi /phase-workflow:start-phase kèm tên phase.
argument-hint: <tên phase>
disable-model-invocation: true
model: opus
---

# start-phase

Phase: `$ARGUMENTS`

Bạn là **người điều phối**. Bạn không tự viết code của ticket: việc đó giao cho subagent `phase-workflow:ticket-worker`. Việc của bạn là chuẩn bị nhánh và worktree, giao việc, kiểm tra kết quả, gộp commit, và hỏi người dùng khi bị chặn. Giao tiếp với người dùng bằng ngôn ngữ họ dùng (mặc định tiếng Việt).

Skill này chạy lại được bất cứ lúc nào. Mọi trạng thái bền vững đều nằm trong git và `runtime.json`, nên khi chạy lại sau lúc bị dừng, nó tiếp tục từ chỗ đang dở.

## Quy ước

Ký hiệu dùng trong skill (`<root>` là gốc của checkout chính: `git rev-parse --show-toplevel`):

| Ký hiệu  | Giá trị                                                               |
| -------- | --------------------------------------------------------------------- |
| `SLUG`   | tên phase                                                             |
| `PB`     | `phase/SLUG`, nhánh phase                                             |
| `TB(id)` | `ticket/SLUG/<id>`, nhánh của một ticket                              |
| `WT(id)` | `<root>/.claude/worktrees/SLUG-<id>`, worktree của một ticket         |
| `PDIR`   | `.claude/phases/SLUG`                                                 |
| `SCRIPT` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs"`                |
| `STATE`  | `SCRIPT SLUG --json`                                                  |

Quy tắc chung:

- Một ticket được coi là **xong** khi trên `PB` có commit mang trailer `Ticket: SLUG/<id>`. Không ghi trạng thái "xong" vào bất kỳ file nào.
- `PDIR/runtime.json` (không commit, phải nằm trong .gitignore) lưu thông tin tạm của từng ticket: số lần thử, lý do bị chặn, câu hỏi, các làm rõ thêm. Bạn là người duy nhất ghi file này:

  ```json
  {
    "tickets": {
      "T02": {
        "status": "blocked",
        "reason": "...",
        "questions": ["..."],
        "attempts": 1,
        "clarifications": ["Hỏi: ... → Đáp: ..."]
      }
    }
  }
  ```

- Mọi lệnh git chạy bằng Bash tool. Với worktree, dùng `git -C <WT>`.
- Không bao giờ push, không merge vào `base_branch`, không xoá nhánh `PB`.

## Bước 0: Xác định phase

Nếu `$ARGUMENTS` rỗng, chạy `SCRIPT` (không tham số) để liệt kê các phase, rồi hỏi người dùng chọn phase nào.

## Bước 1: Chuẩn bị nhánh phase

1. Chạy `SCRIPT --check-setup`. Nếu lệnh báo thiếu gì trong `.gitignore`, dừng lại, cho người dùng xem các dòng nó đề xuất và hỏi có thêm vào `.gitignore` không. Chỉ sửa khi người dùng đồng ý. Bước 3 yêu cầu checkout sạch, nên sau khi sửa phải hỏi người dùng có commit thay đổi `.gitignore` lên nhánh hiện tại không; chưa commit thì dừng. Không chạy tiếp khi kiểm tra chưa qua: worktree không được ignore sẽ làm checkout chính bị bẩn, còn `runtime.json` không được ignore sẽ bị commit nhầm.
2. Chạy `STATE`. Nếu báo lỗi không tìm thấy kế hoạch, dừng lại và gợi ý người dùng chạy `/phase-workflow:feature-request`.
3. Kiểm tra checkout chính bằng `git status --porcelain`.
   - Chỉ được có file chưa track nằm trong `.claude/phases/`, là kế hoạch của phase này hoặc của các phase khác chưa bắt đầu. Ngoài các file đó, checkout phải sạch.
   - Khi tạo commit kế hoạch, chỉ `git add` thư mục `PDIR` của phase này.
   - Nếu có thay đổi khác, **dừng và hỏi** người dùng (commit, stash, hay huỷ). Không tự động stash hay xoá.
4. Nếu `started` là `false` (nhánh `PB` chưa có):
   - `git switch -c PB <base_branch>`. Các file kế hoạch chưa track sẽ đi theo sang nhánh mới.
   - `git add PDIR`, rồi commit với message `chore(phase): plan SLUG`. Kết thúc message bằng các dòng attribution mà phiên này quy định (nếu có).
5. Nếu đã có `PB`: `git switch PB`.
6. Đảm bảo thư mục `<root>/.claude/worktrees/` tồn tại.
7. Báo người dùng tình hình hiện tại (lấy từ `STATE`): số ticket đã xong, đang dở (sẽ tiếp tục), bị chặn, và sẵn sàng.

## Bước 2: Xử lý ticket bị chặn từ lần chạy trước

Nếu có ticket `blocked` mà `runtime.json` còn ghi câu hỏi, hỏi người dùng ngay (`AskUserQuestion`, tối đa 4 câu mỗi lượt). Với mỗi câu trả lời:

- thêm vào `clarifications` của ticket;
- xoá `status`, `reason`, `questions` (đưa ticket về trạng thái có thể giao lại).

Các ticket khác vẫn chạy được trong lúc bạn chờ câu trả lời. Nếu người dùng chưa muốn trả lời, để nguyên trạng thái chặn và tiếp tục.

## Bước 3: Vòng điều phối

Gọi `running` là danh sách id các ticket đang có subagent chạy (ban đầu rỗng). Lặp lại:

1. Chạy `STATE --running <id1,id2,...>`. Kết quả có `next_batch`: danh sách `{id, mode}` có thể giao ngay. Danh sách này đã tính phụ thuộc, `touches` không giao nhau và giới hạn `max_parallel`.
2. Với mỗi ticket trong `next_batch`, chuẩn bị worktree:
   - `mode: "new"`: `git worktree add <WT(id)> -b <TB(id)> PB`
   - `mode: "resume"`: nếu nhánh đã có worktree thì dùng lại; nếu chưa có thì `git worktree add <WT(id)> <TB(id)>`.
3. **Giao tất cả ticket trong đợt bằng nhiều lệnh gọi `Agent` trong cùng một tin nhắn** (`subagent_type: "phase-workflow:ticket-worker"`) để chúng chạy song song. Thêm các id này vào `running`. Prompt cho mỗi agent theo mẫu ở cuối skill.
4. Mỗi khi một agent trả kết quả, bỏ id đó khỏi `running` rồi xử lý theo `STATUS`:
   - **DONE**: chạy Bước 4 (gộp ticket).
   - **BLOCKED**: ghi `status: "blocked"`, `reason`, `questions` vào `runtime.json`, rồi hỏi người dùng như Bước 2. Khi có câu trả lời, ticket được giao lại ở lượt sau với `mode: "resume"`; câu trả lời được truyền vào prompt qua mục làm rõ thêm.
   - **FAILED** (kiểm tra không qua, hoặc lỗi không tự sửa được): tăng `attempts`. Nếu `attempts < 2`, giao lại với `mode: "fix"` kèm nội dung lỗi. Nếu không, đánh dấu `blocked` với lý do là lỗi đó và hỏi người dùng cách xử lý.
   - Kết quả không đúng định dạng: coi như FAILED.
5. Sau khi xử lý một kết quả, quay lại bước 1 để lấp chỗ trống. Không cần chờ cả đợt xong mới giao ticket mới.
6. Dừng vòng lặp khi:
   - `complete` là `true`: chuyển sang Bước 5; hoặc
   - không còn gì đang chạy và `next_batch` rỗng, nhưng phase chưa xong (tất cả ticket còn lại bị chặn hoặc đang chờ ticket bị chặn): báo người dùng danh sách ticket bị chặn kèm lý do, rồi dừng.

Nếu người dùng bảo dừng: không giao ticket mới, chờ các agent đang chạy trả kết quả rồi gộp những ticket đã xong. Báo rằng chạy lại `/phase-workflow:start-phase SLUG` sẽ tiếp tục từ chỗ dừng.

## Bước 4: Gộp một ticket (làm lần lượt từng ticket, không làm song song)

Với `WT = WT(id)`, `TB = TB(id)`:

1. `git -C WT status --porcelain` phải rỗng. Nếu còn thay đổi chưa commit, giao lại cho worker (`mode: "resume"`, ghi chú: commit hết thay đổi).
2. `git rev-list --count PB..TB` phải lớn hơn 0. Nếu bằng 0, coi như FAILED (không có thay đổi nào).
3. Rebase lên đầu nhánh phase: `git -C WT rebase PB`.
   - Nếu xung đột: `git -C WT rebase --abort`, rồi giao lại cho worker với `mode: "conflict"`. Sau khi worker xong, làm lại Bước 4 từ đầu.
   - Nếu rebase có làm thay đổi lịch sử (tức `PB` đã tiến lên kể từ lúc ticket bắt đầu): chạy lại các lệnh trong mục "Kiểm tra" của ticket bên trong `WT`. Nếu không qua, giao lại với `mode: "fix"`.
4. Nếu `runtime.json` có `clarifications` cho ticket này, thêm mục `## Làm rõ thêm` (liệt kê từng dòng) vào cuối file ticket **trong WT**, rồi `git -C WT add` file đó.
5. Gộp thành một commit:
   - `git -C WT reset --soft PB`
   - Viết message ra một file tạm **bằng đường dẫn tuyệt đối**, nằm ngoài WT (ví dụ trong thư mục scratchpad). Đường dẫn tương đối sẽ được tính từ WT, không phải từ thư mục hiện tại. Rồi `git -C WT commit -F <đường dẫn tuyệt đối>`. Nếu commit thất bại, dừng lại, sửa nguyên nhân rồi commit lại. Không đi tiếp khi chưa có commit. Message có dạng:

     ```
     <type>(<scope>): <title>

     <tóm tắt 1-3 dòng lấy từ SUMMARY của worker>

     Ticket: SLUG/<id>
     <các dòng attribution mà phiên này quy định, nếu có>
     ```

     `type`, `scope`, `title` lấy từ `tickets.json`. Trailer `Ticket:` phải nằm trong khối trailer cuối message, vì `SCRIPT` dựa vào nó để biết ticket đã xong.
6. Ở checkout chính (đang ở `PB`): `git merge --ff-only TB`.
7. **Kiểm tra trước khi dọn dẹp.** Cả hai điều kiện phải đúng, nếu không thì dừng, không xoá gì, báo người dùng:
   - `git rev-parse PB` bằng `git rev-parse TB`;
   - `git log -1 --format=%B PB` có dòng `Ticket: SLUG/<id>`.
8. Dọn dẹp: `git worktree remove --force WT`, `git branch -D TB`, và xoá mục của ticket trong `runtime.json`.
9. Báo người dùng một dòng: `✓ <id> <title> (<commit ngắn>), còn <n> ticket`.

## Bước 5: Kết thúc phase

1. Chạy các lệnh trong mục "Kiểm tra cuối phase" của `PDIR/PHASE.md` ở checkout chính.
2. Nếu có lỗi, sửa trong một ticket mới:
   - thêm ticket `TFIX<n>` vào `tickets.json` và tạo file ticket mô tả lỗi;
   - commit `chore(phase): add TFIX<n> to SLUG`;
   - quay lại Bước 3.
3. Báo người dùng:
   - danh sách commit: `git log --oneline <base_branch>..PB`;
   - kết quả kiểm tra cuối phase;
   - các quyết định quan trọng đã chốt thêm trong lúc làm.
4. Hỏi người dùng bước tiếp theo (mở PR, merge vào `base_branch`, hay để nguyên). Chỉ làm khi người dùng đồng ý.

## Mẫu prompt cho ticket-worker

```
Phase: SLUG
Ticket: <id>: <title>
Mode: new | resume | fix | conflict
Worktree (chỉ làm việc trong thư mục này): <WT(id), đường dẫn tuyệt đối>
Nhánh ticket: <TB(id)>
Nhánh phase: PB
File phase: <WT>/.claude/phases/SLUG/PHASE.md
File ticket: <WT>/.claude/phases/SLUG/<file>

Làm rõ thêm từ người dùng (bắt buộc tuân theo):
- <từng dòng clarifications, hoặc "không có">

Ghi chú của người điều phối:
<với fix: nội dung lỗi; với conflict: "rebase TB lên PB, giải quyết xung đột,
chạy lại kiểm tra"; với resume: "công việc có thể đã làm dở, xem git log và
git diff trong worktree trước khi tiếp tục">
```
