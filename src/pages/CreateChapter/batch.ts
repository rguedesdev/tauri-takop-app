import type { ChapterFolderInfo } from "../../services/tauri";

export type ChapterType = "MAIN" | "EXTRA" | "SPECIAL" | "ONESHOT";
export type BatchStatus = "PENDING" | "UPLOADING" | "PUBLISHING" | "COMPLETED" | "FAILED" | "DUPLICATE";

export interface BatchChapterItem {
  id: string;
  path: string;
  folderName: string;
  pageNames: string[];
  chapterNumber: string;
  chapterTitle: string;
  chapterType: ChapterType;
  included: boolean;
  status: BatchStatus;
  uploadedCids?: string[];
  uploadedTelegramPages?: string[];
  error?: string;
}

export interface BatchQueue {
  version: 1;
  mangaID: string;
  groupID: string;
  rootFolder: string;
  createdAt: string;
  updatedAt: string;
  items: BatchChapterItem[];
}

export function queueStorageKey(mangaID: string, groupID: string) {
  return `tako:chapter-batch:v1:${groupID}:${mangaID}`;
}

function inferNumber(folderName: string) {
  const preferred = folderName.match(/(?:cap(?:í|i)tulo|chapter|ch)[\s._-]*(\d+(?:[.,]\d+)?)/i);
  const match = preferred ?? folderName.match(/\d+(?:[.,]\d+)?/);
  return match ? String(Number((match[1] ?? match[0]).replace(",", "."))) : "";
}

function inferType(folderName: string, chapterNumber: string): ChapterType {
  const normalized = folderName.toLocaleLowerCase();
  if (/one[\s_-]?shot|oneshot/.test(normalized)) return "ONESHOT";
  if (/especial|special/.test(normalized)) return "SPECIAL";
  const number = Number(chapterNumber);
  if (/extra|b[oô]nus|bonus/.test(normalized) || !Number.isInteger(number) || number === 0) return "EXTRA";
  return "MAIN";
}

function inferTitle(folderName: string, chapterNumber: string) {
  const numberPosition = folderName.search(/\d+(?:[.,]\d+)?/);
  const afterNumber = numberPosition >= 0
    ? folderName.slice(numberPosition).replace(/^\d+(?:[.,]\d+)?/, "").replace(/^[\s._–—-]+/, "").trim()
    : "";
  return afterNumber || (chapterNumber ? `Capítulo ${chapterNumber}` : folderName.trim());
}

export function createQueueItems(folders: ChapterFolderInfo[], seed = Date.now()): BatchChapterItem[] {
  return folders.map((folder, index) => {
    const chapterNumber = inferNumber(folder.folderName);
    return {
      id: `${seed}-${index}`,
      path: folder.path,
      folderName: folder.folderName,
      pageNames: folder.pageNames,
      chapterNumber,
      chapterTitle: inferTitle(folder.folderName, chapterNumber),
      chapterType: inferType(folder.folderName, chapterNumber),
      included: true,
      status: "PENDING",
    };
  });
}

export function validateBatchItem(item: BatchChapterItem) {
  if (!item.included || item.status === "COMPLETED" || item.status === "DUPLICATE") return null;
  const chapterNumber = Number(item.chapterNumber);
  if (!item.chapterNumber.trim() || !Number.isFinite(chapterNumber) || chapterNumber < 0) return "Informe um número válido e não negativo.";
  if (item.chapterType === "MAIN" && (!Number.isInteger(chapterNumber) || chapterNumber <= 0)) return "Capítulo principal exige um número inteiro maior que zero.";
  if (!item.chapterTitle.trim()) return "Informe o título do capítulo.";
  if (!item.pageNames.length) return "A pasta não contém páginas suportadas.";
  return null;
}

export function duplicateNumbers(items: BatchChapterItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.included || item.status === "COMPLETED" || !item.chapterNumber.trim()) continue;
    const key = String(Number(item.chapterNumber));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([number]) => number));
}

export function restoreQueue(raw: string | null, mangaID: string, groupID: string): BatchQueue | null {
  if (!raw) return null;
  try {
    const queue = JSON.parse(raw) as BatchQueue;
    if (queue.version !== 1 || queue.mangaID !== mangaID || queue.groupID !== groupID || !Array.isArray(queue.items)) return null;
    return {
      ...queue,
      items: queue.items.map((item) => item.status === "UPLOADING" || item.status === "PUBLISHING"
        ? { ...item, status: "FAILED", error: "Importação interrompida. Retome para continuar." }
        : item),
    };
  } catch {
    return null;
  }
}
