# 🇻🇳 Fix Vietnamese IME for Kiro CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-2.3.0-blue.svg)](https://kiro.dev)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

> Patch fix lỗi mất dấu / mất chữ khi gõ tiếng Việt trong Kiro CLI (TUI mode) với Unikey, EVKey, OpenKey.

---

## ⚡ Quick Start

```bash
git clone https://github.com/d-init-d/fix-vietnamese-kiro-cli.git
cd fix-vietnamese-kiro-cli
node patch-cli-kiro.js
```

Sau đó **đóng Kiro CLI** và mở lại terminal mới → gõ tiếng Việt bình thường.

---

## 🐛 Vấn đề

Khi gõ tiếng Việt trong Kiro CLI TUI mode (giao diện mặc định), các bộ gõ như Unikey/EVKey gửi chuỗi **backspace + text thay thế** để đặt dấu. Ví dụ gõ "chào" bằng Telex:

```
Gõ: c → h → a → o → f (dấu huyền)
IME gửi: \x7F\x7F (xóa "ao") → "ào" (thay thế có dấu)
```

Kiro CLI xử lý từng event riêng lẻ với khoảng cách async giữa chúng, gây **race condition** khiến text thay thế bị mất:

| Gõ | Mong đợi | Thực tế (chưa patch) |
|----|----------|---------------------|
| chào bạn | chào bạn | cha ba |
| tôi dùng | tôi dùng | tôi du |
| tiếng Việt | tiếng Việt | tieeng Viet |

---

## 🔧 Cách hoạt động

Patch inject một **stdin coalescing layer** vào đầu file `tui.js` của Kiro CLI:

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Unikey/    │     │   Patch Layer    │     │  Kiro TUI   │
│  EVKey      │────▶│  Buffer 30ms     │────▶│  Input      │
│  (rapid     │     │  then flush      │     │  Handler    │
│  events)    │     │  synchronously   │     │             │
└─────────────┘     └──────────────────┘     └─────────────┘
```

1. **Buffer**: Tất cả stdin events được gom lại trong cửa sổ 30ms
2. **Flush**: Sau 30ms idle, buffer được split thành logical events (backspace riêng, text riêng)
3. **Deliver**: Các events được deliver **đồng bộ** (synchronous) — không có async gap giữa delete và insert
4. **Result**: Editor xử lý toàn bộ IME composition trong 1 synchronous pass → không race condition

---

## 📦 Cài đặt

### Yêu cầu

- [Node.js](https://nodejs.org/) >= 14
- Kiro CLI đã cài đặt

### Cách 1: Clone repo

```bash
git clone https://github.com/d-init-d/fix-vietnamese-kiro-cli.git
cd fix-vietnamese-kiro-cli
node patch-cli-kiro.js
```

### Cách 2: Tải file và chạy

```bash
curl -O https://raw.githubusercontent.com/d-init-d/fix-vietnamese-kiro-cli/main/patch-cli-kiro.js
node patch-cli-kiro.js
```

### Cách 3: npx (không cần clone)

```bash
npx github:d-init-d/fix-vietnamese-kiro-cli
```

---

## 🛠️ Sử dụng

| Lệnh | Mô tả |
|-------|--------|
| `node patch-cli-kiro.js` | Apply patch |
| `node patch-cli-kiro.js --dry-run` | Kiểm tra có patch được không (không ghi file) |
| `node patch-cli-kiro.js --restore` | Khôi phục bản gốc từ backup |
| `node patch-cli-kiro.js -f <path>` | Chỉ định path tới `tui.js` thủ công |

### Sau khi patch

1. **Đóng tất cả session Kiro CLI đang chạy**
2. Mở terminal mới
3. Chạy `kiro-cli chat` (hoặc `kiro-cli`)
4. Gõ tiếng Việt bình thường ✅

---

## 🔄 Sau khi Kiro CLI cập nhật

Mỗi lần Kiro CLI tự update, file `tui.js` sẽ bị ghi đè. Chỉ cần chạy lại:

```bash
cd fix-vietnamese-kiro-cli
git pull          # Lấy patch mới nhất (nếu có)
node patch-cli-kiro.js
```

Script là **idempotent** — chạy nhiều lần không gây hại.

---

## 🖥️ Vị trí `tui.js` theo OS

Script tự động tìm `tui.js` ở đường dẫn mặc định:

| OS | Path |
|----|------|
| **Windows** | `%LOCALAPPDATA%\kiro-cli\tui.js` |
| **macOS** | `~/Library/Application Support/kiro-cli/tui.js` |
| **Linux** | `~/.local/share/kiro-cli/tui.js` |

Nếu Kiro CLI cài ở chỗ khác, dùng `-f`:

```bash
node patch-cli-kiro.js -f "/path/to/tui.js"
```

---

## ✅ Tương thích

| Thành phần | Đã test |
|-----------|---------|
| **Kiro CLI** | v2.3.0 |
| **OS** | Windows 10/11, macOS, Linux |
| **Bộ gõ** | Unikey 4.x, EVKey 4.x, OpenKey 1.x |
| **Kiểu gõ** | Telex, VNI |
| **Node.js** | >= 14 (chỉ cần để chạy script) |

---

## ❓ Troubleshooting

### Script báo "Pattern not found"

Kiro CLI có thể đã update và đổi cấu trúc bundle, hoặc đã fix bug này upstream. Mở [issue](https://github.com/d-init-d/fix-vietnamese-kiro-cli/issues) kèm output của `kiro-cli --version`.

### Sau khi patch, Kiro CLI bị crash

```bash
node patch-cli-kiro.js --restore
```

### Gõ hơi chậm hơn bình thường (~30ms delay)

Đây là trade-off cần thiết. 30ms < 1 frame ở 60fps, hầu hết người dùng không cảm nhận được. Nếu cần giảm delay, mở `patch-cli-kiro.js` và đổi `var W=30` thành `var W=20`.

### Vẫn bị lỗi với một số từ

Thử cấu hình bộ gõ:
- **Unikey**: Bật "Bỏ dấu kiểu mới", tắt "Sửa lỗi chính tả"
- **EVKey**: Bật "Bỏ dấu kiểu mới", tắt "Kiểm tra chính tả"

---

## 🔬 Chi tiết kỹ thuật

### Root Cause

Kiro CLI TUI dùng Bun-compiled React (Ink) bundle. Input pipeline:

```
process.stdin (raw mode) → addInputListener → handleInput → editor state
```

Vietnamese IME gửi rapid events (`\x7F` + text) arrive qua **separate** `data` events trên stdin. Giữa 2 events, React có thể schedule re-render, gây stale state khi event thứ 2 arrive.

### Patch Strategy

1. **Stdin coalescing** (IIFE inject sau `// @bun` pragma): Hook `process.stdin.on('data')` để buffer events trong 30ms window, sau đó flush synchronously
2. **Single-line editor guard** (string replace): Thay logic "reject all if any control char" bằng "filter control chars, insert printable portion"

### File được modify

- `%LOCALAPPDATA%\kiro-cli\tui.js` (backup tự động tại `tui.js.bak`)

---

## 🙏 Credits

- [fix-vietnamese-claude-code](https://github.com/0x0a0d/fix-vietnamese-claude-code) by **0x0a0d** — nguồn cảm hứng và kỹ thuật investigation ban đầu

---

## 📄 License

[MIT](LICENSE) © d-init-d
