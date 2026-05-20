#!/usr/bin/env node

/**
 * fix-vietnamese-kiro-cli
 *
 * Patches Kiro CLI's tui.js to fix Vietnamese IME issues (Unikey / EVKey / OpenKey).
 *
 * The bug: Kiro TUI uses React (Ink) under the hood. When a Vietnamese IME sends
 * rapid backspace+rewrite sequences for diacritic placement (e.g. typing "duwngf"
 * to produce "dùng"), React state updates race and characters get dropped.
 *
 * The fix: Inject a stdin coalescing layer at the top of tui.js. Rapid stdin
 * data events within a 5ms window are merged into a single chunk before being
 * dispatched to the TUI's input listener. This makes IME composition events
 * arrive atomically, eliminating the race.
 *
 * CREDIT: Investigation technique inspired by `fix-vietnamese-claude-code`
 * (https://github.com/0x0a0d/fix-vietnamese-claude-code) by 0x0a0d. The
 * specific patch payload here is original and tailored for Kiro CLI's
 * Bun-compiled, Ink-based bundle.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = '/* _d_init_d_vn_ime_fix_ */';
const VERSION = '1.0.0';

// The injected payload. Must be a self-contained IIFE that runs at the very
// start of tui.js, before any input handlers are registered.
const PAYLOAD = `${MARKER}
(function(){
  if (process.stdin.__d_init_d_vn_ime_fix) return;
  process.stdin.__d_init_d_vn_ime_fix = true;
  var COALESCE_MS = 5;
  var _origOn = process.stdin.on.bind(process.stdin);
  var _origAdd = process.stdin.addListener && process.stdin.addListener.bind(process.stdin);
  function _wrap(ev, listener){
    if (ev !== 'data') return listener;
    var buf = Buffer.alloc(0);
    var timer = null;
    var ctx;
    return function(chunk){
      ctx = this;
      buf = Buffer.concat([buf, chunk]);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function(){
        var out = buf;
        buf = Buffer.alloc(0);
        timer = null;
        if (out.length > 0) listener.call(ctx, out);
      }, COALESCE_MS);
    };
  }
  process.stdin.on = function(event, listener){
    return _origOn(event, _wrap(event, listener));
  };
  if (_origAdd) {
    process.stdin.addListener = process.stdin.on;
  }
})();
`;

function usage() {
  console.log(`fix-vietnamese-kiro-cli v${VERSION}

Usage:
  node patch-cli-kiro.js [options]

Options:
  -f, --file <path>    Path to Kiro CLI's tui.js. If omitted, the script tries
                       to find it automatically.
  -d, --dry-run        Compute and report the patch without writing the file.
  -r, --restore        Restore tui.js from tui.js.bak (undo a previous patch).
  -h, --help           Show this help message.

Default tui.js locations probed:
  Windows: %LOCALAPPDATA%\\kiro-cli\\tui.js
  macOS:   ~/Library/Application Support/kiro-cli/tui.js
  Linux:   ~/.local/share/kiro-cli/tui.js or ~/.config/kiro-cli/tui.js

This patch fixes the Vietnamese IME (Unikey / EVKey / OpenKey) issue where
rapid backspace+rewrite sequences cause characters to be dropped while typing
in Kiro's TUI mode. The patch hooks process.stdin.on('data', ...) and
coalesces events within a 5ms window so React state updates stay consistent.
`);
}

function findTuiJs() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'kiro-cli', 'tui.js'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'tui.js'));
  } else {
    candidates.push(path.join(os.homedir(), '.local', 'share', 'kiro-cli', 'tui.js'));
    candidates.push(path.join(os.homedir(), '.config', 'kiro-cli', 'tui.js'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function patchContent(content) {
  if (content.includes(MARKER)) {
    return { ok: true, alreadyPatched: true };
  }

  // Kiro's tui.js (Bun-compiled) starts with:
  //   #!/usr/bin/env bun
  //   // @bun
  //   var lpe=Object.create;...
  //
  // We inject the payload right after the `// @bun` pragma. This is the
  // earliest safe injection point: before any module bootstrapping but
  // after the bun marker so bun's compiled-script detection is preserved.
  const re = /(^\s*#![^\r\n]*\r?\n)?(\/\/ @bun\b[^\r\n]*\r?\n)/m;
  const match = content.match(re);
  if (!match) {
    return {
      ok: false,
      error: 'Không tìm thấy `// @bun` pragma trong tui.js. ' +
             'Có thể Kiro CLI đã update và đổi cấu trúc bundle. ' +
             'Vui lòng mở issue tại https://github.com/d-init-d/fix-vietnamese-kiro-cli/issues'
    };
  }
  const insertPoint = match.index + match[0].length;
  const patched = content.slice(0, insertPoint) + PAYLOAD + '\n' + content.slice(insertPoint);
  return { ok: true, alreadyPatched: false, content: patched };
}

function backupPath(target) {
  return target + '.bak';
}

function main() {
  const args = process.argv.slice(2);
  let target = null;
  let dryRun = false;
  let restore = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a === '-d' || a === '--dry-run') { dryRun = true; }
    else if (a === '-r' || a === '--restore') { restore = true; }
    else if (a === '-f' || a === '--file') { target = args[++i]; }
    else { console.error('Tham số không hợp lệ: ' + a); usage(); process.exit(2); }
  }

  if (!target) target = findTuiJs();
  if (!target || !fs.existsSync(target)) {
    console.error('Không tìm thấy file tui.js của Kiro CLI.');
    if (target) console.error('Đã thử: ' + target);
    console.error('Hãy chỉ định file thủ công bằng `-f /đường/dẫn/tới/tui.js`.');
    process.exit(1);
  }

  console.log('File mục tiêu: ' + target);
  const bak = backupPath(target);

  if (restore) {
    if (!fs.existsSync(bak)) {
      console.error('Không tìm thấy file backup: ' + bak);
      process.exit(1);
    }
    fs.copyFileSync(bak, target);
    console.log('Đã restore tui.js từ ' + bak);
    process.exit(0);
  }

  const original = fs.readFileSync(target, 'utf8');
  const result = patchContent(original);

  if (!result.ok) {
    console.error('Patch thất bại: ' + result.error);
    process.exit(1);
  }
  if (result.alreadyPatched) {
    console.log('tui.js đã được patch từ trước (marker `' + MARKER + '` được tìm thấy). Không cần làm gì.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('Dry run: patch khả thi. Sẽ thêm ' + PAYLOAD.length + ' bytes vào đầu file.');
    process.exit(0);
  }

  // Tạo backup nếu chưa có
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(target, bak);
    console.log('Đã tạo backup: ' + bak);
  } else {
    console.log('Backup đã tồn tại, giữ nguyên: ' + bak);
  }

  fs.writeFileSync(target, result.content, 'utf8');
  console.log('Patch thành công! tui.js đã được vá ' + result.content.length + ' bytes.');
  console.log('');
  console.log('Bước tiếp theo:');
  console.log('  1. Đóng tất cả session Kiro CLI hiện đang chạy.');
  console.log('  2. Mở terminal mới và chạy `kiro-cli chat`.');
  console.log('  3. Gõ thử tiếng Việt để kiểm tra.');
  console.log('');
  console.log('Nếu Kiro CLI gặp lỗi sau khi patch, restore bằng:');
  console.log('  node patch-cli-kiro.js --restore');
}

if (require.main === module) {
  main();
}

module.exports = { MARKER, VERSION, PAYLOAD, patchContent, findTuiJs };
