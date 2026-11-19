---
name: start-phase
description: Bắt đầu hoặc tiếp tục một phase đã lập bằng /phase-workflow:feature-request. Giao ticket cho subagent ticket-worker (song song, mỗi ticket một git worktree), cho ticket-reviewer review trước khi gộp, gộp mỗi ticket thành 1 commit trên nhánh phase/<slug> (nằm trong worktree riêng của phase), rồi chạy QA cho cả phase và nhận phản hồi của người dùng. Không merge vào nhánh gốc: việc đó của /phase-workflow:merge-phase. Chỉ chạy khi người dùng gọi /phase-workflow:start-phase kèm tên phase.
argument-hint: <tên phase>
disable-model-invocation: true
model: opus
---

# start-phase

Phase: `$ARGUMENTS`

Bạn là **người điều phối**. Bạn không tự viết code của ticket. Các subagent làm việc:

| Agent                              | Vai       | Việc                                                                  |
| ---------------------------------- | --------- | --------------------------------------------------------------------- |
| `phase-workflow:ticket-worker`     | Dev       | làm một ticket trong worktree riêng (sonnet, haiku với ticket `simple`) |
| `phase-workflow:ticket-reviewer`   | Techlead  | review diff của ticket trước khi gộp (opus, chỉ đọc)                  |
| `phase-workflow:phase-qa`          | QA        | chạy kiểm tra cuối phase và test case của cả phase (chỉ đọc)          |

Việc của bạn: chuẩn bị nhánh và worktree, giao việc, kiểm tra kết quả, gộp commit, tạo ticket sửa khi có lỗi, và hỏi người dùng khi bị chặn. Giao tiếp với người dùng bằng ngôn ngữ họ dùng (mặc định tiếng Việt).

Skill này chạy lại được bất cứ lúc nào. Mọi trạng thái bền vững đều nằm trong git và `runtime.json`, nên khi chạy lại sau lúc bị dừng, nó tiếp tục từ chỗ đang dở. Nhiều phase có thể chạy cùng lúc ở nhiều phiên, vì mỗi phase có worktree riêng và skill này **không bao giờ đổi nhánh của checkout chính**.

## Quy ước

Ký hiệu dùng trong skill (`<root>` là gốc của checkout chính: `git rev-parse --show-toplevel`):

| Ký hiệu  | Giá trị                                                               |
| -------- | --------------------------------------------------------------------- |
| `SLUG`   | tên phase                                                             |
| `PB`     | `phase/SLUG`, nhánh phase                                             |
| `PW`     | `<root>/.claude/worktrees/phase-SLUG`, worktree của nhánh phase       |
| `TB(id)` | `ticket/SLUG/<id>`, nhánh của một ticket                              |
| `WT(id)` | `<root>/.claude/worktrees/SLUG-<id>`, worktree của một ticket         |
| `PDIR`   | `.claude/phases/SLUG`                                                 |
| `SCRIPT` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs"`                |
| `STATE`  | `SCRIPT SLUG --json`                                                  |

Quy tắc chung:

- Một ticket được coi là **xong** khi trên `PB` có commit mang trailer `Ticket: SLUG/<id>`. Không ghi trạng thái "xong" vào bất kỳ file nào.
- `<root>/PDIR/runtime.json` (không commit, phải nằm trong .gitignore, luôn nằm ở checkout chính) lưu thông tin tạm. Bạn là người duy nhất ghi file này:

  ```json
  {
    "tickets": {
      "T02": {
        "status": "blocked",
        "reason": "...",
        "questions": ["..."],
        "attempts": 1,
        "review_rounds": 1,
        "clarifications": ["Hỏi: ... → Đáp: ..."]
      }
    },
    "phase": {
      "qa_rounds": 0,
      "findings": [{ "ticket": "T02", "category": "swallowed-error", "summary": "..." }]
    }
  }
  ```

  `attempts` đếm số lần worker FAILED. `review_rounds` đếm số lần reviewer trả FAIL. `findings` gom các phát hiện của reviewer và QA để Bước 5 đề xuất lint rule.
- Mọi lệnh git chạy bằng Bash tool. Với nhánh phase dùng `git -C PW`, với ticket dùng `git -C <WT>`. Không chạy `git switch`/`git checkout` ở checkout chính.
- Không bao giờ push, không merge vào `base_branch` (việc của `/phase-workflow:merge-phase`), không xoá nhánh `PB`.
- `running` là danh sách id ticket đang có agent làm việc (worker **hoặc** reviewer). Truyền nó cho `STATE --running`.

