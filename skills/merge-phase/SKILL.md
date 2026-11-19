---
name: merge-phase
description: Đưa một phase đã xong và đã được người dùng duyệt vào nhánh gốc (base_branch), qua hàng đợi merge chạy từng phase một. Rebase nhánh phase lên nhánh gốc mới nhất, chạy lại toàn bộ kiểm tra, rồi fast-forward. Nếu kiểm tra đỏ thì không merge mà tạo ticket sửa. Không push. Chỉ chạy khi người dùng gọi /phase-workflow:merge-phase kèm tên phase.
argument-hint: <tên phase>
disable-model-invocation: true
model: opus
---

# merge-phase

Phase: `$ARGUMENTS`

Bạn là **Techlead phụ trách merge**. Hai phase đều pass khi chạy riêng vẫn có thể hỏng khi ghép lại, vì nhánh gốc đã đổi sau khi phase tách ra. Skill này chạy lại kiểm tra trên đúng trạng thái sẽ được merge, từng phase một. Giao tiếp với người dùng bằng ngôn ngữ họ dùng (mặc định tiếng Việt).

Người dùng gọi lệnh này nghĩa là họ đã duyệt phase và cho phép merge vào `base_branch` **trên máy này**. Không push, không xoá nhánh `PB`, không sửa code sản phẩm ngoài việc giải xung đột rebase.

## Quy ước

`<root>` là gốc của checkout chính (`git rev-parse --show-toplevel`).

| Ký hiệu  | Giá trị                                                               |
| -------- | --------------------------------------------------------------------- |
| `SLUG`   | tên phase                                                             |
| `PB`     | `phase/SLUG`                                                          |
| `PW`     | worktree của `PB` (`phase_worktree_path` trong `STATE`)               |
| `BASE`   | `base_branch` của phase                                               |
| `BW`     | worktree đang checkout `BASE`                                         |
| `SCRIPT` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs"`                |
| `STATE`  | `SCRIPT SLUG --json`                                                  |

## Bước 1: Điều kiện

1. `$ARGUMENTS` rỗng: chạy `SCRIPT` để liệt kê, hỏi người dùng chọn phase.
2. Chạy `STATE`:
   - không tìm thấy hoặc `started` là `false`: dừng, gợi ý chạy `/phase-workflow:start-phase`;
   - `merged` là `true`: báo đã merge và dừng;
   - `complete` là `false`: dừng, báo ticket còn lại và gợi ý `/phase-workflow:start-phase SLUG`.
3. `PW`: dùng `phase_worktree` nếu khác `null` và khác `main_root`; nếu `null` thì `git worktree add PW PB`; nếu bằng `main_root` thì dừng và bảo người dùng `git switch <BASE>` ở checkout chính trước. `git -C PW status --porcelain` phải rỗng, nếu không thì dừng và hỏi.
4. Tìm `BW` bằng `git worktree list --porcelain` (worktree có `branch refs/heads/BASE`). Nếu không có worktree nào đang checkout `BASE`, dừng và hỏi người dùng muốn checkout `BASE` ở đâu. Không tự đổi nhánh của checkout chính.
5. Báo người dùng ngắn gọn: sẽ merge `PB` (n commit) vào `BASE` ở `BW`, không push.

## Bước 2: Khoá hàng đợi

Chạy `SCRIPT --lock SLUG`.

- Thành công: tiếp tục. **Từ đây, mọi đường thoát (xong, lỗi, dừng giữa chừng) đều phải chạy `SCRIPT --unlock SLUG` trước khi kết thúc.**
- Báo đang bị khoá bởi phase khác: cho người dùng xem thông tin khoá và hỏi. Chỉ dùng `--unlock <phase đó> --force` khi người dùng xác nhận phiên kia đã dừng.

## Bước 3: Rebase lên nhánh gốc mới nhất

Lặp tối đa 3 lần (vì `BASE` có thể tiến lên trong lúc chạy kiểm tra):

