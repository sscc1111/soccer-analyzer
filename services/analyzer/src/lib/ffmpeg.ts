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