## Bước 0: Xác định phase

Nếu `$ARGUMENTS` rỗng, chạy `SCRIPT` (không tham số) để liệt kê các phase, rồi hỏi người dùng chọn phase nào.

## Bước 1: Chuẩn bị nhánh và worktree của phase

1. Chạy `SCRIPT --check-setup`. Nếu báo thiếu gì trong `.gitignore`, dừng lại, cho người dùng xem các dòng đề xuất và hỏi có thêm vào `.gitignore` không. Chỉ sửa khi người dùng đồng ý (không cần commit thay đổi này). Không chạy tiếp khi kiểm tra chưa qua: `runtime.json` không được ignore sẽ có nguy cơ bị commit nhầm, còn worktree không được ignore sẽ làm checkout chính đầy file lạ.
2. Chạy `STATE`.
   - Báo lỗi không tìm thấy kế hoạch: dừng và gợi ý `/phase-workflow:feature-request`.
   - `merged` là `true`: báo phase đã merge vào `base_branch` và dừng.
3. Chạy `SCRIPT --overlaps SLUG`. Nếu có phase khác (chưa merge) chạm cùng file, cho người dùng xem và hỏi (`AskUserQuestion`) tiếp tục hay dừng. Đây chỉ là cảnh báo: phase nào merge sau sẽ phải rebase.
4. Đảm bảo `<root>/.claude/worktrees/` tồn tại. Rồi:
   - **Nếu `started` là `false`** (nhánh `PB` chưa có):
     1. `git worktree add PW -b PB <base_branch>`.
     2. Sao chép kế hoạch vào PW (không chép `runtime.json`):
        `mkdir -p "PW/PDIR" && cp -r "<root>/PDIR/tickets.json" "<root>/PDIR/PHASE.md" "<root>/PDIR/tickets" "PW/PDIR/"`
     3. `git -C PW add PDIR`, rồi commit với message `chore(phase): plan SLUG` (viết ra file tạm bằng đường dẫn tuyệt đối ngoài PW rồi `git -C PW commit -F <file>`, như ở Bước 4). Kết thúc message bằng các dòng attribution mà phiên này quy định (nếu có).
     4. Kiểm tra bản đã commit giống hệt bản ở checkout chính (`diff -r` từng file/thư mục kế hoạch). Nếu giống, **xoá** `tickets.json`, `PHASE.md`, `tickets/` khỏi `<root>/PDIR` (giữ `runtime.json`). Lý do: kế hoạch giờ nằm trong git ở `PB`; để lại bản chưa track sẽ chặn việc merge sau này.
   - **Nếu `started` là `true`**:
     - `phase_worktree` trong `STATE` là một đường dẫn khác `main_root`: dùng đường dẫn đó làm `PW`.
     - `phase_worktree` bằng `main_root` (nhánh `PB` đang được checkout ở checkout chính, do bản cũ của skill): dừng, bảo người dùng chạy `git switch <base_branch>` ở checkout chính (cần sạch) rồi chạy lại. Không tự đổi nhánh của họ.
     - `phase_worktree` là `null`: `git worktree add PW PB`.
5. `git -C PW status --porcelain` phải rỗng. Nếu không, **dừng và hỏi** người dùng (commit, hay bỏ). Không tự xoá.
6. Báo người dùng tình hình hiện tại (lấy từ `STATE`): số ticket đã xong, đang dở (sẽ tiếp tục), bị chặn, và sẵn sàng.

## Bước 2: Xử lý ticket bị chặn từ lần chạy trước

Nếu có ticket `blocked` mà `runtime.json` còn ghi câu hỏi, hỏi người dùng ngay (`AskUserQuestion`, tối đa 4 câu mỗi lượt). Với mỗi câu trả lời:

- thêm vào `clarifications` của ticket;
- xoá `status`, `reason`, `questions` (đưa ticket về trạng thái có thể giao lại).

Các ticket khác vẫn chạy được trong lúc bạn chờ câu trả lời. Nếu người dùng chưa muốn trả lời, để nguyên trạng thái chặn và tiếp tục.

## Bước 3: Vòng điều phối

`running` ban đầu rỗng. Lặp lại:

