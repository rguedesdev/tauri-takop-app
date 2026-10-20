import { useCallback, useEffect, useRef, useState } from "react";
import { MdStorage } from "react-icons/md";
import { RiArrowDownSLine, RiArrowUpSLine, RiInformationLine } from "react-icons/ri";
import { useToast } from "../../context/ToastContext";
import { getIpfsStorageStatus, getReaderCollaborationEnabled, getReaderStorageStatus, restartStorageNodes, setReaderCollaborationEnabled, type IpfsStorageStatus, type ReaderStorageStatus } from "../../services/tauri";
import styles from "./storage.module.css";

const MIN_STORAGE_GB = 10.0;
const MIN_READER_STORAGE_GB = 1.0;

function formatBytes(value: number | null) {
  if (value == null) return "Indisponível";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) {
    amount /= 1_024;
    unit += 1;
  }
  return `${amount.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function parseStorageLimit(value: string | null) {
  if (!value) return null;
  const match = value.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|PB|KIB|MIB|GIB|TIB|PIB)?$/i);
  if (!match) return null;
  const unit = (match[2] ?? "B").toUpperCase();
  const units: Record<string, number> = {
    B: 1,
    KB: 1_024,
    MB: 1_048_576,
    GB: 1_073_741_824,
    TB: 1_099_511_627_776,
    PB: 1_125_899_906_842_624,
    KIB: 1_024,
    MIB: 1_048_576,
    GIB: 1_073_741_824,
    TIB: 1_099_511_627_776,
    PIB: 1_125_899_906_842_624,
  };
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount * units[unit] : null;
}

function UsageProgress({ percent, loading, label, valueText, alwaysShowPercent = false }: { percent: number | null; loading: boolean; label: string; valueText: string; alwaysShowPercent?: boolean }) {
  const value = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const state = value >= 90 ? "danger" : value >= 75 ? "warning" : "normal";
  const showPercent = percent != null && (alwaysShowPercent || !loading);
  const displayedPercent = `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelFits, setLabelFits] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    const labelElement = labelRef.current;
    if (!track || !labelElement || !showPercent) {
      setLabelFits(false);
      return;
    }
    const measure = () => {
      const filledWidth = track.clientWidth * value / 100;
      const fits = filledWidth >= labelElement.getBoundingClientRect().width + 16;
      setLabelFits((previous) => previous === fits ? previous : fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [showPercent, value, displayedPercent]);

  const labelPosition = labelFits ? "inside" : "outside";
  return (
    <div ref={trackRef} className={styles.usageTrack} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={loading ? "Consultando…" : valueText} data-state={state} data-label-position={labelPosition}>
      <div className={styles.usageFill} data-state={state} style={{ width: `${value}%` }} />
      {showPercent && <span ref={labelRef} className={styles.usageLabel} style={{ left: labelFits ? 8 : `calc(${value}% + 8px)` }}>{displayedPercent}</span>}
    </div>
  );
}

