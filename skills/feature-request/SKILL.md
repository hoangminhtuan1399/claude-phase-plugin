---
name: feature-request
description: Phân tích một yêu cầu tính năng, hỏi người dùng mọi điểm chưa rõ (không đoán, không tự quyết), rồi lập một phase gồm các ticket trong .claude/phases/<slug>/. Chỉ chạy khi người dùng gọi /phase-workflow:feature-request kèm mô tả yêu cầu.
argument-hint: <mô tả yêu cầu>
disable-model-invocation: true
model: opus
---

# feature-request

Yêu cầu của người dùng:

> $ARGUMENTS

Nhiệm vụ: biến yêu cầu trên thành một **phase** gồm các ticket rõ ràng, đủ để subagent làm mà không phải đoán. Skill này **chỉ lập kế hoạch**: không sửa code, không tạo nhánh, không commit.

Giao tiếp với người dùng bằng ngôn ngữ họ dùng (mặc định tiếng Việt).

## Nguyên tắc bắt buộc

- **Không đoán mò, không tự quyết.** Mọi điểm ảnh hưởng tới hành vi, phạm vi, giao diện, dữ liệu, API, quyền, migration, cấu hình hay tương thích ngược đều phải được người dùng xác nhận. Nếu bạn định viết "giả sử…" hoặc "có lẽ…", hãy biến nó thành câu hỏi.
- **Sự thật thì tự tra, quyết định thì hỏi.** Câu nào trả lời được bằng cách đọc code (file nào, hàm nào có sẵn, quy ước đặt tên, lệnh test…) thì tự tìm, không hỏi người dùng. Chỉ hỏi những gì là lựa chọn của họ.
- Nếu yêu cầu trống (`$ARGUMENTS` rỗng), hỏi người dùng muốn làm gì rồi mới bắt đầu.

## Bước 1: Hiểu codebase

1. Đọc `CLAUDE.md` (nếu có) để biết kiến trúc, lệnh build/lint/test và quy ước.
2. Tìm những phần code mà yêu cầu sẽ chạm tới. Khi cần quét rộng, dùng subagent `Explore` (chạy song song nhiều agent nếu có nhiều khu vực), rồi đọc trực tiếp các file quan trọng nhất.
3. Ghi nhận: module bị ảnh hưởng, các file dùng chung dễ xung đột (registry, index, file i18n, migration, `package.json`, lockfile…), cách test hiện có, và các chức năng tương tự có thể làm mẫu.

## Bước 2: Làm rõ yêu cầu (lặp đến khi hết câu hỏi)

1. Lập danh sách các điểm chưa rõ, xếp theo mức ảnh hưởng.
2. Hỏi bằng `AskUserQuestion` (tối đa 4 câu mỗi lượt). Phương án trả lời phải dựa trên những gì bạn thấy trong code. Đặt phương án bạn khuyên lên đầu, gắn "(Recommended)" và nói ngắn gọn vì sao. Câu hỏi mở (cần người dùng tự mô tả) thì hỏi bằng văn bản.
3. Sau mỗi lượt trả lời, cập nhật danh sách: câu trả lời mới có thể mở ra câu hỏi mới. Ghi lại từng quyết định (câu hỏi → câu trả lời).
4. Chỉ dừng khi **không còn điểm chưa rõ nào**. Trước khi dừng, liệt kê ngắn các giả định còn lại (nếu có) và xin người dùng xác nhận.

## Bước 3: Chia ticket

Quy tắc chia:

- Mỗi ticket là **một thay đổi trọn vẹn, tự kiểm tra được**: code + test của phần đó nằm chung một ticket. Mỗi ticket thành đúng 1 commit.
- Chia theo ranh giới module để **tối đa hoá số ticket chạy song song được**. Chỉ đặt `depends_on` khi ticket thật sự cần code của ticket khác.
- `touches` liệt kê **chính xác** các file/thư mục ticket sẽ sửa, viết dưới dạng đường dẫn tương đối từ gốc repo. Hai ticket có `touches` giao nhau sẽ không chạy cùng lúc, nên bắt buộc phải ghi cả các file dùng chung (registry migration, file i18n, file khai báo dependency, lockfile…).
- Ticket phải đủ chi tiết để subagent làm mà không phải hỏi: bối cảnh, việc cần làm, file/hàm liên quan, tiêu chí hoàn thành, lệnh kiểm tra cụ thể.
- Id dạng `T01`, `T02`… Phase slug là kebab-case ngắn gọn (ví dụ `document-requests`). Không được trùng thư mục trong `.claude/phases/` hay nhánh `phase/<slug>` đã có (kiểm tra bằng `git branch --list 'phase/*'`).