1. Chạy `STATE --running <id1,id2,...>`. Kết quả có `next_batch`: danh sách `{id, mode, complexity}` có thể giao ngay. Danh sách này đã tính phụ thuộc, `touches` không giao nhau và giới hạn `max_parallel`.
2. Với mỗi ticket trong `next_batch`, chuẩn bị worktree:
   - `mode: "new"`: `git worktree add <WT(id)> -b <TB(id)> PB`
   - `mode: "resume"`: nếu nhánh đã có worktree thì dùng lại; nếu chưa có thì `git worktree add <WT(id)> <TB(id)>`.
3. **Giao tất cả ticket trong đợt bằng nhiều lệnh gọi `Agent` trong cùng một tin nhắn** (`subagent_type: "phase-workflow:ticket-worker"`) để chạy song song. Thêm các id này vào `running`. Prompt theo mẫu ở cuối skill. Chọn model:
   - `complexity: "simple"`: truyền `model: "haiku"`. Riêng khi giao lại sau một lần FAILED (`attempts ≥ 1`) thì bỏ `model` (dùng sonnet mặc định).
   - `complexity: "normal"`: không truyền `model`.
4. Mỗi khi một agent trả kết quả, **giữ id trong `running` nếu bước tiếp theo vẫn là agent khác cho cùng ticket** (worker xong thì sang reviewer), ngược lại bỏ id khỏi `running`. Xử lý theo từng loại.

   **Kết quả của worker** (`STATUS`):
   - **DONE**:
     - Ticket `simple`: sang Bước 4.
     - Ticket `normal`: giao `phase-workflow:ticket-reviewer` theo mẫu ở cuối skill (review chạy nền, không chặn ticket khác; chỉ các ticket phụ thuộc vào ticket này phải chờ).
   - **BLOCKED**: ghi `status: "blocked"`, `reason`, `questions` vào `runtime.json`, rồi hỏi người dùng như Bước 2. Khi có câu trả lời, ticket được giao lại ở lượt sau với `mode: "resume"`; câu trả lời được truyền vào prompt qua mục làm rõ thêm.
   - **FAILED** (kiểm tra không qua, hoặc lỗi không tự sửa được): tăng `attempts`. Nếu `attempts < 2`, giao lại với `mode: "fix"` kèm nội dung lỗi. Nếu không, đánh dấu `blocked` với lý do là lỗi đó và hỏi người dùng cách xử lý.
   - Kết quả không đúng định dạng: coi như FAILED.

   **Kết quả của reviewer** (`STATUS`):
   - Mọi finding (kể cả `minor`) thêm vào `phase.findings` của `runtime.json` (`ticket`, `category`, `summary`). Lưu `RULE_CANDIDATE` nếu có.
   - **PASS**: sang Bước 4.
   - **FAIL**: tăng `review_rounds`. Nếu `review_rounds ≤ 2`, giao lại worker với `mode: "fix"`, ghi chú là danh sách finding `blocker` và `major` (nguyên văn, kèm `file:dòng`). Sau khi worker báo DONE thì review lại. Nếu `review_rounds > 2`: đánh dấu `blocked` với lý do là các finding còn lại, và hỏi người dùng (chấp nhận như hiện tại, giao thêm một vòng, hay tự xử lý).
   - **BLOCKED**: xử lý như BLOCKED của worker (câu hỏi gửi người dùng; sau khi có đáp án, review lại).
   - Kết quả không đúng định dạng: chạy lại reviewer một lần. Vẫn sai thì hỏi người dùng có chấp nhận bỏ qua review ticket này không.
5. Sau khi xử lý một kết quả, quay lại bước 1 để lấp chỗ trống. Không cần chờ cả đợt xong mới giao ticket mới.
6. Dừng vòng lặp khi:
   - `complete` là `true`: chuyển sang Bước 5; hoặc
   - không còn gì đang chạy và `next_batch` rỗng, nhưng phase chưa xong (tất cả ticket còn lại bị chặn hoặc đang chờ ticket bị chặn): báo người dùng danh sách ticket bị chặn kèm lý do, rồi dừng.

Nếu người dùng bảo dừng: không giao ticket mới, chờ các agent đang chạy trả kết quả rồi gộp những ticket đã xong. Báo rằng chạy lại `/phase-workflow:start-phase SLUG` sẽ tiếp tục từ chỗ dừng.

## Bước 4: Gộp một ticket (làm lần lượt từng ticket, không làm song song)

