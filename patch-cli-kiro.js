#!/usr/bin/env node

/**
 * fix-vietnamese-kiro-cli v4.0.0
 *
 * Vietnamese IME (Unikey/EVKey/OpenKey) sends rapid sequences of keystrokes to
 * compose diacritics. For example, typing "chào" with Telex:
 *   1. "c" "h" "a" "o" (normal chars, arrive one by one)
 *   2. When user types "f" for huyền tone: Unikey sends "\x7F\x7F" (delete "ao")
 *      then "ào" (replacement with diacritic)
 *
 * These arrive as multiple separate stdin events within ~5-20ms. Kiro's TUI
 * processes each event independently, causing race conditions where deletions
 * and insertions don't stay atomic.
 *
 * FIX: Buffer ALL stdin data events and flush after 30ms of silence. This makes
 * the entire IME composition sequence arrive as one atomic chunk. The TUI's
 * input parser then processes backspaces and text insertions in correct order
 * within a single synchronous pass.
 *
 * 30ms is imperceptible to humans (< 1 frame at 60fps) but long enough to
 * capture the full IME composition burst from any Vietnamese input method.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = '/* _d_init_d_vn_ime_fix_v4_ */';
const VERSION = '4.0.0';

const ORIGINAL_AP = 'if(![...e].some((i)=>{let a=i.charCodeAt(0);return a<32||a===127||a>=128&&a<=159}))this.insertCharacter(e)';
const PATCHED_AP = `${MARKER}(()=>{let _f=[...e].filter((i)=>{let a=i.charCodeAt(0);return!(a<32||a===127||a>=128&&a<=159)}).join("");if(_f.length>0)this.insertCharacter(_f)})()`;

const PAYLOAD = `${MARKER}
(function(){
  if(process.stdin.__vnfix)return;
  process.stdin.__vnfix=true;
  var W=30;
  var orig=process.stdin.on.bind(process.stdin);
  function wrap(ev,fn){
    if(ev!=='data')return fn;
    var chunks=[],tm=null;
    function flush(){
      tm=null;
      if(chunks.length===0)return;
      var merged=chunks.join('');
      chunks=[];
      // Split merged into individual logical events for the parser:
      // Each \x7F is a backspace, each printable sequence is text.
      // Deliver them as separate calls but synchronously (no async gap).
      var i=0,len=merged.length;
      while(i<len){
        if(merged[i]==='\\x7f'||merged[i]==='\\b'){
          fn.call(process.stdin,merged[i]);
          i++;
        } else if(merged[i]==='\\x1b'){
          // ESC sequence - find end and deliver whole
          var j=i+1;
          if(j<len&&merged[j]==='['){
            j++;
            while(j<len&&merged.charCodeAt(j)>=0x20&&merged.charCodeAt(j)<=0x3f)j++;
            if(j<len)j++;
          }else if(j<len){j++}
          fn.call(process.stdin,merged.slice(i,j));
          i=j;
        } else {
          // Printable text - collect contiguous printable chars
          var j=i;
          while(j<len&&merged[j]!=='\\x7f'&&merged[j]!=='\\b'&&merged[j]!=='\\x1b'&&merged.charCodeAt(j)>=32)j++;
          fn.call(process.stdin,merged.slice(i,j));
          i=j;
        }
      }
    }
    return function(chunk){
      var s=typeof chunk==='string'?chunk:chunk.toString();
      chunks.push(s);
      if(tm)clearTimeout(tm);
      tm=setTimeout(flush,W);
    };
  }
  process.stdin.on=function(ev,fn){return orig(ev,wrap(ev,fn))};
  if(process.stdin.addListener)process.stdin.addListener=process.stdin.on;
})();
`;

function usage() {
  console.log(`fix-vietnamese-kiro-cli v${VERSION}
Usage: node patch-cli-kiro.js [options]
  -f, --file <path>    Path to tui.js
  -d, --dry-run        Test without writing
  -r, --restore        Restore from backup
  -h, --help           Show help`);
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

  if (patched.includes(ORIGINAL_AP)) {
    patched = patched.replace(ORIGINAL_AP, PATCHED_AP);
    changes.push('single-line editor filter');
  }

  const re = /(^\s*#![^\r\n]*\r?\n)?(\/\/ @bun\b[^\r\n]*\r?\n)/m;
  const match = patched.match(re);
  if (match) {
    const pt = match.index + match[0].length;
    patched = patched.slice(0, pt) + PAYLOAD + '\n' + patched.slice(pt);
    changes.push('stdin coalescing (30ms)');
  }

  if (changes.length === 0)
    return { ok: false, error: 'Pattern not found. Kiro CLI may have updated.' };
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
  if (!target || !fs.existsSync(target)) { console.error('tui.js not found.'); process.exit(1); }
  console.log('File: ' + target);
  const bak = target + '.bak';
  if (restore) {
    if (!fs.existsSync(bak)) { console.error('No backup.'); process.exit(1); }
    fs.copyFileSync(bak, target);
    console.log('Restored.');
    process.exit(0);
  }
  const original = fs.readFileSync(target, 'utf8');
  const result = patchContent(original);
  if (!result.ok) { console.error(result.error); process.exit(1); }
  if (result.alreadyPatched) { console.log('Already patched.'); process.exit(0); }
  if (dryRun) { console.log('Dry run OK: ' + result.changes.join(', ')); process.exit(0); }
  if (!fs.existsSync(bak)) { fs.copyFileSync(target, bak); console.log('Backup: ' + bak); }
  fs.writeFileSync(target, result.content, 'utf8');
  console.log('✅ Patched! Changes: ' + result.changes.join(', '));
  console.log('Restart Kiro CLI to test. Restore: node patch-cli-kiro.js -r');
}

if (require.main === module) main();
module.exports = { MARKER, VERSION, patchContent, findTuiJs };