export default function Storage() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<IpfsStorageStatus | null>(null);
  const [storageGb, setStorageGb] = useState(MIN_STORAGE_GB);
  const [loading, setLoading] = useState(true);
  const [readerCollaboration, setReaderCollaboration] = useState(false);
  const [startupReaderCollaboration, setStartupReaderCollaboration] = useState(false);
  const [readerStatus, setReaderStatus] = useState<ReaderStorageStatus | null>(null);
  const [readerStorageGb, setReaderStorageGb] = useState(MIN_READER_STORAGE_GB);
  const [startupReaderStorageGb, setStartupReaderStorageGb] = useState(MIN_READER_STORAGE_GB);
  const [savingCollaboration, setSavingCollaboration] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [changesSaved, setChangesSaved] = useState(false);
  const [message, setMessage] = useState("");
  const readerStartupLoaded = useRef(false);
  const readerCollaborationRef = useRef(false);
  const refreshRequest = useRef(0);
  const toggleRequest = useRef(false);
  const usedBytes = status?.usedBytes ?? null;
  const maxBytes = parseStorageLimit(status?.effectiveStorageMax ?? null);
  const groupLimitChanged = status != null
    && Math.round(storageGb * 1_073_741_824) !== Math.round(status.configuredStorageGb * 1_073_741_824);
  const storageLimitInTerabytes = storageGb >= 1_024;
  const readerLimitInTerabytes = readerStorageGb >= 1_024;
  const usagePercent = usedBytes != null && maxBytes ? usedBytes / maxBytes * 100 : null;
  const remainingPercent = usagePercent == null ? null : Math.max(0, 100 - usagePercent);
  const readerUsedBytes = readerStatus?.usedBytes ?? 0;
  const readerMaxBytes = Math.max(1, Math.round((readerStatus?.configuredStorageGb ?? readerStorageGb) * 1_073_741_824));
  const readerUsagePercent = Math.min(100, readerUsedBytes / readerMaxBytes * 100);
  const readerSettingsChanged = readerCollaboration !== startupReaderCollaboration
    || Math.round(readerStorageGb * 1_073_741_824) !== Math.round(startupReaderStorageGb * 1_073_741_824);
  const restartRequired = groupLimitChanged || readerSettingsChanged;

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequest.current;
    setLoading(true);
    try {
      const [next, collaborationEnabled, reader] = await Promise.all([getIpfsStorageStatus(), getReaderCollaborationEnabled(), getReaderStorageStatus()]);
      if (requestId !== refreshRequest.current) return;
      setStatus(next);
      readerCollaborationRef.current = collaborationEnabled;
      setReaderCollaboration(collaborationEnabled);
      setReaderStatus(reader);
      setReaderStorageGb(reader.configuredStorageGb);
      if (!readerStartupLoaded.current) {
        setStartupReaderCollaboration(collaborationEnabled);
        setStartupReaderStorageGb(reader.configuredStorageGb);
        readerStartupLoaded.current = true;
      }
      setStorageGb(next.configuredStorageGb);
      setMessage("");
    } catch (error) {
      if (requestId === refreshRequest.current) {
        setMessage(error instanceof Error ? error.message : "Não foi possível consultar o IPFS.");
      }
    } finally {
      if (requestId === refreshRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function toggleReaderCollaboration() {
    if (toggleRequest.current) return;
    toggleRequest.current = true;
    refreshRequest.current += 1;
    const enabled = !readerCollaborationRef.current;
    readerCollaborationRef.current = enabled;
    setChangesSaved(false);
    setReaderCollaboration(enabled);
    setSavingCollaboration(true);
    try {
      await setReaderCollaborationEnabled(enabled);
      setMessage("");
    } catch (error) {
      readerCollaborationRef.current = !enabled;
      setReaderCollaboration(!enabled);
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a colaboração.");
    } finally {
      toggleRequest.current = false;
      setSavingCollaboration(false);
    }
  }

  async function restartNow() {
    setRestarting(true);
    const startedAt = Date.now();
    try {
      await restartStorageNodes(storageGb, readerStorageGb);
      const remainingProgressMs = 2_000 - (Date.now() - startedAt);
      if (remainingProgressMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingProgressMs));
      }
      setStartupReaderCollaboration(readerCollaboration);
      setStartupReaderStorageGb(readerStorageGb);
      await refresh();
      setChangesSaved(true);
      setRestarting(false);
      showToast("Os nós IPFS foram reiniciados e as configurações foram aplicadas.", "success");
    } catch (error) {
      setRestarting(false);
      setMessage(error instanceof Error ? error.message : "Não foi possível reiniciar os nós IPFS.");
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.icon}><MdStorage aria-hidden="true" /></span>
        <div>
          <h1>Armazenamento IPFS</h1>
          <p>Defina quanto espaço você quer disponibilizar para os arquivos dos grupos.</p>
        </div>
      </header>

      <div className={styles.panel}>
        <h2 className={styles.panelTitle}>Armazenamento dos grupos</h2>
        <div className={styles.usage}>
          <div className={styles.usageHeader}>
            <span>Em uso no nó</span>
            <div className={styles.usageValues}>
              <strong>
                {loading
                  ? "Consultando…"
                  : usagePercent == null
                    ? "Não foi possível medir o uso"
                    : `${formatBytes(usedBytes)} de ${formatBytes(maxBytes)}`}
              </strong>
              <strong className={styles.percentage}>{loading || remainingPercent == null ? "—" : `${remainingPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% restante`}</strong>
            </div>
          </div>
          <UsageProgress percent={usagePercent} loading={loading} label="Espaço usado no nó IPFS" valueText={usagePercent == null ? "Uso indisponível" : `${formatBytes(usedBytes)} de ${formatBytes(maxBytes)}`} />
        </div>
        <div className={styles.stats}>
          <div><span>Limite de armazenamento atual</span><strong>{formatBytes(parseStorageLimit(status?.effectiveStorageMax ?? null))}</strong></div>
          <div><span>Espaço mínimo de armazenamento</span><strong>{MIN_STORAGE_GB.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} GB</strong></div>
        </div>

        <div className={styles.field}>
          <label htmlFor="storage-limit">Aumentar limite de armazenamento</label>
          <div className={styles.limitRow}>
            <span className={styles.inputWrap}>
              <span className={styles.numberInput}>
                <MdStorage className={styles.inputIcon} aria-hidden="true" />
                <input key={storageLimitInTerabytes ? "tb" : "gb"} id="storage-limit" type="number" min={storageLimitInTerabytes ? MIN_STORAGE_GB / 1_024 : MIN_STORAGE_GB} step="1" value={storageLimitInTerabytes ? storageGb / 1_024 : storageGb} onChange={(event) => { setChangesSaved(false); setStorageGb(Number(event.target.value) * (storageLimitInTerabytes ? 1_024 : 1)); }} />
                <span className={styles.stepper}>
                  <button type="button" aria-label={`Aumentar limite em 1 ${storageLimitInTerabytes ? "TB" : "GB"}`} onClick={() => { setChangesSaved(false); setStorageGb((value) => value + (storageLimitInTerabytes ? 1_024 : 1)); }}><RiArrowUpSLine /></button>
                  <button type="button" aria-label={`Reduzir limite em 1 ${storageLimitInTerabytes ? "TB" : "GB"}`} disabled={storageGb <= MIN_STORAGE_GB} onClick={() => { setChangesSaved(false); setStorageGb((value) => Math.max(MIN_STORAGE_GB, value - (storageLimitInTerabytes ? 1_024 : 1))); }}><RiArrowDownSLine /></button>
                </span>
              </span>
              <span>{storageLimitInTerabytes ? "TB" : "GB"}</span>
            </span>
            <aside className={styles.info} role="note">
              <RiInformationLine aria-hidden="true" />
              <span>Esse limite é compartilhado entre os grupos deste nó IPFS. O espaço não é reservado antecipadamente: o IPFS ocupa o disco conforme recebe arquivos.</span>
            </aside>
          </div>
        </div>

        {status?.storageError && <p className={styles.startupError} role="alert">Falha ao medir o armazenamento: {status.storageError}</p>}

        {message && <p className={styles.message} role="status">{message}</p>}
      </div>

      <section className={styles.readerPanel} aria-labelledby="reader-collaboration-title">
        <div className={styles.readerHeader}>
          <div className={styles.collaborationCopy}>
            <h2 id="reader-collaboration-title">Armazenamento de colaborador</h2>
          </div>
          <div className={styles.switch}>
            <span>{savingCollaboration ? "Salvando…" : readerCollaboration ? "Ativado" : "Desativado"}</span>
            <button type="button" className={styles.switchControl} role="switch" aria-checked={readerCollaboration} data-active={readerCollaboration} aria-label="Ativar armazenamento voluntário de capítulos lidos" onClick={() => void toggleReaderCollaboration()} disabled={loading || savingCollaboration || (readerStatus != null && readerStatus.configuredStorageGb < MIN_READER_STORAGE_GB)}>
              <span data-active={readerCollaboration} />
            </button>
          </div>
        </div>
        <div className={styles.usage}>
          <div className={styles.usageHeader}>
            <span>Em uso no armazenamento do leitor</span>
            <div className={styles.usageValues}>
              <strong>{formatBytes(readerUsedBytes)} de {formatBytes(readerMaxBytes)}</strong>
              <strong className={styles.percentage}>{Math.max(0, 100 - readerUsagePercent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% restante</strong>
            </div>
          </div>
          <UsageProgress percent={readerUsagePercent} loading={loading} label="Espaço usado no armazenamento do leitor" valueText={`${formatBytes(readerUsedBytes)} de ${formatBytes(readerMaxBytes)}`} alwaysShowPercent />
        </div>
        <div className={styles.readerLimit}>
          <label htmlFor="reader-storage-limit">Limite de armazenamento do leitor</label>
          <div className={styles.readerLimitControls}>
            <span className={styles.inputWrap}>
              <span className={styles.numberInput}>
                <MdStorage className={styles.inputIcon} aria-hidden="true" />
                <input key={readerLimitInTerabytes ? "reader-tb" : "reader-gb"} id="reader-storage-limit" type="number" min={readerLimitInTerabytes ? MIN_READER_STORAGE_GB / 1_024 : MIN_READER_STORAGE_GB} step="1" disabled={!readerCollaboration || loading} value={readerLimitInTerabytes ? readerStorageGb / 1_024 : readerStorageGb} onChange={(event) => { setChangesSaved(false); setReaderStorageGb(Number(event.target.value) * (readerLimitInTerabytes ? 1_024 : 1)); }} />
                <span className={styles.stepper}>
                  <button type="button" aria-label={`Aumentar limite do leitor em 1 ${readerLimitInTerabytes ? "TB" : "GB"}`} disabled={!readerCollaboration || loading} onClick={() => { setChangesSaved(false); setReaderStorageGb((value) => value + (readerLimitInTerabytes ? 1_024 : 1)); }}><RiArrowUpSLine /></button>
                  <button type="button" aria-label={`Reduzir limite do leitor em 1 ${readerLimitInTerabytes ? "TB" : "GB"}`} disabled={!readerCollaboration || loading || readerStorageGb <= MIN_READER_STORAGE_GB} onClick={() => { setChangesSaved(false); setReaderStorageGb((value) => Math.max(MIN_READER_STORAGE_GB, value - (readerLimitInTerabytes ? 1_024 : 1))); }}><RiArrowDownSLine /></button>
                </span>
              </span>
              <span>{readerLimitInTerabytes ? "TB" : "GB"}</span>
            </span>
          </div>
          <aside className={`${styles.info} ${styles.readerInfo}`} role="note">
            <RiInformationLine aria-hidden="true" />
            <span>Este espaço é exclusivo para capítulos lidos como colaborador e separado dos arquivos dos grupos.</span>
          </aside>
        </div>
      </section>
      {restartRequired && !changesSaved && (
        <div className={styles.restartNotice} role="status">
          <span>As alterações de armazenamento serão aplicadas ao reiniciar os nós IPFS. O Takop continuará aberto.</span>
          <button type="button" onClick={() => void restartNow()} disabled={restarting}>
            {restarting ? "Aplicando…" : "Salvar alterações"}
          </button>
        </div>
      )}
      {restarting && (
        <div className={styles.restartModalBackdrop}>
          <div className={styles.restartModal} role="dialog" aria-modal="true" aria-live="polite" aria-label="Reinicialização em andamento">
            <span className={styles.restartSpinner} aria-hidden="true" />
            <p>Salvando alterações...</p>
          </div>
        </div>
      )}
    </section>
  );
}
