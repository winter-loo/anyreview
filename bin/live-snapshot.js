import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, renameSync, copyFileSync, chmodSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
/** @param {string | Uint8Array} value */
export const digest = value => createHash('sha256').update(value).digest('hex');
export function feedbackHome() { return process.env.ONLINE_REVIEW_FEEDBACK_HOME || path.join(homedir(), '.config/online-review-feedback'); }
/** @typedef {{id:string,version:string,kind:string,files:{filename:string,hash:string,size:number,snapshotPath:string}[]}} Snapshot */
/** @typedef {{mtimeMs:number,size:number,ino:number,hash:string}} SourceState */

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];
const REVIEW_EXTENSIONS = ['.png','.jpg','.jpeg','.webp','.gif','.svg','.bmp','.avif','.pdf','.docx','.doc','.pptx','.ppt','.xlsx','.xls','.csv','.md','.html','.htm',...VIDEO_EXTENSIONS];
/** @param {unknown} value */
const isVersion = value => /^[a-f\d]{64}$/.test(String(value ?? ''));

/** Every frozen version of one review lives here; the directory name is stable for a document path. @param {string} id */
export function reviewDirectory(id) { return path.join(feedbackHome(), 'snapshots', id); }
/** @param {string} id @param {string} version */
export function versionDirectory(id, version) { return path.join(reviewDirectory(id), version); }

/** @param {string} file @param {string} content */
function writeAtomic(file, content) {
 const temporary = `${file}.${randomUUID()}.tmp`;
 try { writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, file); }
 finally { rmSync(temporary, { force: true }); }
}

/** @param {string} file */
function hashFile(file) {
 const state = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = openSync(file, 'r');
 let size = 0;
 try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) { state.update(buffer.subarray(0, count)); size += count; } }
 finally { closeSync(fd); }
 return { hash: state.digest('hex'), size };
}

/** @param {string[]} filenames */
function reviewKind(filenames) {
 const ext = path.extname(filenames[0]).toLowerCase();
 const kind = VIDEO_EXTENSIONS.includes(ext) ? 'video' : ext === '.pdf' ? 'pdf' : ['.doc','.docx'].includes(ext) ? 'word'
  : ['.ppt','.pptx'].includes(ext) ? 'ppt' : ['.xlsx','.xls','.csv'].includes(ext) ? 'excel' : ext === '.md' ? 'markdown'
  : ['.html','.htm'].includes(ext) ? 'html' : 'image';
 if (filenames.length > 1 && kind !== 'image') throw new Error('Only image reviews support multiple files');
 return kind;
}

/** Hash the live sources, re-reading a file only when its stat changed, so refreshing a large review stays cheap.
 * @param {string} id @param {string[]} sources */
function sourceState(id, sources) {
 const cacheFile = path.join(reviewDirectory(id), 'sources-v1.json');
 /** @type {Record<string, SourceState>} */
 let cache = {};
 try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { /* A missing or damaged cache only costs a re-read. */ }
 let total = 0, changed = false;
 const entries = sources.map(source => {
  const resolved = realpathSync(source), stat = statSync(resolved);
  const ext = path.extname(resolved).toLowerCase(), video = VIDEO_EXTENSIONS.includes(ext);
  total += stat.size;
  if (!stat.isFile() || stat.size > (video ? 500 : 50) * 1024 * 1024 || total > (video && sources.length === 1 ? 500 : 200) * 1024 * 1024) throw new Error('Review is too large');
  if (!REVIEW_EXTENSIONS.includes(ext)) throw new Error('Unsupported review file');
  if (['.html','.htm'].includes(ext) && stat.size > 5 * 1024 * 1024) throw new Error('HTML file exceeds 5 MiB');
  const cached = cache[resolved];
  let hash = cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.ino === stat.ino ? cached.hash : '';
  if (!hash) {
   hash = hashFile(resolved).hash;
   cache[resolved] = { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, hash };
   changed = true;
  }
  return { filename: path.basename(resolved), hash, source: resolved };
 });
 const version = digest(JSON.stringify(entries.map(entry => [entry.filename, entry.hash])));
 if (changed) { mkdirSync(reviewDirectory(id), { recursive: true }); writeAtomic(cacheFile, JSON.stringify(cache)); }
 return { entries, version };
}