1. `git -C PW rebase BASE`.
2. **Xung đột**: xem từng file xung đột.
   - Lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `uv.lock`…): không giải bằng tay. Lấy bản của `BASE`, rồi sau khi rebase xong chạy lại lệnh cài đặt trong mục "Môi trường" của `PHASE.md` để sinh lại, và commit thay đổi lockfile đó vào commit đang rebase hoặc commit riêng `chore(deps): regenerate lockfile`.
   - Migration: nếu hai bên cùng thêm migration, giữ cả hai và đảm bảo thứ tự theo timestamp.
   - Danh sách, registry, router, file i18n mà hai bên cùng **thêm** dòng: giữ cả hai.
   - Xung đột nằm hoàn toàn trong file của phase này: giải quyết sao cho giữ đúng ý đồ của cả hai phía.
   - **Xung đột đụng tới logic do phase khác (code từ `BASE`) viết, hoặc cần quyết định về hành vi**: `git -C PW rebase --abort`, mở khoá, và hỏi người dùng. Không tự quyết.
   - Sau khi giải xong: `git -C PW add` các file rồi `git -C PW rebase --continue`.
3. `git -C PW status --porcelain` phải rỗng.

## Bước 4: Kiểm tra lại toàn bộ

Trong `PW`:

1. Chạy lệnh trong mục "Môi trường" của `PDIR/PHASE.md` nếu dependency chưa có hoặc lockfile đã đổi.
2. Chạy **tất cả** lệnh trong mục "Kiểm tra cuối phase". Bộ này phải gồm toàn bộ test của repo (không chỉ test của phase), để bắt xung đột ngầm với các phase đã merge trước đó. Nếu mục này chỉ có test riêng của phase, cảnh báo người dùng và chạy thêm lệnh test toàn repo lấy từ `CLAUDE.md`/CI.

**Nếu có lỗi**: không merge.

1. Mở khoá hàng đợi.
2. Tạo ticket sửa `TFIX<n>` theo mục "Tạo ticket sửa" của `/phase-workflow:start-phase`, chạy trong `PW` (mô tả lỗi nguyên văn, ghi rõ lỗi xảy ra sau khi rebase lên `BASE`, nên `touches` nên gồm cả file xung đột ngầm). Commit `chore(phase): add TFIX<n> to SLUG`.
3. Báo người dùng: lỗi gì, vì sao nghi ngờ do ghép với code mới của `BASE`, và chạy `/phase-workflow:start-phase SLUG` để sửa, sau đó chạy lại `/phase-workflow:merge-phase SLUG`. Dừng.

## Bước 5: Merge

1. Kiểm tra `BASE` chưa tiến lên: `git merge-base --is-ancestor BASE PB` phải thành công. Nếu không, quay lại Bước 3 (đếm vào giới hạn 3 lần; quá thì mở khoá và báo người dùng `BASE` đang thay đổi liên tục).
2. `git -C BW merge --ff-only PB`. Nếu thất bại (thường do file chưa commit ở `BW` bị ghi đè), mở khoá, báo nguyên văn lỗi và dừng. Không dùng `--force`, không stash hộ người dùng.
3. Kiểm tra: `git -C BW rev-parse BASE` bằng `git rev-parse PB`.

## Bước 6: Dọn dẹp và báo cáo

1. Mở khoá: `SCRIPT --unlock SLUG`.
2. Xoá worktree của phase: `git worktree remove --force PW`. **Giữ nhánh `PB`** (lịch sử và trailer `Ticket:` dựa vào nó). Xoá `<root>/.claude/phases/SLUG/runtime.json` nếu còn.
3. Chạy `SCRIPT SLUG` để xác nhận `merged`.
4. Báo người dùng:
   - đã merge `n` commit vào `BASE`: `git log --oneline` của các commit đó;
   - **chưa push**: người dùng tự push khi sẵn sàng;
   - nếu CI sau khi push đỏ, nên revert commit merge (`git revert -m` hoặc `git revert <khoảng commit>`) rồi sửa trên một phase mới, không sửa nóng trên `BASE`;
   - các phase khác đang chạy sẽ phải rebase lên `BASE` mới khi chúng merge; `SCRIPT --overlaps <slug>` cho biết phase nào có nguy cơ xung đột.
