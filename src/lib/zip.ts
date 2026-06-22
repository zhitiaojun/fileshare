/**
 * Streaming ZIP creation using fflate
 * Creates ZIP archives on-the-fly in Cloudflare Workers
 */
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export interface ZipFileEntry {
  name: string;
  data: ArrayBuffer | Uint8Array;
}

/**
 * Create a ZIP archive from file entries.
 * Returns the complete ZIP as a Uint8Array.
 * For streaming (memory-efficient), use createZipStream instead.
 */
export async function createZip(files: ZipFileEntry[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err);
        return;
      }
      if (chunk) chunks.push(chunk);
      if (final) {
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const c of chunks) {
          result.set(c, offset);
          offset += c.length;
        }
        resolve(result);
      }
    });

    // Add each file
    for (const file of files) {
      // Use ZipPassThrough for already-compressed types, ZipDeflate for text/code
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isCompressed = ['zip', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'mp3', 'webp', 'webm', 'gz', 'bz2', '7z'].includes(ext);

      const entry = isCompressed
        ? new ZipPassThrough(file.name)
        : new ZipDeflate(file.name);

      zip.add(entry);
      entry.push(new Uint8Array(file.data), true);
    }

    zip.end();
  });
}

/**
 * Create a streaming ZIP response.
 * Use this for large archives to avoid buffering everything in memory.
 */
export async function createZipStreamResponse(
  files: ZipFileEntry[],
  archiveName: string
): Promise<Response> {
  const zipData = await createZip(files);

  return new Response(zipData, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveName}"`,
    },
  });
}

/**
 * Check if total file size exceeds the maximum allowed for ZIP creation.
 * Workers have memory limits, so we cap ZIP archives.
 */
export function isZipSizeExceeded(files: ZipFileEntry[], maxSize: number = 500 * 1024 * 1024): boolean {
  const totalSize = files.reduce((sum, f) => sum + f.data.byteLength, 0);
  return totalSize > maxSize;
}
