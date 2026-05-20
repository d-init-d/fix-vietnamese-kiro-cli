# Changelog

## [1.0.0] - 2026-05-20

### Phiên bản đầu tiên

- Patch fix lỗi mất chữ khi gõ tiếng Việt trong Kiro CLI TUI mode.
- Hỗ trợ Unikey, EVKey, OpenKey với kiểu gõ Telex.
- Auto-detect path tui.js trên Windows / macOS / Linux.
- Tự động backup tui.js → tui.js.bak trước khi patch.
- Idempotent: chạy nhiều lần không gây hại.
- Lệnh `--restore` để rollback nhanh.

### Test compatibility

- Kiro CLI v2.3.0
- Windows 11
- Unikey 4.x, EVKey 4.x

### Kỹ thuật

- Inject IIFE sau pragma `// @bun` ở đầu `tui.js`.
- Hook `process.stdin.on('data', ...)` để coalesce events trong window 5ms.
- IME composition events arrive atomically → loại bỏ race condition của React state.
