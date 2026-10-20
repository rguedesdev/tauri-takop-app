import type { ChapterFolderInfo } from "../../services/tauri";
import { z } from "zod";

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

const chapterTypeSchema = z.enum(["MAIN", "EXTRA", "SPECIAL", "ONESHOT"]);
const batchItemSchema = z.object({
  id: z.string().min(1).max(120),
  path: z.string().min(1).max(4096),
  folderName: z.string().min(1).max(255),
  pageNames: z.array(z.string().min(1).max(255)).max(500),
  chapterNumber: z.string().max(30),
  chapterTitle: z.string().max(180),
  chapterType: chapterTypeSchema,
  included: z.boolean(),
  status: z.enum(["PENDING", "UPLOADING", "PUBLISHING", "COMPLETED", "FAILED", "DUPLICATE"]),
  uploadedCids: z.array(z.string().min(1).max(2048)).max(500).optional(),
  uploadedTelegramPages: z.array(z.string().url().max(2048)).max(500).optional(),
  error: z.string().max(1000).optional(),
}).strict();
const batchQueueSchema = z.object({
  version: z.literal(1), mangaID: z.string().regex(/^[a-f\d]{24}$/i), groupID: z.string().regex(/^[a-f\d]{24}$/i),
  rootFolder: z.string().min(1).max(4096), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  items: z.array(batchItemSchema).max(500),
}).strict();

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
  const result = z.object({
    chapterNumber: z.string().trim().min(1).regex(/^\d+(?:\.\d+)?$/),
    chapterTitle: z.string().trim().min(1).max(180),
    chapterType: chapterTypeSchema,
    pageNames: z.array(z.string().min(1)).min(1),
  }).strict().safeParse({ chapterNumber: item.chapterNumber, chapterTitle: item.chapterTitle, chapterType: item.chapterType, pageNames: item.pageNames });
  if (!result.success) return "Confira o número, título e páginas do capítulo.";
  const chapterNumber = Number(result.data.chapterNumber);
  if (result.data.chapterType === "MAIN" && (!Number.isInteger(chapterNumber) || chapterNumber <= 0)) return "Capítulo principal exige um número inteiro maior que zero.";
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
    const parsed = batchQueueSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const queue = parsed.data as BatchQueue;
    if (queue.mangaID !== mangaID || queue.groupID !== groupID) return null;
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
