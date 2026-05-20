# Fix gõ tiếng Việt cho Kiro CLI

Patch fix lỗi mất chữ khi gõ tiếng Việt với Unikey / EVKey / OpenKey trong Kiro CLI TUI mode.

## Vấn đề

Khi gõ tiếng Việt trong Kiro CLI, bộ gõ gửi chuỗi backspace + text mới để đặt dấu.
Kiro CLI reject **toàn bộ chuỗi** nếu phát hiện bất kỳ control character nào trong đó,
khiến text hợp lệ phía sau cũng bị mất:

```
Gõ:    "tôi đang dùng"
Hiện:  "tôi đang dug"   ← mất ký tự
```

## Root Cause

```javascript
// Kiro tui.js - single-line editor guard (class ap):
if(![...e].some((i)=>{let a=i.charCodeAt(0);return a<32||a===127||a>=128&&a<=159}))
  this.insertCharacter(e)
```

Khi IME gửi `"\x7Fdùng"` (backspace + replacement), `some()` thấy `\x7F` → reject cả string → "dùng" bị mất.

## Giải pháp

Patch thay thế logic reject-all bằng filter-and-insert: loại bỏ control chars, giữ lại và insert phần printable.

## Cài đặt

```bash
# Clone và chạy
git clone https://github.com/d-init-d/fix-vietnamese-kiro-cli.git
cd fix-vietnamese-kiro-cli
node patch-cli-kiro.js
```

## Sử dụng

```bash
node patch-cli-kiro.js            # Patch
node patch-cli-kiro.js --dry-run  # Test không ghi file
node patch-cli-kiro.js --restore  # Khôi phục bản gốc
node patch-cli-kiro.js -f <path>  # Chỉ định path tui.js
```

Sau khi patch: đóng Kiro CLI hiện tại, mở terminal mới, chạy `kiro-cli chat`.

## Sau khi Kiro CLI update

Chạy lại `node patch-cli-kiro.js` — script tự detect và patch lại.

## Tương thích

- Kiro CLI 2.3.0 (Windows/macOS/Linux)
- Unikey, EVKey, OpenKey (Telex/VNI)

## Credits

- [fix-vietnamese-claude-code](https://github.com/0x0a0d/fix-vietnamese-claude-code) by 0x0a0d — inspiration

## License

MIT
