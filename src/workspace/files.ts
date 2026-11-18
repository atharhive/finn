import { open, type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

/** Linux directory-FD anchoring prevents parent-symlink replacement between validation and open. */
export async function withWorkspaceFile<T>(root: string, path: string, writable: boolean | 'create', action: (file: FileHandle, anchoredPath: string) => Promise<T>): Promise<T> {
  const handles: FileHandle[] = [];
  try {
    const parts = path.split('/').filter(p => p && p !== '.');
    const filename = parts.pop(); if (!filename) throw new Error('A file path is required');
    let directory = root;
    if (process.platform === 'linux') {
      let parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(parent);
      for (const part of parts) {
        parent = await open(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(parent);
      }
      directory = `/proc/self/fd/${parent.fd}`;
    } else {
      directory = resolve(root, ...parts);
    }
    const file = await open(`${directory}/${filename}`, (writable === 'create' ? constants.O_RDWR | constants.O_CREAT | constants.O_EXCL : writable ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW ?? 0)); handles.push(file);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Not a regular file or file exceeds limit');
    if (stat.nlink > 1) throw new Error('Hardlink files are forbidden');
    return await action(file, `${directory}/${filename}`);
  } finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
}