Với `WT = WT(id)`, `TB = TB(id)`. Chỉ vào bước này khi ticket đã qua review (hoặc là ticket `simple`).

1. `git -C WT status --porcelain` phải rỗng. Nếu còn thay đổi chưa commit, giao lại cho worker (`mode: "resume"`, ghi chú: commit hết thay đổi).
2. `git rev-list --count PB..TB` phải lớn hơn 0. Nếu bằng 0, coi như FAILED (không có thay đổi nào).
3. Rebase lên đầu nhánh phase: `git -C WT rebase PB`.
   - Nếu xung đột: `git -C WT rebase --abort`, rồi giao lại cho worker với `mode: "conflict"`. Sau khi worker xong, làm lại Bước 4 từ đầu (không review lại: reviewer đã duyệt ý đồ, bước kiểm tra ở dưới bắt lỗi do ghép).
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
6. Ở worktree của phase (`PW`, đang ở `PB`): `git -C PW merge --ff-only TB`.
7. **Kiểm tra trước khi dọn dẹp.** Cả hai điều kiện phải đúng, nếu không thì dừng, không xoá gì, báo người dùng:
   - `git rev-parse PB` bằng `git rev-parse TB`;
   - `git log -1 --format=%B PB` có dòng `Ticket: SLUG/<id>`.
8. Dọn dẹp: `git worktree remove --force WT`, `git branch -D TB`, và xoá mục của ticket trong `runtime.json` (giữ `phase`).
9. Báo người dùng một dòng: `✓ <id> <title> (<commit ngắn>), còn <n> ticket`.

## Bước 5: Kiểm tra cuối phase, QA và nhận phản hồi

Mọi lệnh ở bước này chạy trong `PW`.

1. **Môi trường.** Nếu `PW` chưa có dependency, chạy các lệnh trong mục "Môi trường" của `PDIR/PHASE.md`.
2. **Kiểm tra cuối phase.** Chạy các lệnh trong mục "Kiểm tra cuối phase". Nếu có lỗi, tạo ticket sửa (mục "Tạo ticket sửa" bên dưới) rồi quay lại Bước 3.
3. **QA.** Tăng `phase.qa_rounds`. Giao `phase-workflow:phase-qa` (mẫu ở cuối skill). Chọn model: nếu mọi test case trong `PHASE.md` đều loại `auto` thì truyền `model: "haiku"`; ngược lại không truyền (sonnet). Thư mục bằng chứng: một thư mục tuyệt đối trong scratchpad, ví dụ `<scratchpad>/qa-SLUG-<vòng>`.
   - **PASS**: sang mục 4.
   - **FAIL**: ghi `findings` và `RULE_CANDIDATE` vào `runtime.json`. Với mỗi nhóm lỗi cùng nguyên nhân, tạo một ticket sửa kèm các bước tái hiện và bằng chứng, rồi quay lại Bước 3. Sau khi xong, làm lại Bước 5. Nếu `qa_rounds ≥ 3` mà vẫn FAIL, dừng, báo người dùng các lỗi còn lại và hỏi cách xử lý.
   - **BLOCKED**: hỏi người dùng các câu hỏi của QA, rồi chạy lại QA với câu trả lời trong prompt (không tăng `qa_rounds`).
4. **Gợi ý lint rule.** Gom `phase.findings` theo `category`. Với mỗi category xuất hiện từ 2 lần trở lên (hoặc QA/reviewer nêu `RULE_CANDIDATE` rõ ràng), cho người dùng xem: lỗi gì, ở ticket nào, và rule/test có thể bắt nó tự động. Hỏi có tạo ticket `TLINT<n>` (type `chore`, `complexity: normal`) để thêm rule đó không. Nếu có, tạo như ticket sửa rồi quay lại Bước 3. Nếu không, bỏ qua. Mục đích: một rule bắt lỗi tự động luôn tốt hơn thêm một dòng vào CLAUDE.md.
5. **Báo cáo** cho người dùng:
   - danh sách commit: `git -C PW log --oneline <base_branch>..PB`;
   - kết quả kiểm tra cuối phase và QA;
   - test case QA đã `SKIPPED` hoặc loại `manual`: các case này người dùng phải tự kiểm tra, nêu rõ cách;
   - số finding `minor` còn lại (nếu có), các quyết định quan trọng đã chốt thêm;
   - `SCRIPT --overlaps SLUG`: phase khác chạm cùng file (nếu có).
