import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** @param {string} name */
function exactNamePattern(name) {
 return `^${name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`;
}

/** Find a file by its bare name below `cwd` with fd; ask the user to pick when several match.
 * @param {string} name
 * @param {{cwd?: string, input?: NodeJS.ReadStream, output?: NodeJS.WriteStream}} [options]
 */
export async function locateFile(name, { cwd = process.cwd(), input = process.stdin, output = process.stderr } = {}) {
 const result = spawnSync('fd', ['--type', 'file', '--color', 'never', '--strip-cwd-prefix', '--print0', '--', exactNamePattern(name)], { cwd, encoding: 'utf8' });
 if (result.error) {
  const missing = 'code' in result.error && result.error.code === 'ENOENT';
  throw new Error(missing ? `File not found: ${name}. Install fd to search for it by name.` : `Cannot run fd: ${result.error.message}`);
 }
 if (result.status !== 0) throw new Error(result.stderr.trim() || `fd failed while searching for ${name}.`);

 const matches = result.stdout.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
 if (!matches.length) throw new Error(`File not found: ${name} (also searched ${cwd} with fd)`);
 if (matches.length === 1) {
  output.write(`Found ${matches[0]}\n`);
  return path.resolve(cwd, matches[0]);
 }

 const list = matches.map((match) => `  ${match}`).join('\n');
 if (!input.isTTY) throw new Error(`Multiple files named ${name} found. Rerun with a path:\n${list}`);
 // Loaded only when prompting so ordinary review runs do not pay for the prompt library.
 const { default: select } = await import('@inquirer/select');
 try {
  const choice = await select({ message: `Multiple files named ${name} found. Select one:`, choices: matches, pageSize: 15 }, { input, output });
  return path.resolve(cwd, choice);
 } catch (error) {
  if (error instanceof Error && error.name === 'ExitPromptError') throw new Error('Selection cancelled. Nothing was published.');
  throw error;
 }
}
