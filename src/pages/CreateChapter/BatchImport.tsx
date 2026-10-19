import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { LuFolderOpen, LuPlay, LuRotateCcw, LuTrash2 } from "react-icons/lu";

import { createChapter, getExistingChapterNumbers } from "../../services/graphql";
import { inspectMangaFolder, uploadFolder, type ChapterUploadProgress } from "../../services/tauri";
import {
  createQueueItems,
  duplicateNumbers,
  queueStorageKey,
  restoreQueue,
  validateBatchItem,
  type BatchChapterItem,
  type BatchQueue,
  type ChapterType,
} from "./batch";
import styles from "./createchapter.module.css";

const STATUS_LABELS = {
  PENDING: "Pendente",
  UPLOADING: "Enviando ao IPFS",
  PUBLISHING: "Publicando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  DUPLICATE: "Já cadastrado",
} as const;

interface BatchImportProps { mangaID: string; groupID: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Falha inesperada durante a importação.";
}

export default function BatchImport({ mangaID, groupID }: BatchImportProps) {
  const storageKey = queueStorageKey(mangaID, groupID);
  const [queue, setQueue] = useState<BatchQueue | null>(() => {
    try {
      const restored = restoreQueue(localStorage.getItem(storageKey), mangaID, groupID);
      if (restored) localStorage.setItem(storageKey, JSON.stringify(restored));
      return restored;
    } catch {
      return null;
    }
  });
  const [processing, setProcessing] = useState(false);
  const [pageProgress, setPageProgress] = useState<Record<string, ChapterUploadProgress>>({});
  const [message, setMessage] = useState(queue ? "Uma fila anterior foi restaurada. Capítulos concluídos não serão reenviados." : "");

  const internalDuplicates = useMemo(() => duplicateNumbers(queue?.items ?? []), [queue]);
  const completedCount = queue?.items.filter((item) => item.status === "COMPLETED").length ?? 0;
  const includedCount = queue?.items.filter((item) => item.included).length ?? 0;

  function persist(next: BatchQueue | null) {
    setQueue(next);
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      setMessage("A fila continua ativa, mas o estado local ficou grande demais para ser persistido.");
    }
  }

  async function checkExisting(items: BatchChapterItem[]) {
    const chapterNumbers = await getExistingChapterNumbers(mangaID, groupID);
    const existing = new Set(chapterNumbers.map((chapterNumber) => String(Number(chapterNumber))));
    return items.map((item) => {
      if (item.status === "COMPLETED" || !item.included) return item;
      const exists = item.chapterNumber.trim() && existing.has(String(Number(item.chapterNumber)));
      if (exists) {
        if (item.uploadedCids?.length && item.status === "FAILED") {
          return { ...item, status: "COMPLETED" as const, error: undefined };
        }
        return { ...item, status: "DUPLICATE" as const, error: "Este número já foi publicado por esta scan." };
      }
      return item.status === "DUPLICATE" ? { ...item, status: "PENDING" as const, error: undefined } : item;
    });
  }

  async function selectWorkFolder() {
    if (processing) return;
    if (queue?.items.some((item) => item.status !== "COMPLETED") && !window.confirm("Substituir a fila atual por uma nova pasta de obra?")) return;
    try {
      const selected = await open({ directory: true, multiple: false, title: "Selecione a pasta da obra" });
      if (!selected || typeof selected !== "string") return;
      setMessage("Analisando subpastas e verificando capítulos existentes…");
      const folders = await inspectMangaFolder(selected);
      const items = await checkExisting(createQueueItems(folders));
      const now = new Date().toISOString();
      persist({ version: 1, mangaID, groupID, rootFolder: selected, createdAt: now, updatedAt: now, items });
      setMessage(`${items.length} pasta(s) encontrada(s). Revise os dados antes de iniciar.`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function updateItem(id: string, patch: Partial<BatchChapterItem>) {
    if (!queue || processing) return;
    const items = queue.items.map((item) => item.id === id && item.status !== "COMPLETED"
      ? { ...item, ...patch, status: item.status === "DUPLICATE" || item.status === "FAILED" ? "PENDING" as const : item.status, error: undefined }
      : item);
    persist({ ...queue, updatedAt: new Date().toISOString(), items });
  }

  async function startImport() {
    if (!queue || processing) return;
    setProcessing(true);
    setMessage("Atualizando a verificação de duplicidade…");
    let checkedItems: BatchChapterItem[];
    try {
      checkedItems = await checkExisting(queue.items);
    } catch (error) {
      setMessage(`Não foi possível verificar os capítulos existentes: ${errorMessage(error)}`);
      setProcessing(false);
      return;
    }
    let workingQueue = { ...queue, items: checkedItems, updatedAt: new Date().toISOString() };
    persist(workingQueue);

    const duplicateSet = duplicateNumbers(workingQueue.items);
    const invalid = workingQueue.items.find((item) => item.included
      && item.status !== "COMPLETED"
      && item.status !== "DUPLICATE"
      && (validateBatchItem(item) || duplicateSet.has(String(Number(item.chapterNumber)))));
    if (invalid) {
      setMessage(`Revise “${invalid.folderName}”: ${validateBatchItem(invalid) ?? "há outro item com o mesmo número na fila."}`);
      setProcessing(false);
      return;
    }

    const updateAt = (index: number, patch: Partial<BatchChapterItem>) => {
      const items = workingQueue.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
      workingQueue = { ...workingQueue, items, updatedAt: new Date().toISOString() };
      persist(workingQueue);
    };

    let failed = false;
    for (let index = 0; index < workingQueue.items.length; index += 1) {
      const item = workingQueue.items[index];
      if (!item.included || item.status === "COMPLETED" || item.status === "DUPLICATE") continue;
      try {
        let cids = item.uploadedCids ?? [];
        let telegramPages = item.uploadedTelegramPages ?? [];
        if (!cids.length || telegramPages.length !== cids.length) {
          updateAt(index, { status: "UPLOADING", error: undefined });
          const uploaded = await uploadFolder(item.path, (progress) => setPageProgress((current) => ({ ...current, [item.id]: progress })));
          if (!cids.length) cids = uploaded.map((page) => page.cid);
          telegramPages = uploaded.map((page) => page.telegramUrl);
          if (!cids.length) throw new Error("Nenhuma página válida foi enviada.");
          updateAt(index, { uploadedCids: cids, uploadedTelegramPages: telegramPages, status: "PUBLISHING" });
        } else {
          updateAt(index, { status: "PUBLISHING", error: undefined });
        }
        await createChapter({
          manga: mangaID,
          group: groupID,
          chapterNumber: Number(item.chapterNumber),
          chapterTitle: item.chapterTitle.trim(),
          chapterType: item.chapterType,
          pages: cids,
          telegramPages,
        });
        updateAt(index, { status: "COMPLETED", error: undefined, uploadedCids: cids, uploadedTelegramPages: telegramPages });
      } catch (error) {
        const reason = errorMessage(error);
        const duplicate = /já cadastrou|conflict|duplicate/i.test(reason);
        updateAt(index, { status: duplicate ? "DUPLICATE" : "FAILED", error: reason });
        failed = true;
        break;
      }
    }
    const done = workingQueue.items.filter((item) => item.status === "COMPLETED").length;
    setMessage(failed
      ? `Importação interrompida após ${done} capítulo(s). Corrija a falha e use “Retomar fila”.`
      : `Importação finalizada: ${done} capítulo(s) concluído(s).`);
    setProcessing(false);
  }

  function clearQueue() {
    if (processing || !queue || !window.confirm("Remover o estado local desta fila? Capítulos já publicados não serão apagados.")) return;
    persist(null);
    setMessage("");
  }

  return <section className={styles.batchSection}>
    <div className={styles.batchActions}>
      <button type="button" className={styles.secondaryBtn} onClick={() => void selectWorkFolder()} disabled={processing}><LuFolderOpen />Selecionar pasta da obra</button>
      {queue && <button type="button" className={styles.createBtn} onClick={() => void startImport()} disabled={processing || !includedCount}><LuPlay />{processing ? "Processando…" : completedCount ? "Retomar fila" : "Iniciar importação"}</button>}
      {queue && <button type="button" className={styles.dangerBtn} onClick={clearQueue} disabled={processing}><LuTrash2 />Limpar fila local</button>}
    </div>

    <p className={styles.batchHelp}>A pasta selecionada deve conter uma subpasta por capítulo. As páginas são enviadas pelo mesmo fluxo IPFS do cadastro individual.</p>
    {message && <p className={styles.batchMessage} role="status">{message}</p>}

    {queue && <>
      <div className={styles.queueSummary}>
        <span><strong>Pasta:</strong> {queue.rootFolder}</span>
        <span><strong>Progresso:</strong> {completedCount}/{includedCount} concluídos</span>
      </div>
      <div className={styles.reviewList}>
        {queue.items.map((item) => {
          const duplicateInQueue = item.included && internalDuplicates.has(String(Number(item.chapterNumber)));
          const issue = validateBatchItem(item) ?? (duplicateInQueue ? "Número repetido dentro desta fila." : item.error);
          return <article className={styles.reviewCard} data-status={item.status} key={item.id}>
            <header>
              <label className={styles.includeToggle}><input type="checkbox" checked={item.included} disabled={processing || item.status === "COMPLETED"} onChange={(event) => updateItem(item.id, { included: event.target.checked })} /><span>{item.folderName}</span></label>
              <span className={styles.statusBadge}>{STATUS_LABELS[item.status]}</span>
            </header>
            <div className={styles.reviewFields}>
              <label>Número<input value={item.chapterNumber} inputMode="decimal" disabled={processing || item.status === "COMPLETED" || !item.included} onChange={(event) => updateItem(item.id, { chapterNumber: event.target.value.replace(",", ".") })} /></label>
              <label>Título<input value={item.chapterTitle} disabled={processing || item.status === "COMPLETED" || !item.included} onChange={(event) => updateItem(item.id, { chapterTitle: event.target.value })} /></label>
              <label>Tipo<select value={item.chapterType} disabled={processing || item.status === "COMPLETED" || !item.included} onChange={(event) => updateItem(item.id, { chapterType: event.target.value as ChapterType })}><option value="MAIN">Principal</option><option value="EXTRA">Extra</option><option value="SPECIAL">Especial</option><option value="ONESHOT">Oneshot</option></select></label>
            </div>
            {pageProgress[item.id] && <div className={styles.pageUploadProgress} role="status" aria-live="polite">
              <div className={styles.pageUploadProgressHeader}>
                <span>{pageProgress[item.id].stage === "ipfs" || pageProgress[item.id].stage === "telegram"
                  ? `Enviando imagem ${Math.min(pageProgress[item.id].completed + 1, pageProgress[item.id].total)} de ${pageProgress[item.id].total}: ${pageProgress[item.id].fileName}…`
                  : pageProgress[item.id].stage === "failed"
                    ? `Falha ao enviar ${pageProgress[item.id].fileName}`
                    : `Imagem ${pageProgress[item.id].completed} de ${pageProgress[item.id].total} enviada`}</span>
                <strong>{pageProgress[item.id].total ? Math.floor(pageProgress[item.id].completed / pageProgress[item.id].total * 100) : 0}%</strong>
              </div>
              <div className={styles.uploadProgressTrack} role="progressbar" aria-label={`Progresso de ${item.folderName}`} aria-valuemin={0} aria-valuemax={pageProgress[item.id].total} aria-valuenow={pageProgress[item.id].completed}>
                <span className={styles.uploadProgressFill} style={{ width: `${pageProgress[item.id].total ? pageProgress[item.id].completed / pageProgress[item.id].total * 100 : 0}%` }} />
              </div>
            </div>}
            <footer><span>{item.pageNames.length} página(s): {item.pageNames[0]} → {item.pageNames.at(-1)}</span>{item.uploadedCids?.length ? <span><LuRotateCcw /> CIDs preservados para retomada</span> : null}</footer>
            {issue && <p className={styles.itemError}>{issue}</p>}
          </article>;
        })}
      </div>
    </>}
  </section>;
}
