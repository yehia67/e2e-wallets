import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Joins the clips, in order, into one H.264 mp4. Re-encoded rather than copied so clips of
 * different codecs or sizes (a webm beside an mp4, a popup beside the app) still join; each is
 * fitted into 1280×720 on black.
 */
export async function concatVideos(inputs: readonly string[], output: string, ffmpegPath = 'ffmpeg'): Promise<void> {
  if (inputs.length === 0) throw new Error('No clips to join.');
  const scratch = await mkdtemp(join(dirname(output), 'full-flow-'));
  try {
    const list = join(scratch, 'clips.txt');
    await writeFile(list, inputs.map((file) => `file '${resolve(file).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      output,
    ], { timeout: 600_000, maxBuffer: 1024 * 1024 });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
