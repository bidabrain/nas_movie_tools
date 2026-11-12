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

/**
 * Put `src` at `dest` using the given mode. Returns false when the destination
 * exists and the overwrite policy says to keep it.
 */
export async function transfer(
  src: string,
  dest: string,
  mode: TransferMode,
  overwrite: 'never' | 'larger' | 'always',
): Promise<boolean> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await exists(dest)) {
    if (path.resolve(src) === path.resolve(dest)) return false;
    if (overwrite === 'never') return false;
    if (overwrite === 'larger') {
      const [a, b] = await Promise.all([fs.stat(src), fs.stat(dest).catch(() => undefined)]);
      if (b && a.size <= b.size) return false;
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
  return true;
}

export async function writeIfMissing(file: string, content: string | Buffer, force = false) {
  if (!force && (await exists(file))) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return true;
}

export { exists };
