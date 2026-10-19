import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ChapterUploadProgress {
  completed: number;
  total: number;
  fileName: string;
  stage: "ipfs" | "telegram" | "completed" | "failed";
  error: string | null;
}

export interface ChapterFolderInfo {
  path: string;
  folderName: string;
  pageNames: string[];
}

export interface IpfsStorageStatus {
  configuredStorageGb: number;
  effectiveStorageMax: string | null;
  usedBytes: number | null;
  storageError: string | null;
}

export function getIpfsStorageStatus() {
  return invoke<IpfsStorageStatus>("get_ipfs_storage_status");
}

export function setIpfsStorageLimit(storageGb: number) {
  return invoke<number>("set_ipfs_storage_limit", { storageGb });
}

export function getReaderCollaborationEnabled() { return invoke<boolean>("get_reader_collaboration_enabled"); }
export function setReaderCollaborationEnabled(enabled: boolean) { return invoke<boolean>("set_reader_collaboration_enabled", { enabled }); }

export interface ReaderStorageStatus { enabled: boolean; running: boolean; configuredStorageGb: number; usedBytes: number; }
export function getReaderStorageStatus() { return invoke<ReaderStorageStatus>("get_reader_storage_status"); }
export function setReaderStorageLimit(storageGb: number) { return invoke<number>("set_reader_storage_limit", { storageGb }); }
export function isReaderIpfsRunning() { return invoke<boolean>("is_reader_ipfs_running"); }
export function pinReaderContent(cid: string, telegramUrl?: string | null) {
  return invoke<void>("pin_reader_content", { cid, telegramUrl: telegramUrl ?? null });
}
export function restartStorageNodes(groupStorageGb: number, readerStorageGb: number) {
  return invoke<void>("restart_storage_nodes", { groupStorageGb, readerStorageGb });
}

export async function uploadFolder(folder: string, onProgress?: (progress: ChapterUploadProgress) => void) {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Faça login novamente para publicar o capítulo.");
  const unlisten = await listen<ChapterUploadProgress>("chapter-upload-progress", (event) => onProgress?.(event.payload));
  try {
    return await invoke<
      {
        name: string;
        cid: string;
        telegramUrl: string;
      }[]
    >("upload_folder_to_ipfs", {
      folder,
      apiUrl: "http://localhost:5000",
      authToken: token,
    });
  } finally {
    unlisten();
  }
}

export async function inspectMangaFolder(folder: string) {
  return invoke<ChapterFolderInfo[]>("inspect_manga_folder", { folder });
}