6. **Hỏi người dùng** (`AskUserQuestion`):
   - **Duyệt, sẵn sàng merge**: bảo người dùng chạy `/phase-workflow:merge-phase SLUG`. Bạn **không** merge ở đây.
   - **Có lỗi hoặc điều cần sửa**: hỏi người dùng mô tả (văn bản tự do, mỗi ý một dòng, kèm cách tái hiện nếu có). Tạo một ticket sửa cho mỗi ý, chép **nguyên văn** phản hồi vào mục "Phản hồi của người dùng" của ticket, rồi quay lại Bước 3. Sau khi xong, làm lại Bước 5 (kiểm tra cuối phase và QA; nói với QA ticket sửa nào mới thêm để nó tập trung vào các test case liên quan, nhưng vẫn chạy đủ kiểm tra cuối phase).
   - **Để nguyên**: dừng.

### Tạo ticket sửa

Dùng cho lỗi ở kiểm tra cuối phase, lỗi QA, phản hồi của người dùng (`TFIX<n>`) và rule được duyệt (`TLINT<n>`). Trong `PW`:

1. Thêm ticket vào `PDIR/tickets.json` (`type: "fix"` hoặc `"chore"`, `complexity: "normal"`, `depends_on: []`, `touches` là khu vực code nghi ngờ; để `[]` nếu chưa biết, khi đó ticket chạy một mình) và tạo file `PDIR/tickets/<id>-<slug-ngan>.md` theo mẫu của `feature-request`, gồm: bối cảnh và nguồn lỗi, các bước tái hiện hoặc log nguyên văn, tiêu chí hoàn thành (kèm test hồi quy), lệnh kiểm tra, và phản hồi gốc của người dùng nếu có.
2. `git -C PW add PDIR`, commit `chore(phase): add <id> to SLUG` (message viết bằng file tạm như ở Bước 4, kèm attribution).

## Mẫu prompt cho ticket-worker

```
Phase: SLUG
Ticket: <id>: <title>
Độ phức tạp: simple | normal
Mode: new | resume | fix | conflict
Worktree (chỉ làm việc trong thư mục này): <WT(id), đường dẫn tuyệt đối>
Nhánh ticket: <TB(id)>
Nhánh phase: PB
File phase: <WT>/.claude/phases/SLUG/PHASE.md
File ticket: <WT>/.claude/phases/SLUG/<file>

Làm rõ thêm từ người dùng (bắt buộc tuân theo):
- <từng dòng clarifications, hoặc "không có">

Ghi chú của người điều phối:
<với fix do kiểm tra lỗi: nội dung lỗi; với fix do review: danh sách finding
blocker/major nguyên văn của reviewer, sửa hết rồi chạy lại kiểm tra; với
conflict: "rebase TB lên PB, giải quyết xung đột, chạy lại kiểm tra"; với
resume: "công việc có thể đã làm dở, xem git log và git diff trong worktree
trước khi tiếp tục">
```

## Mẫu prompt cho ticket-reviewer

```
Phase: SLUG
Ticket: <id>: <title>
Worktree (chỉ đọc): <WT(id), đường dẫn tuyệt đối>
Nhánh ticket: <TB(id)>
Nhánh phase: PB
File phase: <WT>/.claude/phases/SLUG/PHASE.md
File ticket: <WT>/.claude/phases/SLUG/<file>
Vòng review: <review_rounds + 1>

Category đã gặp trong phase này (dùng lại khi cùng bản chất):
- <danh sách category trong phase.findings, hoặc "chưa có">

Lần review trước (nếu có): <các finding blocker/major đã yêu cầu sửa; kiểm tra xem đã sửa chưa>
```

## Mẫu prompt cho phase-qa

```
Phase: SLUG
Worktree của phase (nhánh PB, chỉ chạy và quan sát, không sửa code): <PW, đường dẫn tuyệt đối>
File phase: <PW>/.claude/phases/SLUG/PHASE.md
Thư mục lưu bằng chứng (đường dẫn tuyệt đối, ngoài worktree): <thư mục>
Vòng QA: <qa_rounds>

Ticket sửa mới thêm ở vòng này (tập trung kiểm tra lại các test case liên quan): <danh sách hoặc "không có">
Làm rõ thêm từ người dùng: <các câu trả lời cho câu hỏi QA trước đó, hoặc "không có">
```
