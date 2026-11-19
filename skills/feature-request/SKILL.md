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

Nhiệm vụ: biến yêu cầu trên thành một **phase** gồm các ticket rõ ràng, đủ để subagent làm mà không phải đoán. Bạn đóng hai vai liền nhau: **PM** (làm rõ nghiệp vụ, viết test case) rồi **Techlead** (chia ticket). Skill này **chỉ lập kế hoạch**: không sửa code, không tạo nhánh, không commit.

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

## Bước 3: Viết test case (vai PM)

Từ yêu cầu đã làm rõ, viết danh sách test case. Đây là hợp đồng nghiệm thu của phase: worker dùng nó để biết phải làm gì, reviewer dùng nó để biết phải kiểm tra gì, QA dùng nó để chạy lại.

Mỗi test case gồm:

- `TC01`, `TC02`…: id.
- Tên ngắn, tiền điều kiện, các bước, kết quả mong đợi (cụ thể, kiểm tra được; không viết "hoạt động tốt").
- **Loại**:
  - `auto`: kiểm tra được bằng lệnh hoặc test tự động (unit, integration, e2e chạy bằng lệnh). Ưu tiên loại này.
  - `ui`: cần thao tác hoặc nhìn giao diện, QA thực hiện và chụp bằng chứng.
  - `manual`: chỉ người dùng kiểm tra được (thiết bị thật, dịch vụ ngoài…).
- **Ticket phụ trách**: điền sau khi chia ticket ở Bước 4 (case `auto` mức unit/integration thuộc ticket sinh ra code đó; case xuyên suốt nhiều ticket thuộc QA của phase).

Phủ cả luồng chính, các trường hợp biên, luồng lỗi và quyền truy cập. Nếu viết một kết quả mong đợi mà bạn không chắc, đó là một điểm chưa rõ: quay lại Bước 2 và hỏi.

## Bước 4: Chia ticket (vai Techlead)

Quy tắc chia:

- Mỗi ticket là **một thay đổi trọn vẹn, tự kiểm tra được**: code + test của phần đó nằm chung một ticket. Mỗi ticket thành đúng 1 commit.
- Chia theo ranh giới module để **tối đa hoá số ticket chạy song song được**. Chỉ đặt `depends_on` khi ticket thật sự cần code của ticket khác.
- `touches` liệt kê **chính xác** các file/thư mục ticket sẽ sửa, viết dưới dạng đường dẫn tương đối từ gốc repo. Hai ticket có `touches` giao nhau sẽ không chạy cùng lúc, nên bắt buộc phải ghi cả các file dùng chung (registry migration, file i18n, file khai báo dependency, lockfile…).
- Ticket phải đủ chi tiết để subagent làm mà không phải hỏi: bối cảnh, việc cần làm, file/hàm liên quan, tiêu chí hoàn thành, test case, lệnh kiểm tra cụ thể.
- Gắn **`complexity`** cho từng ticket:
  - `simple`: thay đổi cơ học, không cần quyết định thiết kế: đổi text hoặc cấu hình, thêm một field theo mẫu có sẵn, đổi tên, cập nhật docs, thêm test cho code đã có. Chạm tối đa khoảng 3 file và không thêm nhánh logic mới. Ticket `simple` được giao cho model rẻ hơn và **bỏ qua bước review**, nên chỉ dùng khi chắc chắn.
  - `normal` (mặc định): mọi trường hợp còn lại, kể cả khi chạm tới quyền, dữ liệu, tiền, bảo mật hay API công khai.
- Test case loại `auto` mức e2e xuyên nhiều ticket: thêm một ticket cuối phase (`depends_on` là các ticket liên quan) viết test e2e cho chúng, để QA chỉ phải chạy lại chứ không phải viết.
- Điền cột "Ticket phụ trách" cho từng test case ở Bước 3.
- Id dạng `T01`, `T02`… Phase slug là kebab-case ngắn gọn (ví dụ `document-requests`). Không được trùng thư mục trong `.claude/phases/` hay nhánh `phase/<slug>` đã có (kiểm tra bằng `git branch --list 'phase/*'`).

