---
name: phase-status
description: Xem tiến độ các phase lập bằng /phase-workflow:feature-request và chạy bằng /phase-workflow:start-phase. Cho biết bao nhiêu ticket đã xong, đang làm, bị chặn, sẵn sàng, đang chờ, và việc tiếp theo. Dùng khi người dùng chạy /phase-workflow:phase-status, hoặc hỏi tiến độ phase/ticket. Chỉ đọc, không thay đổi gì.
argument-hint: [tên phase]
---

# phase-status

Phase: `$ARGUMENTS` (để trống nghĩa là xem tất cả).

Skill này **chỉ đọc**: không sửa file, không chạy lệnh git làm thay đổi trạng thái, không giao việc. Nó chạy an toàn ngay cả khi `/phase-workflow:start-phase` đang chạy ở một phiên khác.

## Cách làm

1. Chạy (bằng Bash tool, từ bất kỳ đâu trong repo):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs" $ARGUMENTS
   ```

   - Không có tên phase: lệnh liệt kê mọi phase kèm số ticket đã xong.
   - Có tên phase: lệnh in bảng ticket. Thêm `--json` nếu cần chi tiết hơn (worktree, số commit, câu hỏi đang chờ).

2. Trả lời người dùng, ngắn gọn, bằng ngôn ngữ họ dùng:
   - Câu đầu: tiến độ (ví dụ "Phase `x`: 4/7 ticket xong").
   - Ticket đang làm. Nếu không có phiên `/phase-workflow:start-phase` nào đang chạy, đây là ticket bị dừng giữa chừng: `/phase-workflow:start-phase` sẽ tiếp tục chúng.
   - Ticket bị chặn: lý do và câu hỏi đang chờ người dùng trả lời.
   - Việc tiếp theo: những ticket sẵn sàng, hoặc nhắc chạy `/phase-workflow:start-phase <slug>`. Nếu phase đã xong hết, nhắc chạy `/phase-workflow:start-phase <slug>` để chạy kiểm tra cuối phase, nếu chưa chạy.
   - Phase đã xong hết ticket: nếu chưa `đã merge`, nhắc chạy `/phase-workflow:merge-phase <slug>` sau khi người dùng duyệt. Phase `đã merge` thì chỉ báo là đã vào nhánh gốc.
   - Chồng chéo giữa các phase đang chạy: `node "${CLAUDE_PLUGIN_ROOT}/scripts/phase-state.mjs" --overlaps <slug>` (chỉ khi người dùng hỏi hoặc có nhiều phase cùng chạy).
   - Cảnh báo của script (ví dụ phụ thuộc vào ticket không tồn tại), nếu có.

3. Nếu người dùng hỏi chi tiết một ticket, đọc file ticket:
   - Phase chưa bắt đầu: đọc `.claude/phases/<slug>/tickets/...` trong thư mục làm việc.
   - Phase đã bắt đầu: dùng `git show phase/<slug>:.claude/phases/<slug>/tickets/<file>`.

   Để xem commit đã gộp: `git log --oneline <base_branch>..phase/<slug>`.

## Cách tính trạng thái (để giải thích khi được hỏi)

- **xong**: trên `phase/<slug>` có commit mang trailer `Ticket: <slug>/<id>`.
- **bị chặn**: `runtime.json` ghi ticket đang chờ người dùng trả lời hoặc đã thất bại nhiều lần.
- **đang làm**: nhánh `ticket/<slug>/<id>` tồn tại.
- **sẵn sàng**: mọi ticket phụ thuộc đã xong.
- **chờ**: còn ticket phụ thuộc chưa xong.
- **đã merge**: nhánh `phase/<slug>` là tổ tiên của nhánh gốc.
- Ticket đang làm có thể đang chờ review (worker đã xong, reviewer đang đọc). Số lần reviewer trả lại hiện ở dòng chi tiết của ticket.
