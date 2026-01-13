import { spawn } from "node:child_process";

type CommandResult = { stdout: string; stderr: string };

function runCommand(cmd: string, args: string[], options?: { cwd?: string }) {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options?.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

function runCommandBinary(cmd: string, args: string[], options?: { cwd?: string }) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options?.cwd });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (data) => {
      chunks.push(Buffer.from(data));
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      return reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

export async function probeVideo(filePath: string) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    filePath,
  ]);
  const data = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const stream = data.streams?.[0];
  const duration = Number(data.format?.duration ?? 0);
  const fps = parseFps(stream?.r_frame_rate);
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
    fps: fps ?? 0,
  };
}

function parseFps(rate?: string) {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map((v) => Number(v));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

export async function detectSceneCuts(filePath: string, threshold = 0.35) {
  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    filePath,
    "-vf",
    `select='gt(scene,${threshold})',showinfo`,
    "-f",
    "null",
    "-",
  ]);
  const matches = stderr.match(/pts_time:([0-9.]+)/g) ?? [];
  const times = matches
    .map((entry) => Number(entry.replace("pts_time:", "")))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  return Array.from(new Set(times));
}

export async function extractThumbnail(inputPath: string, tSec: number, outputPath: string) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-ss",
    tSec.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}

export async function extractClip(inputPath: string, t0: number, t1: number, outputPath: string) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-ss",
    t0.toFixed(3),
    "-to",
    t1.toFixed(3),
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function makeProxyVideo(inputPath: string, outputPath: string) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale='min(426,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-an",
    outputPath,
  ]);
}

export async function getMotionScores(inputPath: string, fps = 1) {
  const width = 64;
  const height = 36;
  const raw = await runCommandBinary("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-vf",
    `fps=${fps},scale=${width}:${height},format=gray`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-",
  ]);
  const frameSize = width * height;
  const frameCount = Math.floor(raw.length / frameSize);
  const scores: { t: number; score: number }[] = [];
  if (frameCount < 2) return { fps, scores };

  for (let i = 1; i < frameCount; i += 1) {
    const offset = i * frameSize;
    const prevOffset = (i - 1) * frameSize;
    let diffSum = 0;
    for (let j = 0; j < frameSize; j += 1) {
      diffSum += Math.abs(raw[offset + j] - raw[prevOffset + j]);
    }
    const score = diffSum / (frameSize * 255);
    scores.push({ t: i / fps, score });
  }
  return { fps, scores };
}

/**
 * Extract frames from video at specified FPS
 * Useful for player/ball detection pipelines
 *
 * @param inputPath - Path to input video
 * @param outputDir - Directory to save extracted frames
 * @param fps - Frames per second to extract (default: 5)
 * @param startTime - Start time in seconds (optional)
 * @param endTime - End time in seconds (optional)
 * @returns Array of extracted frame paths
 */
export async function extractFrames(
  inputPath: string,
  outputDir: string,
  fps = 5,
  startTime?: number,
  endTime?: number
): Promise<string[]> {
  const args: string[] = ["-hide_banner", "-y"];

  // Add time range if specified
  if (startTime !== undefined) {
    args.push("-ss", startTime.toFixed(3));
  }

  args.push("-i", inputPath);

  if (endTime !== undefined && startTime !== undefined) {
    args.push("-t", (endTime - startTime).toFixed(3));
  }

  // Extract frames at specified FPS
  args.push(
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "3", // Quality (2 = highest, 31 = lowest)
    `${outputDir}/frame_%06d.jpg`
  );

  await runCommand("ffmpeg", args);

  // List extracted frames
  const { stdout } = await runCommand("ls", ["-1", outputDir]);
  const frames = stdout
    .split("\n")
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => `${outputDir}/${f}`);

  return frames;
}

/**
 * Extract a single frame as raw RGB buffer
 * Useful for in-memory processing without disk I/O
 *
 * @param inputPath - Path to input video
 * @param timestamp - Timestamp in seconds
 * @param width - Output width (default: original)
 * @param height - Output height (default: original)
 * @returns RGB buffer and dimensions
 */
export async function extractFrameBuffer(
  inputPath: string,
  timestamp: number,
  width?: number,
  height?: number
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const scaleFilter = width && height ? `scale=${width}:${height}` : "";
  const vfFilters = scaleFilter ? scaleFilter : "null";

  const buffer = await runCommandBinary("ffmpeg", [
    "-hide_banner",
    "-ss",
    timestamp.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    vfFilters,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);

  // Get dimensions from video probe if not specified
  if (!width || !height) {
    const probe = await probeVideo(inputPath);
    return { buffer, width: probe.width, height: probe.height };
  }

  return { buffer, width, height };
}

/**
 * Extract multiple frames as raw buffers for batch processing
 * Returns an async generator for memory efficiency
 *
 * @param inputPath - Path to input video
 * @param timestamps - Array of timestamps in seconds
 * @param width - Output width (optional)
 * @param height - Output height (optional)
 */
export async function* extractFrameBuffers(
  inputPath: string,
  timestamps: number[],
  width?: number,
  height?: number
): AsyncGenerator<{
  timestamp: number;
  buffer: Buffer;
  width: number;
  height: number;
}> {
  for (const timestamp of timestamps) {
    const frame = await extractFrameBuffer(inputPath, timestamp, width, height);
    yield { timestamp, ...frame };
  }
}

export async function getAudioLevels(inputPath: string, fps = 1) {
  const samplesPerFrame = Math.max(1, Math.floor(44100 / fps));
  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    `asetnsamples=n=${samplesPerFrame}:p=0,astats=metadata=1:reset=1`,
    "-f",
    "null",
    "-",
  ]);

  const levels: { t: number; rmsDb: number; score: number }[] = [];
  const lines = stderr.split("\n");
  let currentTime: number | null = null;
  for (const line of lines) {
    if (line.includes("pts_time:")) {
      const match = line.match(/pts_time:([0-9.]+)/);
      if (match) currentTime = Number(match[1]);
      continue;
    }
    if (line.includes("RMS_level")) {
      const match = line.match(/RMS_level=([-0-9.]+|inf|-inf)/);
      if (!match) continue;
      if (currentTime === null) continue;
      const value = match[1];
      const rmsDb = value === "-inf" || value === "inf" ? -100 : Number(value);
      const score = Math.min(1, Math.max(0, Math.pow(10, rmsDb / 20)));
      levels.push({ t: currentTime, rmsDb, score });
    }
  }
  return levels;
}
