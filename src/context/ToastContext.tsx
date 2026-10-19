import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { RiCloseLine, RiErrorWarningLine, RiCheckboxCircleLine, RiInformationLine } from "react-icons/ri";
import styles from "./toast.module.css";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };
type ToastContextValue = { showToast: (message: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 5_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const Icon = toast?.kind === "success" ? RiCheckboxCircleLine : toast?.kind === "error" ? RiErrorWarningLine : RiInformationLine;

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className={`${styles.toast} ${styles[toast.kind]}`} role={toast.kind === "error" ? "alert" : "status"}>
          <span className={styles.icon} aria-hidden="true"><Icon /></span>
          <p>{toast.message}</p>
          <button type="button" aria-label="Fechar notificação" onClick={() => setToast(null)}><RiCloseLine aria-hidden="true" /></button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de ToastProvider.");
  return context;
}
