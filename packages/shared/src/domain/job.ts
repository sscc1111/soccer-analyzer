import type { VideoType } from "./match";

export type JobType =
  | "analyze_match"         // Full match analysis (legacy single video)
  | "analyze_video"         // Individual video analysis (new: subcollection)
  | "merge_half_analysis"   // Merge first/second half results
  | "recompute_stats"
  | "relabel_and_stats";

export type JobStatus = "queued" | "running" | "done" | "error";

export type JobDoc = {
  matchId: string;
  videoId?: string;
  videoType?: VideoType;
  type: JobType;
  status: JobStatus;
  step: string;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
