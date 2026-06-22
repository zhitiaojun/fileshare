/**
 * Folder upload using File System Access API
 * Recursively traverses directories and collects file entries
 */
import { ref } from 'vue';

export interface FileEntry {
  file: File;
  relativePath: string;
}

export function useFolderUpload() {
  const files = ref<FileEntry[]>([]);
  const loading = ref(false);
  const folderName = ref('');

  /** Pick a folder using the File System Access API */
  async function pickFolder(): Promise<FileEntry[]> {
    loading.value = true;
    try {
      // @ts-expect-error - File System Access API
      const handle = await window.showDirectoryPicker();
      folderName.value = handle.name;
      const entries = await traverseDirectory(handle, '');
      files.value = entries;
      return entries;
    } finally {
      loading.value = false;
    }
  }

  /** Extract files from a drag-and-drop folder */
  async function fromDrop(dataTransfer: DataTransfer): Promise<FileEntry[]> {
    loading.value = true;
    try {
      const items = dataTransfer.items;
      const entries: FileEntry[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;

        const entry = item.webkitGetAsEntry?.();
        if (!entry) {
          const file = item.getAsFile();
          if (file) entries.push({ file, relativePath: file.name });
          continue;
        }

        if (entry.isFile) {
          const file = item.getAsFile();
          if (file) entries.push({ file, relativePath: file.name });
        } else if (entry.isDirectory) {
          const dirEntries = await readDirectoryEntry(entry as any, entry.name);
          entries.push(...dirEntries);
        }
      }

      if (entries.length > 0 && !folderName.value) {
        const firstPath = entries[0].relativePath;
        folderName.value = firstPath.split('/')[0] || 'folder';
      }

      files.value = entries;
      return entries;
    } finally {
      loading.value = false;
    }
  }

  function buildManifest(entries: FileEntry[]): string {
    const tree: any = { name: folderName.value || 'folder', type: 'folder', children: [] };
    for (const entry of entries) {
      const parts = entry.relativePath.split('/');
      let current = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        let child = current.children.find((c: any) => c.name === parts[i] && c.type === 'folder');
        if (!child) {
          child = { name: parts[i], type: 'folder', children: [] };
          current.children.push(child);
        }
        current = child;
      }
      current.children.push({
        name: parts[parts.length - 1],
        type: 'file',
        path: entry.relativePath,
        size: entry.file.size,
      });
    }
    // Add total counts
    const countFiles = (node: any): number => {
      if (node.type === 'file') return 1;
      return (node.children || []).reduce((sum: number, c: any) => sum + countFiles(c), 0);
    };
    tree.totalFiles = countFiles(tree);
    return JSON.stringify(tree);
  }

  return { files, loading, folderName, pickFolder, fromDrop, buildManifest };
}

async function traverseDirectory(
  dirHandle: any,
  path: string
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      entries.push({ file, relativePath: entryPath });
    } else {
      const subEntries = await traverseDirectory(handle, entryPath);
      entries.push(...subEntries);
    }
  }
  return entries;
}

async function readDirectoryEntry(
  dirEntry: any,
  path: string
): Promise<FileEntry[]> {
  return new Promise((resolve) => {
    dirEntry.createReader().readEntries(async (subEntries: any[]) => {
      const results: FileEntry[] = [];
      for (const entry of subEntries) {
        if (entry.isFile) {
          const file = await new Promise<File>((res) => entry.file(res));
          results.push({ file, relativePath: path + '/' + entry.name });
        } else if (entry.isDirectory) {
          const sub = await readDirectoryEntry(entry, path + '/' + entry.name);
          results.push(...sub);
        }
      }
      resolve(results);
    });
  });
}
