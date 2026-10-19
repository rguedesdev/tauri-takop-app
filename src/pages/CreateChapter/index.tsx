// Imports Principais
import { useState } from "react";
import { uploadFolder } from "../../services/tauri";
import { useToast } from "../../context/ToastContext";
import { open } from "@tauri-apps/plugin-dialog"; // 👈 Importa o gerenciador de janelas nativas

// Requisições GraphQL
import { createChapter } from "../../services/graphql";

// Style Sheet CSS
import styles from "./createchapter.module.css";
import { MdTitle } from "react-icons/md";
import { BiHash } from "react-icons/bi";
import { LuFolderOpen } from "react-icons/lu";
import BatchImport from "./BatchImport";

interface CreateChapterProps { mangaID: string; groupID: string; back: () => void }

function CreateChapter({ mangaID, groupID, back }: CreateChapterProps) {
  const { showToast } = useToast();
  const [folder, setFolder] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterType, setChapterType] = useState<"MAIN" | "EXTRA" | "SPECIAL" | "ONESHOT">("MAIN");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number; fileName: string; stage: string } | null>(null);
  const [operationMessage, setOperationMessage] = useState("");
  const [operationError, setOperationError] = useState("");
  const [mode, setMode] = useState<"single" | "batch">("single");

  // 👈 Função para abrir a janela nativa de seleção de pasta
  async function handleSelectFolder() {
    try {
      const selected = await open({
        directory: true, // 👈 Força a selecionar apenas pastas, não arquivos individuais
        multiple: false, // Não precisa selecionar mais de uma pasta por vez
        title: "Selecione a pasta do capítulo",
      });

      // Se o usuário não cancelou a janela, joga o caminho no estado 'folder'
      if (selected && typeof selected === "string") {
        setFolder(selected);
      }
    } catch (err) {
      console.error("Erro ao abrir seletor de pastas:", err);
    }
  }

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!folder || !chapterNumber || !chapterTitle) {
      showToast("Preencha todos os campos!", "info");
      return;
    }

    setLoading(true);
    setUploadProgress(null);
    setOperationError("");
    setOperationMessage("Preparando o envio do capítulo…");
    let stage = "enviar as páginas para IPFS e Telegram";
    try {
      const uploaded = await uploadFolder(folder, (progress) => {
        setUploadProgress(progress);
        const currentImage = progress.stage === "completed"
          ? progress.completed
          : Math.min(progress.completed + 1, progress.total);
        const message = progress.stage === "completed"
          ? `Imagem ${currentImage} de ${progress.total} enviada.`
          : progress.stage === "failed"
            ? `Falha ao enviar imagem ${currentImage}: ${progress.fileName}.`
            : `Enviando imagem ${currentImage} de ${progress.total}: ${progress.fileName}…`;
        setOperationMessage(message);
      });

      stage = "publicar o capítulo no backend";
      setOperationMessage("Páginas enviadas. Publicando capítulo no banco de dados…");
      await createChapter({
        manga: mangaID,
        group: groupID,
        chapterNumber: Number(chapterNumber),
        chapterTitle: chapterTitle,
        chapterType,
        pages: uploaded.map((x) => x.cid),
        telegramPages: uploaded.map((x) => x.telegramUrl),
      });
      showToast("Capítulo criado com sucesso!", "success");
      back();
    } catch (e) {
      console.error(`Falha ao ${stage}:`, e);
      const reason = e instanceof Error ? e.message : typeof e === "string" ? e : "Falha inesperada.";
      setOperationError(`Falha ao ${stage}: ${reason}`);
      setOperationMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.createChapterPage}>
      <div className={styles.createChapterContainer}>
        {/* <button className={styles.backBtn} onClick={back} disabled={loading}>
          Voltar
        </button> */}

        <h1 className={styles.createChapterTitle}>Criar Capítulo</h1>

        <div className={styles.modeTabs} role="tablist" aria-label="Modo de publicação">
          <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? styles.activeTab : ""} onClick={() => setMode("single")} disabled={loading}>Capítulo individual</button>
          <button type="button" role="tab" aria-selected={mode === "batch"} className={mode === "batch" ? styles.activeTab : ""} onClick={() => setMode("batch")} disabled={loading}>Importar pasta da obra</button>
        </div>

        {mode === "single" ? <form className={styles.createChapterForm} onSubmit={handleSend}>
          <div className={styles.inputsContainer}>
            <div className={styles.inputsLineOne}>
              <div className={styles.fieldWrapper}>
                <label className={styles.fieldLabel}>Título</label>
                <div className={styles.inputRelativeContainer}>
                  <input
                    className={styles.createChapterInput}
                    type="text"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder="Título do capítulo"
                    disabled={loading}
                  />
                  <div className={styles.iconContainer}>
                    <MdTitle size={20} />
                  </div>
                </div>
                <p className={styles.helpText}>Error Senha</p>
              </div>

              <div className={styles.fieldWrapper}>
                <label className={styles.fieldLabel}>Capitulo Nº</label>
                <div className={styles.inputRelativeContainer}>
                  <input
                    className={styles.createChapterInput}
                    type="text"
                    value={chapterNumber}
                    onChange={(e) => setChapterNumber(e.target.value)}
                    placeholder="Exemplo: 09"
                    disabled={loading}
                  />
                  <div className={styles.iconContainer}>
                    <BiHash size={20} />
                  </div>
                </div>
                <p className={styles.helpText}>Error Username</p>
              </div>
            </div>

            <div className={styles.fieldWrapper}>
              <label className={styles.fieldLabel}>Tipo do capítulo</label>
              <select className={styles.createChapterInput} value={chapterType} onChange={(event) => setChapterType(event.target.value as typeof chapterType)} disabled={loading}>
                <option value="MAIN">Principal</option>
                <option value="EXTRA">Extra</option>
                <option value="SPECIAL">Especial</option>
                <option value="ONESHOT">Oneshot</option>
              </select>
              <p className={styles.helpText}>Somente capítulos principais inteiros avançam o progresso.</p>
            </div>

            <div className={styles.fieldWrapper}>
              <label className={styles.fieldLabel}>Caminho das Páginas</label>
              <div className={styles.folderPicker}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleSelectFolder}
                  disabled={loading}
                >
                  <LuFolderOpen />
                  {folder ? "Alterar pasta do capítulo" : "Selecionar pasta do capítulo"}
                </button>
                {folder && <span className={styles.selectedFolder} title={folder}>{folder}</span>}
              </div>
              <p className={styles.helpText}>
                Selecione a pasta onde estão as imagens do capítulo
              </p>
            </div>
          </div>

          <button className={styles.createBtn} disabled={loading}>
            {loading ? "Salvando capítulo…" : "Criar capítulo"}
          </button>
          {loading && <div className={styles.uploadFeedback} role="status" aria-live="polite">
            <strong>{operationMessage || "Salvando capítulo…"}</strong>
            <div className={styles.uploadProgressTrack} role="progressbar" aria-label="Progresso do envio das páginas" aria-valuemin={0} aria-valuemax={uploadProgress?.total ?? 100} aria-valuenow={uploadProgress ? uploadProgress.completed : undefined} aria-valuetext={operationMessage}>
              {uploadProgress && <span className={styles.uploadProgressFill} style={{ width: `${uploadProgress.total ? uploadProgress.completed / uploadProgress.total * 100 : 0}%` }} />}
            </div>
            {uploadProgress && <small className={styles.uploadProgressMeta}>
              <span>{uploadProgress.completed} de {uploadProgress.total} imagens enviadas</span>
              <strong>{uploadProgress.total ? Math.floor(uploadProgress.completed / uploadProgress.total * 100) : 0}%</strong>
            </small>}
          </div>}
          {operationError && <p className={styles.uploadError} role="alert">{operationError}</p>}
        </form> : <BatchImport mangaID={mangaID} groupID={groupID} />}
      </div>
    </div>
  );
}

export default CreateChapter;