/** A version frozen earlier, still byte-for-byte what its reviewers saw.
 * @param {string} id @param {string} version @returns {Snapshot|null} */
export function readSnapshot(id, version) {
 if (!isVersion(version)) return null;
 try { return JSON.parse(readFileSync(path.join(versionDirectory(id, version), 'manifest.json'), 'utf8')); }
 catch { return null; }
}

/** Freeze the sources as they are now. Unchanged bytes reuse the frozen version, so the URL stays stable.
 * @param {string} id @param {string[]} sources @returns {Snapshot} */
export function freezeReview(id, sources) {
 if (!sources.length || sources.length > 100) throw new Error('Invalid review files');
 let state;
 try { state = sourceState(id, sources); }
 catch (cause) {
  // A source can vanish while an agent rewrites it; keep serving the version reviewers already have.
  const previous = cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT' ? latestSnapshot(id) : null;
  if (!previous) throw cause;
  return previous;
 }
 const { entries, version } = state;
 const current = readSnapshot(id, version);
 if (current) return current;

 reviewKind(entries.map(entry => entry.filename));
 const staging = `${reviewDirectory(id)}/${randomUUID()}.tmp`;
 try {
  const copied = entries.map((entry, index) => {
   const snapshotPath = path.join(staging, String(index), entry.filename);
   mkdirSync(path.dirname(snapshotPath), { recursive: true });
   copyFileSync(entry.source, snapshotPath);
   chmodSync(snapshotPath, 0o600);
   const { hash, size } = hashFile(snapshotPath);
   return { filename: entry.filename, hash, size };
  });
  // A source can change while it is copied, so the frozen bytes decide the version.
  const frozen = digest(JSON.stringify(copied.map(file => [file.filename, file.hash])));
  const target = versionDirectory(id, frozen);
  /** @type {Snapshot} */
  const snapshot = {
   id, version: frozen, kind: reviewKind(copied.map(file => file.filename)),
   files: copied.map((file, index) => ({ ...file, snapshotPath: path.join(target, String(index), file.filename) }))
  };
  writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(snapshot), { mode: 0o600 });
  try { renameSync(staging, target); }
  catch (cause) {
   // Another request froze the same bytes first; its copy is equivalent.
   const raced = readSnapshot(id, frozen);
   if (!raced) throw cause;
   return raced;
  }
  return snapshot;
 } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** The most recently frozen version of a review, if any. @param {string} id @returns {Snapshot|null} */
export function latestSnapshot(id) {
 const directory = reviewDirectory(id);
 /** @type {import('node:fs').Dirent[]} */
 let entries;
 try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return null; }
 const frozen = entries.filter(entry => entry.isDirectory() && isVersion(entry.name)).map(entry => {
  let time = 0;
  try { time = statSync(path.join(directory, entry.name, 'manifest.json')).mtimeMs; } catch { /* Half-written version. */ }
  return { version: entry.name, time };
 }).sort((a, b) => b.time - a.time);
 return frozen.length ? readSnapshot(id, frozen[0].version) : null;
}

/** Drop frozen versions nothing refers to any more. @param {string} id @param {string[]} keep */
export function pruneVersions(id, keep) {
 const directory = reviewDirectory(id), kept = new Set(keep);
 /** @type {import('node:fs').Dirent[]} */
 let entries;
 try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
 for (const entry of entries) {
  if (!entry.isDirectory() || !isVersion(entry.name) || kept.has(entry.name)) continue;
  rmSync(path.join(directory, entry.name), { recursive: true, force: true });
 }
}
