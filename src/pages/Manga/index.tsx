// Imports Principais
import { useEffect, useState, type FormEvent } from "react";

// Requisições GraphQL
import { discardImage, getMangaChapters, getGroup, getMe, updateGroupManga, uploadImage, type Chapter, type Manga as MangaData, type UploadedMedia } from "../../services/graphql";

// Style Sheet CSS
import styles from "./manga.module.css";

// Icones
import { BiHash } from "react-icons/bi";
import { ImPlus } from "react-icons/im";
import { FiEdit2 } from "react-icons/fi";

// Imagens Estáticas
import MangaPlaceholder from "../../assets/manga-placeholder.svg";
import { useObjectUrl } from "../../hooks/useObjectUrl";

interface MangaProps { mangaId: string; groupId: string; onCreateChapter: (mangaID: string) => void }
function Manga({ mangaId, groupId, onCreateChapter }: MangaProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Estado para guardar o manga específico filtrado do grupo
  const [manga, setManga] = useState<MangaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const coverPreview = useObjectUrl(cover);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        // Dispara os capítulos e os dados do grupo em paralelo
        const [chaptersData, groupData, user] = await Promise.all([
          getMangaChapters(mangaId, groupId),
          getGroup(groupId), // Reaproveitando sua query existente
          getMe(),
        ]);

        setChapters(chaptersData || []);

        // Filtra o manga certo dentro da lista do grupo usando o mangaId
        if (groupData && groupData.mangas) {
          const currentManga = groupData.mangas.find(
            (item) => item.id === mangaId,
          );
          setManga(currentManga ?? null);
          setDescription(currentManga?.description ?? "");
          setCanEdit(groupData.ownerID === user.id);
        }
      } catch (e) {
        console.error("Erro ao buscar dados no front:", e);
        setChapters([]);
        setManga(null);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [mangaId, groupId]);

  function cancelEdit() {
    setEditing(false);
    setCover(null);
    setDescription(manga?.description ?? "");
    setMessage("");
  }

  async function saveManga(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    let uploaded: UploadedMedia | null = null;
    try {
      if (cover) uploaded = await uploadImage(cover, "MANGA_COVER");
      await updateGroupManga(groupId, mangaId, {
        description: description.trim(),
        ...(uploaded ? { mangaCoverID: uploaded.id } : {}),
      });
      const group = await getGroup(groupId);
      const updatedManga = group.mangas?.find((item) => item.id === mangaId) ?? null;
      setManga(updatedManga);
      setDescription(updatedManga?.description ?? "");
      setCover(null);
      setEditing(false);
      setMessage("Informações do manga atualizadas.");
    } catch (error) {
      if (uploaded) await discardImage(uploaded.id).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div>Loading...</div>;

  // Erro de parâmetro vindo do App.tsx
  if (!mangaId || !groupId) {
    return (
      <div>
        {/* <button onClick={back}>Voltar</button> */}
        <h2 style={{ color: "red" }}>Erro de Parâmetro no React:</h2>
        <p>
          mangaId recebido: <strong>{String(mangaId)}</strong>
        </p>
        <p>
          groupId recebido: <strong>{String(groupId)}</strong>
        </p>
        <p>Verifique o estado do componente pai (App.tsx).</p>
      </div>
    );
  }

  // Se o grupo carregou mas o ID do manga não existe dentro dele
  if (!manga) {
    return (
      <div>
        {/* <button onClick={back}>Voltar</button> */}
        <h2>Manga não encontrado neste grupo.</h2>
      </div>
    );
  }

  return (
    <div className={styles.mangaPage}>
      <div className={styles.mangaContainer}>
        <header className={styles.mangaHeader}>
          <img
            className={styles.mangaCover}
              src={manga.mangaCover || MangaPlaceholder}
            alt="Manga Cover"
          />
          <div className={styles.mangaHeaderTexts}>
            {/* Exibe o título real vindo do grupo */}
            <h1 className={styles.mangaTitle}>{manga.title}{manga.isAdult ? " · +18" : ""}</h1>

            <p className={styles.mangaDescription}>{manga.description}</p>

            {/* Exibe o mangaká real vindo do grupo */}
            <p>Mangaka: {manga.mangaka}</p>
          </div>
          {canEdit && !editing && <button type="button" className={styles.editMangaButton} onClick={() => { setDescription(manga.description); setMessage(""); setEditing(true); }}><FiEdit2 size={16} />Editar informações</button>}
        </header>
        {editing && <form className={styles.editMangaForm} onSubmit={(event) => void saveManga(event)}>
          <h2>Editar informações do manga</h2>
          <label className={styles.descriptionField}>Descrição<textarea required minLength={120} maxLength={600} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className={styles.coverField}><span>Capa</span><label className={styles.coverPicker}>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
            {(coverPreview || manga.mangaCover) ? <img src={coverPreview || manga.mangaCover || ""} alt="Prévia da capa" /> : <span className={styles.coverPickerEmpty}><strong>Selecionar capa</strong><small>JPG, PNG ou WebP</small></span>}
            {(coverPreview || manga.mangaCover) && <span className={styles.coverPickerAction}>Trocar capa</span>}
          </label><small>A nova capa será enviada ao salvar.</small></div>
          <div className={styles.editActions}><button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</button><button type="button" className={styles.cancelEditButton} disabled={saving} onClick={cancelEdit}>Cancelar</button></div>
        </form>}
        {message && <p className={styles.editMessage} role="status">{message}</p>}
        {/* <button className={styles.backBtn} onClick={back} disabled={loading}>
          Voltar
        </button> */}

        <hr className={styles.hrFaded} />

        <h1 className={styles.chaptersTitle}>Capítulos Traduzidos</h1>

        {chapters && chapters.length ? (
          chapters.map((c) => (
            <div className={styles.chapterCard} key={c.id}>
              <BiHash size={20} />
              <span>
                Capítulo {c.chapterNumber} • {c.chapterTitle}
              </span>
            </div>
          ))
        ) : (
          <div>Nenhum capítulo ainda.</div>
        )}

        <button
          className={styles.createChapterBtn}
          onClick={() => onCreateChapter(mangaId)}
        >
          <ImPlus size={16} />
          <span>Criar capítulo</span>
        </button>
      </div>
    </div>
  );
}

export default Manga;
