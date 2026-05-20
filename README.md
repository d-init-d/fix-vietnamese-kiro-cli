<p align="center">
  <h1 align="center">🇻🇳 fix-vietnamese-kiro-cli</h1>
  <p align="center">
    <strong>Patch lỗi gõ tiếng Việt trong Kiro CLI</strong>
  </p>
  <p align="center">
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="https://github.com/d-init-d/fix-vietnamese-kiro-cli/releases"><img src="https://img.shields.io/github/v/release/d-init-d/fix-vietnamese-kiro-cli?color=green" alt="Release"></a>
    <a href="https://kiro.dev"><img src="https://img.shields.io/badge/Kiro_CLI-v2.3+-blue.svg" alt="Kiro CLI"></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20│%20macOS%20│%20Linux-lightgrey.svg" alt="Platform">
  </p>
</p>

---

Khi gõ tiếng Việt (Unikey, EVKey, OpenKey) trong Kiro CLI TUI mode, chữ bị mất dấu hoặc mất ký tự do race condition trong input pipeline. Tool này patch trực tiếp vào `tui.js` để fix.

## Cài đặt & sử dụng

```bash
git clone https://github.com/d-init-d/fix-vietnamese-kiro-cli.git
cd fix-vietnamese-kiro-cli
node patch-cli-kiro.js
```

Đóng Kiro CLI → mở terminal mới → gõ tiếng Việt bình thường. ✅

> **Cách khác:** `npx github:d-init-d/fix-vietnamese-kiro-cli`

---

## Vấn đề

Bộ gõ tiếng Việt hoạt động bằng cách gửi **backspace + text thay thế** cực nhanh (~5-20ms). Kiro CLI TUI (React/Ink) xử lý từng event async riêng lẻ → race condition:

```
Gõ "chào" (Telex): c → h → a → o → f
IME gửi: \x7F\x7F (xóa "ao") + "ào" (thay thế)
                    ↑ async gap ở đây → mất text
```

| Input | Mong đợi | Không patch |
|-------|----------|-------------|
| chào bạn | chào bạn | cha ba |
| tiếng Việt | tiếng Việt | tieeng Viet |

## Cách hoạt động

```
stdin events ──▶ Buffer (30ms) ──▶ Flush đồng bộ ──▶ Kiro TUI
                 gom tất cả         split logic:        nhận atomic
                 rapid events       BS│Ctrl│Text│ESC    composition
```

1. **Buffer** — Gom stdin events trong cửa sổ 30ms (< 1 frame @60fps, không cảm nhận được)
2. **Split** — Tách buffer thành: backspace, control chars (Enter/Tab), ESC sequences, printable text
3. **Flush** — Deliver tất cả **đồng bộ** trong 1 pass → không race condition

## CLI

| Lệnh | Mô tả |
|-------|--------|
| `node patch-cli-kiro.js` | Apply patch |
| `node patch-cli-kiro.js --dry-run` | Test không ghi file |
| `node patch-cli-kiro.js --restore` | Khôi phục bản gốc |
| `node patch-cli-kiro.js -f <path>` | Chỉ định path thủ công |

## Sau khi Kiro CLI update

Mỗi lần Kiro CLI tự update, `tui.js` bị ghi đè. Chạy lại:

```bash
cd fix-vietnamese-kiro-cli && git pull && node patch-cli-kiro.js
```

Script idempotent — chạy nhiều lần không hại.

## Vị trí `tui.js`

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\kiro-cli\tui.js` |
| macOS | `~/Library/Application Support/kiro-cli/tui.js` |
| Linux | `~/.local/share/kiro-cli/tui.js` |

## Tương thích

| | Đã test |
|--|---------|
| Kiro CLI | v2.3.0+ |
| OS | Windows 10/11, macOS, Linux |
| Bộ gõ | Unikey 4.x, EVKey 4.x, OpenKey 1.x |
| Kiểu gõ | Telex, VNI |
| Node.js | ≥ 14 |

## Troubleshooting

| Vấn đề | Giải pháp |
|---------|-----------|
| "Pattern not found" | Kiro CLI đã update cấu trúc — [mở issue](https://github.com/d-init-d/fix-vietnamese-kiro-cli/issues) |
| Crash sau patch | `node patch-cli-kiro.js --restore` |
| Delay nhẹ (~30ms) | Trade-off cần thiết. Giảm: đổi `var W=30` → `var W=20` trong script |
| Vẫn lỗi một số từ | Unikey: bật "Bỏ dấu kiểu mới", tắt "Sửa lỗi chính tả" |

## Credits

- [fix-vietnamese-claude-code](https://github.com/0x0a0d/fix-vietnamese-claude-code) by **0x0a0d** — kỹ thuật investigation ban đầu

## License

[MIT](LICENSE) © d-init-d
