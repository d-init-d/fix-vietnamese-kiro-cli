# Fix gõ tiếng Việt cho Kiro CLI

> Patch fix lỗi mất chữ khi gõ tiếng Việt với Unikey / EVKey / OpenKey trong Kiro CLI (TUI mode).

## Vấn đề

Khi gõ tiếng Việt trong Kiro CLI TUI mode (mặc định), bộ gõ Unikey/EVKey gửi
chuỗi backspace + rewrite để đặt dấu (ví dụ: gõ `duwngf` để ra `dùng`). Vì
TUI dùng React (Ink) cập nhật state không đồng bộ, các event đến quá nhanh
gây race condition và **mất ký tự cuối**:

```
Gõ:    "tôi đang dùng"
Hiện:  "tôi đang dun"   ← chữ "g" bị mất
```

## Giải pháp

Patch này inject một IIFE vào đầu file `tui.js` của Kiro CLI để **gom các
event stdin trong cửa sổ 5ms** thành một batch duy nhất trước khi đẩy vào
TUI. Nhờ đó IME composition arrive atomically, eliminating race condition.

- ✅ Không cần đổi bộ gõ, không cần dùng clipboard mode
- ✅ Không phá Kiro CLI - có backup tự động, restore 1 lệnh
- ✅ Hoạt động với mọi bộ gõ: Unikey, EVKey, OpenKey, GoTV, ...
- ⚠️ Phải chạy lại sau mỗi lần Kiro CLI cập nhật (tui.js sẽ bị ghi đè)

## Cài đặt

### Cách 1: Chạy trực tiếp với npx

```bash
npx github:d-init-d/fix-vietnamese-kiro-cli
```

### Cách 2: Clone và chạy thủ công

```bash
git clone https://github.com/d-init-d/fix-vietnamese-kiro-cli.git
cd fix-vietnamese-kiro-cli
node patch-cli-kiro.js
```

### Cách 3: Tải file riêng và chạy

```bash
curl -O https://raw.githubusercontent.com/d-init-d/fix-vietnamese-kiro-cli/main/patch-cli-kiro.js
node patch-cli-kiro.js
```

## Sử dụng

### Patch (cài fix)

```bash
node patch-cli-kiro.js
```

Output mẫu:

```
File mục tiêu: C:\Users\<user>\AppData\Local\kiro-cli\tui.js
Đã tạo backup: C:\Users\<user>\AppData\Local\kiro-cli\tui.js.bak
Patch thành công! tui.js đã được vá 12087976 bytes.
```

Sau đó:

1. **Đóng tất cả session Kiro CLI đang chạy.**
2. Mở terminal mới và chạy `kiro-cli chat`.
3. Gõ thử tiếng Việt - dấu sẽ không còn bị mất chữ.

### Restore (gỡ patch)

```bash
node patch-cli-kiro.js --restore
```

### Tham số khác

```
-f, --file <path>    Chỉ định path tới tui.js (nếu cài ở chỗ khác)
-d, --dry-run        Test xem có patch được không, không ghi file
-r, --restore        Khôi phục từ tui.js.bak
-h, --help           Hiển thị help
```

## Vị trí tui.js theo OS

Patch tự tìm tui.js ở các đường dẫn mặc định:

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\kiro-cli\tui.js` |
| macOS | `~/Library/Application Support/kiro-cli/tui.js` |
| Linux | `~/.local/share/kiro-cli/tui.js` hoặc `~/.config/kiro-cli/tui.js` |

Nếu Kiro CLI cài ở chỗ khác, dùng `-f` để chỉ định:

```bash
node patch-cli-kiro.js -f "/path/tới/tui.js"
```

## Sau khi Kiro CLI update

Mỗi lần Kiro CLI tự cập nhật, file `tui.js` sẽ bị ghi đè và patch mất tác dụng.
Chỉ cần chạy lại lệnh patch:

```bash
node patch-cli-kiro.js
```

Patch script là **idempotent** - chạy nhiều lần không gây hại, nó tự kiểm tra
marker `/* _d_init_d_vn_ime_fix_ */` để biết đã patch hay chưa.

## Cấu hình bộ gõ khuyến nghị

Để giảm thiểu rewrite events, nên cấu hình bộ gõ:

### Unikey

- **Bảng mã**: Unicode
- **Kiểu gõ**: Telex
- **Tích**: "Bỏ dấu kiểu mới"
- **Bỏ tích**: "Sửa lỗi chính tả", "Cho phép gõ tắt"

### EVKey

- **Tab Tùy chọn**: Kiểu gõ Telex, tích "Bỏ dấu kiểu mới"
- **Tab Tùy chọn**: Bỏ tích "Sửa lỗi chính tả"

## Cách hoạt động (kỹ thuật)

Patch inject đoạn IIFE sau ngay đầu file `tui.js`, sau pragma `// @bun`:

