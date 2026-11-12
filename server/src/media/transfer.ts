import fs from 'node:fs/promises';
import path from 'node:path';
import type { TransferMode } from '../settings.js';

async function exists(p: string) {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** True when `a` and `b` are the same file (same path, same inode, or b is a symlink to a). */
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    const lb = await fs.lstat(b);
    if (lb.isSymbolicLink()) {
      const target = path.resolve(path.dirname(b), await fs.readlink(b));
      return target === path.resolve(a);
    }
    const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return sa.ino !== 0 && sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

/**
 * - `done`: the file was placed at dest
 * - `same`: dest already is this very file (hardlink/symlink/same path)
 * - `exists`: a different file is at dest and the overwrite policy kept it
 */
export type TransferResult = 'done' | 'same' | 'exists';

export async function transfer(
  src: string,
  dest: string,
  mode: TransferMode,
  overwrite: 'never' | 'larger' | 'always',
): Promise<TransferResult> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await exists(dest)) {
    if (await sameFile(src, dest)) return 'same';
    if (overwrite === 'never') return 'exists';
    if (overwrite === 'larger') {
      const [a, b] = await Promise.all([fs.stat(src), fs.stat(dest).catch(() => undefined)]);
      if (b && a.size <= b.size) return 'exists';
    }
    await fs.rm(dest, { force: true });
  }
  switch (mode) {
    case 'hardlink':
      try {
        await fs.link(src, dest);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EXDEV') {
          throw new Error('硬链接失败：源目录与目标目录不在同一个文件系统/分区，请改用复制或移动模式');
        }
        throw e;
      }
      break;
    case 'symlink':
      await fs.symlink(path.resolve(src), dest);
      break;
    case 'copy':
      await fs.copyFile(src, dest);
      break;
    case 'move':
      try {
        await fs.rename(src, dest);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        await fs.copyFile(src, dest);
        await fs.rm(src);
      }
      break;
  }
  return 'done';
}

export async function writeIfMissing(file: string, content: string | Buffer, force = false) {
  if (!force && (await exists(file))) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return true;
}

export { exists };
