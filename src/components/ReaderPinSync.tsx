import { useEffect } from "react";
import {
  acknowledgeReaderPinRequests,
  getReaderPinRequests,
  setReaderNodeOnline,
} from "../services/graphql";
import {
  getReaderCollaborationEnabled,
  isReaderIpfsRunning,
  pinReaderContent,
} from "../services/tauri";

const POLL_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

export default function ReaderPinSync() {
  useEffect(() => {
    let stopped = false;
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    let online = false;
    let presenceCheckRunning = false;
    const failures = new Map<string, { count: number; retryAt: number }>();

    const refreshPresence = async () => {
      if (stopped || presenceCheckRunning) return;
      presenceCheckRunning = true;
      try {
        const token = localStorage.getItem("token");
        const enabled = token ? await getReaderCollaborationEnabled() : false;
        const shouldBeOnline = Boolean(enabled && await isReaderIpfsRunning());
        if (shouldBeOnline) {
          await setReaderNodeOnline(true);
          online = true;
        } else if (online) {
          await setReaderNodeOnline(false);
          online = false;
        }
      } catch (error) {
        console.warn("Falha ao atualizar a presença do nó colaborador.", error);
        if (online) {
          online = false;
          void setReaderNodeOnline(false).catch(() => undefined);
        }
      } finally {
        presenceCheckRunning = false;
      }
    };

    const processQueue = async () => {
      if (stopped) return;
      try {
        if (online) {
          const requests = await getReaderPinRequests();
          const completed: string[] = [];
          for (const request of requests) {
            if (stopped) break;
            const retry = failures.get(request.cid);
            if (retry && retry.retryAt > Date.now()) continue;
            try {
              await pinReaderContent(request.cid, request.telegramUrl);
              completed.push(request.cid);
              failures.delete(request.cid);
            } catch (error) {
              const count = (retry?.count ?? 0) + 1;
              const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(count - 1, 5), RETRY_MAX_MS);
              failures.set(request.cid, { count, retryAt: Date.now() + delay });
              console.warn("Não foi possível fixar a página lida no nó colaborador.", request.cid, error);
            }
          }
          if (completed.length) await acknowledgeReaderPinRequests(completed);
        }
      } catch (error) {
        console.warn("Falha na fila de capítulos do nó colaborador.", error);
      } finally {
        if (!stopped) queueTimer = setTimeout(processQueue, POLL_INTERVAL_MS);
      }
    };

    void refreshPresence();
    void processQueue();
    const heartbeatTimer = setInterval(() => void refreshPresence(), HEARTBEAT_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(heartbeatTimer);
      if (queueTimer) clearTimeout(queueTimer);
      if (online) void setReaderNodeOnline(false).catch(() => undefined);
    };
  }, []);

  return null;
}