```javascript
(function(){
  if (process.stdin.__d_init_d_vn_ime_fix) return;
  process.stdin.__d_init_d_vn_ime_fix = true;
  var COALESCE_MS = 5;
  var _origOn = process.stdin.on.bind(process.stdin);
  // ... wrapper hook process.stdin.on('data', ...)
})();
```

Khi Kiro TUI gọi `process.stdin.on('data', listener)`, wrapper sẽ:

1. Buffer các chunk stdin đến trong window 5ms.
2. Sau 5ms từ chunk cuối cùng, gộp tất cả thành 1 Buffer rồi đẩy vào listener gốc.
3. Bộ gõ tiếng Việt gửi rapid backspace + rewrite trong window này → arrive như 1 batch → React state update atomically → không race condition → không mất chữ.

5ms là cân bằng giữa:
- **Đủ ngắn** để typing latency không cảm nhận được
- **Đủ dài** để gom toàn bộ IME composition (thường < 2ms)

## Tương thích

| Thành phần | Phiên bản test |
|-----------|----------------|
| Kiro CLI | 2.3.0 |
| OS | Windows 10/11, macOS, Linux |
| Bộ gõ | Unikey 4.x, EVKey 4.x, OpenKey 1.x |
| Node.js | >= 14 (chỉ cần để chạy script patch) |

## Troubleshooting

### "Không tìm thấy file tui.js"

Kiro CLI cài ở chỗ khác. Dùng `-f` để chỉ định:

```bash
node patch-cli-kiro.js -f "/đường/dẫn/tới/tui.js"
```

Tìm path bằng:

- **Windows**: `where kiro-cli` rồi xem cùng folder có `tui.js` không
- **macOS/Linux**: `which kiro-cli` rồi tìm `tui.js`

### Sau khi patch, Kiro CLI bị crash

Restore ngay:

```bash
node patch-cli-kiro.js --restore
```

Sau đó báo lỗi tại [Issues](https://github.com/d-init-d/fix-vietnamese-kiro-cli/issues)
kèm version Kiro CLI (`kiro-cli --version`) và OS.

### Patch không tìm thấy `// @bun` pragma

Kiro CLI có thể đã đổi cấu trúc bundle. Mở issue kèm 2 dòng đầu của `tui.js`:

```bash
head -2 ~/AppData/Local/kiro-cli/tui.js     # macOS/Linux
powershell "Get-Content $env:LOCALAPPDATA\kiro-cli\tui.js -TotalCount 2"   # Windows
```

## Nguồn cảm hứng

- [fix-vietnamese-claude-code](https://github.com/0x0a0d/fix-vietnamese-claude-code)
  của 0x0a0d - đã chỉ ra rằng các CLI dùng React/Ink có thể bị mất chữ khi gõ
  tiếng Việt do cách bộ gõ gửi rapid IME events.

Patch trong repo này là **độc lập và tailored riêng cho Kiro CLI** - cấu trúc
bundle của Kiro CLI khác Claude Code (Bun-compiled vs Node bundle), nên kỹ
thuật pattern matching trong `fix-vietnamese-claude-code` không áp dụng được.
Thay vào đó, patch này dùng kỹ thuật **stdin coalescing** ở mức process - tổng
quát hơn và ít phụ thuộc vào nội bộ bundle.

## License

MIT - xem file [LICENSE](LICENSE).
