#!/usr/bin/env node

/**
 * fix-vietnamese-kiro-cli v2.0.0
 *
 * Patches Kiro CLI's tui.js to fix Vietnamese IME issues (Unikey / EVKey / OpenKey).
 *
 * ROOT CAUSE: Kiro's single-line editor (class `ap`) has this guard before inserting text:
 *
 *   if(![...e].some((i)=>{let a=i.charCodeAt(0);return a<32||a===127||a>=128&&a<=159}))
 *     this.insertCharacter(e)
 *
 * When Vietnamese IME sends a mixed chunk like "\x7Fdùng" (backspace + replacement text),
 * the `some()` check sees \x7F (charCode 127) and REJECTS THE ENTIRE STRING, including
 * the valid Vietnamese text that follows. This causes characters to be dropped.
 *
 * THE FIX: Replace the guard with logic that filters out control characters and inserts
 * only the printable portion. Backspace chars (\x7F) are handled separately by the
 * deleteCharBackward matcher above, so by the time we reach this code, any \x7F in the
 * string is a leftover from IME composition that should be stripped, not used to reject
 * the whole input.
 *
 * CREDIT: Investigation technique inspired by `fix-vietnamese-claude-code`
 * (https://github.com/0x0a0d/fix-vietnamese-claude-code) by 0x0a0d.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = '/* _d_init_d_vn_ime_fix_v2_ */';
const VERSION = '2.0.0';

// The original pattern we're looking for (single-line editor guard)
const ORIGINAL_PATTERN = 'if(![...e].some((i)=>{let a=i.charCodeAt(0);return a<32||a===127||a>=128&&a<=159}))this.insertCharacter(e)';

// The replacement: filter control chars, insert only printable portion
const PATCHED_CODE = `${MARKER}(()=>{let _f=[...e].filter((i)=>{let a=i.charCodeAt(0);return!(a<32||a===127||a>=128&&a<=159)}).join("");if(_f.length>0)this.insertCharacter(_f)})()`;

function usage() {
  console.log(`fix-vietnamese-kiro-cli v${VERSION}

Usage:
  node patch-cli-kiro.js [options]

Options:
  -f, --file <path>    Path to Kiro CLI's tui.js
  -d, --dry-run        Test without writing
  -r, --restore        Restore from tui.js.bak
  -h, --help           Show help

Default tui.js location:
  Windows: %LOCALAPPDATA%\\kiro-cli\\tui.js
  macOS:   ~/Library/Application Support/kiro-cli/tui.js
  Linux:   ~/.local/share/kiro-cli/tui.js
`);
}

function findTuiJs() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA)
      candidates.push(path.join(process.env.LOCALAPPDATA, 'kiro-cli', 'tui.js'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'tui.js'));
  } else {
    candidates.push(path.join(os.homedir(), '.local', 'share', 'kiro-cli', 'tui.js'));
    candidates.push(path.join(os.homedir(), '.config', 'kiro-cli', 'tui.js'));
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function patchContent(content) {
  if (content.includes(MARKER)) {
    return { ok: true, alreadyPatched: true };
  }
  if (!content.includes(ORIGINAL_PATTERN)) {
    return {
      ok: false,
      error: 'Không tìm thấy pattern cần patch trong tui.js.\n' +
             'Có thể Kiro CLI đã update và fix bug này rồi, hoặc đổi cấu trúc code.\n' +
             'Vui lòng mở issue tại https://github.com/d-init-d/fix-vietnamese-kiro-cli/issues'
    };
  }
  const patched = content.replace(ORIGINAL_PATTERN, PATCHED_CODE);
  return { ok: true, alreadyPatched: false, content: patched };
}

function main() {
  const args = process.argv.slice(2);
  let target = null, dryRun = false, restore = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a === '-d' || a === '--dry-run') dryRun = true;
    else if (a === '-r' || a === '--restore') restore = true;
    else if (a === '-f' || a === '--file') target = args[++i];
  }

  if (!target) target = findTuiJs();
  if (!target || !fs.existsSync(target)) {
    console.error('Không tìm thấy tui.js. Dùng -f để chỉ định path.');
    process.exit(1);
  }

  console.log('File: ' + target);
  const bak = target + '.bak';

  if (restore) {
    if (!fs.existsSync(bak)) { console.error('Không có backup: ' + bak); process.exit(1); }
    fs.copyFileSync(bak, target);
    console.log('Đã restore từ backup.');
    process.exit(0);
  }

  const original = fs.readFileSync(target, 'utf8');
  const result = patchContent(original);

  if (!result.ok) { console.error(result.error); process.exit(1); }
  if (result.alreadyPatched) { console.log('Đã patch từ trước. Không cần làm gì.'); process.exit(0); }
  if (dryRun) { console.log('Dry run OK: tìm thấy pattern, patch khả thi.'); process.exit(0); }

  if (!fs.existsSync(bak)) {
    fs.copyFileSync(target, bak);
    console.log('Backup: ' + bak);
  }

  fs.writeFileSync(target, result.content, 'utf8');
  console.log('✅ Patch thành công!');
  console.log('');
  console.log('Đóng Kiro CLI hiện tại, mở terminal mới và chạy `kiro-cli chat` để test.');
  console.log('Restore: node patch-cli-kiro.js --restore');
}

if (require.main === module) main();
module.exports = { MARKER, VERSION, ORIGINAL_PATTERN, PATCHED_CODE, patchContent, findTuiJs };