## Bước 5: Trình bày và xin duyệt

Trước khi trình bày, kiểm tra chồng chéo với các phase khác đang chạy (gộp mọi `touches` của kế hoạch, cách nhau bằng dấu phẩy):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs" --overlaps --touches "<touches 1>,<touches 2>,..."
```

Trình bày cho người dùng:

- Tên phase (slug) và tóm tắt mục tiêu.
- Bảng ticket: id, tiêu đề, `complexity`, phụ thuộc, `touches`.
- Danh sách test case (id, tên, loại, ticket phụ trách).
- Các đợt có thể chạy song song (ví dụ: đợt 1: T01, T02, T03; đợt 2: T04).
- Kết quả kiểm tra chồng chéo: phase nào chạm cùng file (nếu có) và các điểm nóng (lockfile, migration, i18n) cùng cách xử lý script đề xuất. Nếu có chồng chéo, nêu hai hướng: tách phần dùng chung thành ticket merge trước, hoặc merge hai phase lần lượt.

Rồi hỏi bằng `AskUserQuestion`: duyệt, hay cần sửa gì (kể cả test case và `complexity`). Nếu người dùng muốn sửa, chỉnh lại rồi trình bày lại. Chưa duyệt thì chưa ghi file.

## Bước 6: Ghi file

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
      "complexity": "normal",
      "depends_on": [],
      "touches": ["src/modules/documents/"],
      "file": "tickets/T01-<slug-ngan>.md"
    }
  ]
}
```

`type` là một loại của Conventional Commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`…). `complexity` là `simple` hoặc `normal` (thiếu thì coi là `normal`).

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

## Test case

### TC01: <tên>

- Loại: auto | ui | manual
- Ticket phụ trách: T0x | phase (QA cuối phase)
- Tiền điều kiện: ...
- Các bước: ...
- Kết quả mong đợi: ...
- Lệnh chạy (chỉ loại auto): `...`

## Môi trường

<Các lệnh chuẩn bị cho một git worktree mới (worktree chưa có dependency).
Lấy từ CLAUDE.md, README hoặc cấu hình CI, ví dụ: `pnpm install --frozen-lockfile --prefer-offline`, `npm ci`, `uv sync`.
Ghi "không cần" nếu worktree mới chạy được ngay.>

## Kiểm tra cuối phase

<Các lệnh chạy trên nhánh phase khi mọi ticket đã xong (lint, typecheck, toàn bộ test, và bộ e2e nếu chạy được bằng lệnh), lấy từ CLAUDE.md hoặc CI. Bộ lệnh này cũng được chạy lại ngay trước khi merge vào nhánh gốc, nên phải đủ để phát hiện xung đột ngầm với code của các phase khác.>
```

### `tickets/<id>-<slug-ngan>.md` (một file cho mỗi ticket)

```markdown
# T01: <tiêu đề>

- Loại: feat(<scope>)
- Độ phức tạp: simple | normal
- Phụ thuộc: không có | T0x
- Chạm tới: <touches>

## Bối cảnh

<Vì sao cần ticket này, liên quan tới phần nào của phase.>

## Việc cần làm

<Các bước cụ thể, kèm file/hàm/mẫu có sẵn để tham khảo.>

## Tiêu chí hoàn thành

- [ ] ...

## Test case của ticket

<Chép đầy đủ (không chỉ id) các test case thuộc ticket này. Worker phải viết test tự động cho các case loại `auto`; reviewer đối chiếu theo danh sách này.>

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
- Chạy `/phase-workflow:start-phase <slug>` để bắt đầu. Lệnh này tạo nhánh `phase/<slug>` từ `<base_branch>` trong một worktree riêng (checkout chính của bạn không bị đụng tới) và commit kế hoạch làm commit đầu tiên. Nhiều phase có thể chạy cùng lúc ở nhiều phiên.
- Khi phase xong và bạn đã duyệt, chạy `/phase-workflow:merge-phase <slug>` để đưa vào `<base_branch>`.
- Nếu bước kiểm tra chồng chéo có cảnh báo, nhắc lại ở đây.