## Bước 4: Trình bày và xin duyệt

Trình bày cho người dùng:

- Tên phase (slug) và tóm tắt mục tiêu.
- Bảng ticket: id, tiêu đề, phụ thuộc, `touches`.
- Các đợt có thể chạy song song (ví dụ: đợt 1: T01, T02, T03; đợt 2: T04).

Rồi hỏi bằng `AskUserQuestion`: duyệt, hay cần sửa gì. Nếu người dùng muốn sửa, chỉnh lại rồi trình bày lại. Chưa duyệt thì chưa ghi file.

## Bước 5: Ghi file

Trước tiên, kiểm tra repo đã sẵn sàng cho quy trình phase chưa:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs" --check-setup
```

Nếu lệnh báo thiếu gì trong `.gitignore`, cho người dùng xem các dòng nó đề xuất và hỏi bằng `AskUserQuestion` có thêm vào `.gitignore` không. Chỉ sửa `.gitignore` khi người dùng đồng ý. Nếu người dùng không đồng ý, vẫn ghi kế hoạch nhưng nhắc rằng `start-phase` sẽ không chạy được cho tới khi sửa.

Rồi tạo thư mục `.claude/phases/<slug>/` ở gốc repo, gồm:

### `tickets.json`

```json
{
  "phase": "<slug>",
  "title": "<tiêu đề ngắn>",
  "base_branch": "<nhánh hiện tại: git branch --show-current>",
  "max_parallel": 3,
  "created_at": "<YYYY-MM-DD>",
  "tickets": [
    {
      "id": "T01",
      "title": "<tiêu đề, dùng làm mô tả commit>",
      "type": "feat",
      "scope": "<scope cho Conventional Commits, ví dụ documents>",
      "depends_on": [],
      "touches": ["src/modules/documents/"],
      "file": "tickets/T01-<slug-ngan>.md"
    }
  ]
}
```

`type` là một loại của Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`…).

### `PHASE.md`

```markdown
# <Tiêu đề phase>

- Slug: `<slug>`
- Nhánh gốc: `<base_branch>`
- Ngày tạo: <YYYY-MM-DD>

## Yêu cầu gốc

<nguyên văn yêu cầu của người dùng>

## Mục tiêu

## Phạm vi

## Ngoài phạm vi

## Quyết định đã chốt

- **<câu hỏi>** → <câu trả lời của người dùng>

## Tiêu chí hoàn thành của phase

## Môi trường

<Các lệnh chuẩn bị cho một git worktree mới (worktree chưa có dependency).
Lấy từ CLAUDE.md, README hoặc cấu hình CI, ví dụ: `pnpm install --frozen-lockfile --prefer-offline`, `npm ci`, `uv sync`.
Ghi "không cần" nếu worktree mới chạy được ngay.>

## Kiểm tra cuối phase

<Các lệnh chạy trên nhánh phase khi mọi ticket đã xong (lint, typecheck, toàn bộ test), lấy từ CLAUDE.md hoặc CI.>
```

### `tickets/<id>-<slug-ngan>.md` (một file cho mỗi ticket)

```markdown
# T01: <tiêu đề>

- Loại: feat(<scope>)
- Phụ thuộc: không có | T0x
- Chạm tới: <touches>

## Bối cảnh

<Vì sao cần ticket này, liên quan tới phần nào của phase.>

## Việc cần làm

<Các bước cụ thể, kèm file/hàm/mẫu có sẵn để tham khảo.>

## Tiêu chí hoàn thành

- [ ] ...

## Kiểm tra

<Lệnh cụ thể, chỉ chạy phần liên quan tới ticket, ví dụ: test của module bị sửa, typecheck của package chứa nó.>

## Ngoài phạm vi

<Những gì ticket này không làm (thường là phần của ticket khác).>

## Quyết định liên quan

<Trích các quyết định đã chốt áp dụng cho ticket này.>
```

Sau khi ghi xong, chạy kiểm tra:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs" <slug>
```

Lệnh này phải chạy được và không có cảnh báo (ví dụ phụ thuộc vào ticket không tồn tại).

## Kết thúc

Không commit, không tạo nhánh. Báo người dùng:

- Phase `<slug>` đã sẵn sàng, gồm bao nhiêu ticket và bao nhiêu đợt song song.
- Chạy `/phase-workflow:start-phase <slug>` để bắt đầu. Lệnh này tạo nhánh `phase/<slug>` từ `<base_branch>` và commit kế hoạch làm commit đầu tiên.
