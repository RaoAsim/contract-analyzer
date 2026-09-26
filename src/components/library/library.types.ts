export type UploadItem = {
  localId: string;
  name: string;
  size: number;
  /** 0..1 */
  progress: number;
  state: "waiting" | "uploading" | "processing-handoff" | "error";
  error?: string;
  documentId?: string;
};

export type UploadLimits = { maxUploadMb: number; maxPages: number };
