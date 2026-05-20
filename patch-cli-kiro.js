#!/usr/bin/env node

/**
 * fix-vietnamese-kiro-cli v3.0.0
 *
 * ROOT CAUSE ANALYSIS:
 * Kiro TUI uses raw mode stdin. Vietnamese IME (EVKey/Unikey) sends rapid sequences:
 *   Event 1: "\x7F" (backspace - delete previous char)
 *   Event 2: "ào" (replacement text with diacritic)
 *
 * These arrive as SEPARATE stdin data events. The TUI processes event 1 (deletes char),
 * then processes event 2. But between events, React re-renders and the cursor/state
 * can become inconsistent, causing the replacement text to be partially lost.
 *
 * THE FIX: Hook process.stdin.on('data') to detect IME patterns (\x7F followed by
 * printable text within 16ms) and merge them into a single event. The merged event
 * is then processed atomically by the editor's handleInput, which correctly handles
 * the backspace+insert sequence without intermediate re-renders.
 *
 * Additionally, patch the single-line editor (class ap) to filter control chars
 * instead of rejecting the entire input string.
 *
 * CREDIT: Inspired by fix-vietnamese-claude-code by 0x0a0d.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = '/* _d_init_d_vn_ime_fix_v3_ */';
const VERSION = '3.0.0';

// Patch 1: Single-line editor guard (class ap)
const ORIGINAL_AP = 'if(![...e].some((i)=>{let a=i.charCodeAt(0);return a<32||a===127||a>=128&&a<=159}))this.insertCharacter(e)';
const PATCHED_AP = `${MARKER}(()=>{let _f=[...e].filter((i)=>{let a=i.charCodeAt(0);return!(a<32||a===127||a>=128&&a<=159)}).join("");if(_f.length>0)this.insertCharacter(_f)})()`;

// Patch 2: Inject IME coalescing at stdin level - but ONLY for 'data' listeners
// that are added AFTER our hook. We intercept at the point where addInputListener
// dispatches to handlers.
const ORIGINAL_DISPATCH = 'return n.addInputListener((o)=>{let{input:c,key:l}=cp(o);a.current(c,l)})';
// We don't patch this - it's for useInput hook which isn't the problem.

// Patch 3: The real fix - in the multi-line editor's handleInput, when we see
// a backspace followed immediately by printable text in the same event, handle
// them together. But events arrive separately...
//
// ACTUAL FIX: Inject IIFE that monkey-patches the TUI's addInputListener to
// coalesce rapid stdin events. Unlike v1 which hooked process.stdin.on (too low
// level, broke key parsing), this hooks at the TUI dispatcher level.

// We inject after the `// @bun` pragma, a self-contained IIFE that:
// 1. Saves original process.stdin.on
// 2. Wraps 'data' listeners with a 16ms coalescing buffer
// 3. When buffer contains \x7F followed by printable chars, delivers as one chunk
// 4. When buffer contains only printable chars or only \x7F, delivers immediately
const PAYLOAD = `${MARKER}
(function(){
  if(process.stdin.__vnfix)return;
  process.stdin.__vnfix=true;
  var W=16,orig=process.stdin.on.bind(process.stdin),
      origAL=process.stdin.addListener?process.stdin.addListener.bind(process.stdin):null;
  function wrap(ev,fn){
    if(ev!=='data')return fn;
    var buf=null,tm=null;
    return function(chunk){
      var s=typeof chunk==='string'?chunk:chunk.toString();
      // If this chunk is ONLY a backspace or ONLY printable, and no pending buffer, pass through immediately
      if(!buf&&s.indexOf('\\x7f')===-1&&s.indexOf('\\b')===-1){fn.call(this,chunk);return}
      // If this is a lone backspace with no pending, start buffering
      if(!buf&&(s==='\\x7f'||s==='\\b')){buf=s;tm=setTimeout(function(){var o=buf;buf=null;tm=null;fn.call(process.stdin,o)},W);return}
      // If we have a pending backspace and this is printable text, merge and deliver
      if(buf){
        clearTimeout(tm);
        var merged=buf+s;buf=null;tm=null;
        fn.call(this,merged);
        return;
      }
      fn.call(this,chunk);
    };
  }
  process.stdin.on=function(ev,fn){return orig(ev,wrap(ev,fn))};
  if(origAL)process.stdin.addListener=process.stdin.on;
})();
`;

function usage() {
  console.log(`fix-vietnamese-kiro-cli v${VERSION}

Usage: node patch-cli-kiro.js [options]

Options:
  -f, --file <path>    Path to tui.js
  -d, --dry-run        Test without writing
  -r, --restore        Restore from backup
  -h, --help           Show help
`);
}

function findTuiJs() {
  const candidates = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    candidates.push(path.join(process.env.LOCALAPPDATA, 'kiro-cli', 'tui.js'));
  else if (process.platform === 'darwin')
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'tui.js'));
  else {
    candidates.push(path.join(os.homedir(), '.local', 'share', 'kiro-cli', 'tui.js'));
    candidates.push(path.join(os.homedir(), '.config', 'kiro-cli', 'tui.js'));
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function patchContent(content) {
  if (content.includes(MARKER)) return { ok: true, alreadyPatched: true };

  let patched = content;
  let changes = [];

  // Patch 1: Single-line editor guard
  if (patched.includes(ORIGINAL_AP)) {
    patched = patched.replace(ORIGINAL_AP, PATCHED_AP);
    changes.push('single-line editor (class ap): filter control chars');
  }

  // Patch 2: Inject stdin coalescing IIFE after // @bun pragma
  const re = /(^\s*#![^\r\n]*\r?\n)?(\/\/ @bun\b[^\r\n]*\r?\n)/m;
  const match = patched.match(re);
  if (match) {
    const insertPoint = match.index + match[0].length;
    patched = patched.slice(0, insertPoint) + PAYLOAD + '\n' + patched.slice(insertPoint);
    changes.push('stdin IME coalescing (16ms window for backspace+text)');
  }

  if (changes.length === 0) {
    return { ok: false, error: 'Không tìm thấy pattern cần patch. Kiro CLI có thể đã update.' };
  }

  return { ok: true, alreadyPatched: false, content: patched, changes };
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
  if (!target || !fs.existsSync(target)) { console.error('Không tìm thấy tui.js.'); process.exit(1); }
  console.log('File: ' + target);
  const bak = target + '.bak';
  if (restore) {
    if (!fs.existsSync(bak)) { console.error('Không có backup.'); process.exit(1); }
    fs.copyFileSync(bak, target);
    console.log('Đã restore.');
    process.exit(0);
  }
  const original = fs.readFileSync(target, 'utf8');
  const result = patchContent(original);
  if (!result.ok) { console.error(result.error); process.exit(1); }
  if (result.alreadyPatched) { console.log('Đã patch từ trước.'); process.exit(0); }
  if (dryRun) { console.log('Dry run OK. Changes: ' + result.changes.join(', ')); process.exit(0); }
  if (!fs.existsSync(bak)) { fs.copyFileSync(target, bak); console.log('Backup: ' + bak); }
  fs.writeFileSync(target, result.content, 'utf8');
  console.log('✅ Patch thành công!');
  console.log('Changes: ' + result.changes.join(', '));
  console.log('\nĐóng Kiro CLI, mở terminal mới, chạy `kiro-cli chat` để test.');
  console.log('Restore: node patch-cli-kiro.js --restore');
}

if (require.main === module) main();
module.exports = { MARKER, VERSION, patchContent, findTuiJs };
