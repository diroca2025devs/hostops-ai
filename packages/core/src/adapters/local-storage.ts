import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage } from '../types';

/** Armazenamento em disco local (MVP). A porta FileStorage permite trocar por S3/GCS sem alterar os serviços. */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Chave de armazenamento inválida.');
    return full;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
