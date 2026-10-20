import { useEffect, useState } from "react";

import {
  addMangaToGroup,
  createManga,
  discardImage,
  getJikanManga,
  getMe,
  linkMangaExternalMetadata,
  searchJikanMangas,
  searchMangas,
  setTranslationStatusOverride,
  syncMangaExternalMetadata,
  updateManga,
  uploadImage,
  type Group,
  type JikanMangaCandidate,
  type Manga,
  type Trackers,
  type TranslationStatus,
  type UploadedMedia,
} from "../../services/graphql";
import styles from "../admin.module.css";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { catalogMangaSchema } from "../../shared/validation";

type TrackerForm = Required<Record<keyof Trackers, string>>;
const EMPTY_TRACKERS: TrackerForm = { myanimelist: "", anilist: "", animeplanet: "", anidb: "" };

function trackerForm(values?: Trackers | null): TrackerForm {
  return Object.fromEntries(
    Object.keys(EMPTY_TRACKERS).map((key) => [key, values?.[key as keyof Trackers] ?? ""]),
  ) as TrackerForm;
}

export default function Catalog({ initialGroupID }: { initialGroupID?: string }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupID, setGroupID] = useState(initialGroupID ?? "");
  const [title, setTitle] = useState("");
  const [results, setResults] = useState<Manga[]>([]);
  const [jikanResults, setJikanResults] = useState<JikanMangaCandidate[]>([]);
  const [externalState, setExternalState] = useState<"idle" | "loading" | "results" | "empty" | "error">("idle");
  const [localBypassed, setLocalBypassed] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [selectedMalId, setSelectedMalId] = useState<number | null>(null);
  const [translationLanguage, setTranslationLanguage] = useState("Português");
  const [searching, setSearching] = useState(false);
  const [loadingJikanDetails, setLoadingJikanDetails] = useState(false);
  const [editing, setEditing] = useState<Manga | null>(null);
  const [form, setForm] = useState({ description: "", mangaka: "", genders: "", aliases: "", isAdult: false });
  const [demographicOptions, setDemographicOptions] = useState<string[]>([]);
  const [selectedDemographics, setSelectedDemographics] = useState<string[]>([]);
  const [trackers, setTrackers] = useState<TrackerForm>(EMPTY_TRACKERS);
  const [cover, setCover] = useState<File | null>(null);
  const coverPreview = useObjectUrl(cover);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isAegis, setIsAegis] = useState(false);
  const selectedGroup = groups.find((group) => group.id === groupID);

  async function reloadGroups() {
    const user = await getMe();
    setGroups(user.groups ?? []);
  }

  useEffect(() => {
    getMe().then((user) => {
      setGroups(user.groups ?? []);
      setGroupID(initialGroupID ?? "");
      setIsAegis(user.accountType === "AEGIS");
    }).catch((error: Error) => setMessage(error.message));
  }, [initialGroupID]);

  useEffect(() => {
    let cancelled = false;
    if (title.trim().length < 2) {
      setSearching(false);
      setExternalState("idle");
      return () => { cancelled = true; };
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      let externalAttempted = false;
      try {
        const local = await searchMangas(title);
        if (cancelled) return;
        setResults(local);
        if (local.length && !localBypassed) {
          setJikanResults([]);
          setExternalState("idle");
          if (!editing) {
            setSelectedMalId(null);
            setManualMode(false);
          }
        } else {
          externalAttempted = true;
          setExternalState("loading");
          const external = await searchJikanMangas(title);
          if (cancelled) return;
          setJikanResults(external);
          setExternalState(external.length ? "results" : "empty");
        }
      }
      catch (error) {
        if (cancelled) return;
        setJikanResults([]);
        setExternalState(externalAttempted ? "error" : "idle");
        setMessage(error instanceof Error ? `${externalAttempted ? "Consulta externa indisponível" : "Falha ao consultar o catálogo local"}: ${error.message}` : "Falha na busca.");
      }
      finally { if (!cancelled) setSearching(false); }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [title, localBypassed, searchNonce, editing]);

  async function handleUseExisting(id: string) {
    if (!groupID) return setMessage("Selecione um grupo.");
    setBusy(true);
    try {
      await addMangaToGroup(id, groupID, translationLanguage);
      await reloadGroups();
      setMessage("Manga relacionado ao grupo sem criar uma cópia.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao relacionar.");
    } finally { setBusy(false); }
  }

  function beginEdit(manga: Manga) {
    setEditing(manga);
    setTitle(manga.title);
    setForm({ description: manga.description, mangaka: manga.mangaka, genders: manga.genders.join(", "), aliases: manga.aliases.join(", "), isAdult: manga.isAdult });
    setDemographicOptions(manga.demographics ?? []);
    setSelectedDemographics(manga.demographics ?? []);
    setTrackers(trackerForm(manga.trackers));
    setSelectedMalId(manga.externalMetadata?.malId ?? null);
    setManualMode(false);
    setLocalBypassed(!manga.externalMetadata?.malId);
    setCover(null);
  }

  async function selectJikan(candidate: JikanMangaCandidate) {
    setBusy(true);
    setLoadingJikanDetails(true);
    try {
      const selected = !candidate.synopsis || !candidate.authors.length || !candidate.genres.length || !candidate.demographics.length
        ? await getJikanManga(candidate.malId)
        : candidate;
      setSelectedMalId(selected.malId);
      setManualMode(false);
      setTitle(candidate.title);
      setForm({ description: selected.synopsis?.slice(0, 600) ?? "", mangaka: selected.authors.join(", "), genders: selected.genres.join(", "), aliases: selected.aliases.join(", "), isAdult: false });
      setDemographicOptions(selected.demographics ?? []);
      setSelectedDemographics([]);
      setTrackers((current) => ({ ...current, myanimelist: selected.malUrl ?? `https://myanimelist.net/manga/${selected.malId}` }));
      setJikanResults([selected]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar os detalhes da obra.");
    } finally {
      setBusy(false);
      setLoadingJikanDetails(false);
    }
  }

  function startManualRegistration() {
    setManualMode(true);
    setSelectedMalId(null);
    setForm({ description: "", mangaka: "", genders: "", aliases: "", isAdult: false });
    setDemographicOptions([]);
    setSelectedDemographics([]);
    setTrackers(EMPTY_TRACKERS);
    setCover(null);
  }

  async function changeOverride(group: { groupID: string }, status: TranslationStatus | null) {
    if (!editing) return;
    setBusy(true);
    try {
      const updated = await setTranslationStatusOverride(editing.id, group.groupID, status);
      setEditing({ ...editing, translations: editing.translations?.map((item) => item.groupID === updated.groupID ? updated : item) });
      setMessage("Status da tradução atualizado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao atualizar o status."); }
    finally { setBusy(false); }
  }

  async function syncOfficialData() {
    if (!editing) return;
    setBusy(true);
    try {
      const synced = await syncMangaExternalMetadata(editing.id);
      setEditing({ ...editing, ...synced });
      setMessage("Metadados oficiais sincronizados.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha na sincronização."); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!groupID) return setMessage("Crie ou selecione um grupo.");
    const validation = catalogMangaSchema.safeParse({
      title, description: form.description, mangaka: form.mangaka,
      genders: form.genders.split(",").map((value) => value.trim()).filter(Boolean),
      demographics: selectedDemographics,
      aliases: form.aliases.split(",").map((value) => value.trim()).filter(Boolean),
      trackers, isAdult: form.isAdult,
      ...(!editing && selectedMalId ? { malId: selectedMalId } : {}),
      ...(!editing ? { translationLanguage } : {}),
    });
    if (!validation.success) {
      setMessage(validation.error.issues[0]?.message ?? "Confira os dados da obra.");
      return;
    }
    setBusy(true);
    let uploaded: UploadedMedia | null = null;
    try {
      if (cover) uploaded = await uploadImage(cover, "MANGA_COVER");
      const data = { ...validation.data, ...(uploaded ? { mangaCoverID: uploaded.id } : {}) };
      if (editing && selectedMalId && selectedMalId !== editing.externalMetadata?.malId) {
        await linkMangaExternalMetadata(editing.id, selectedMalId);
      }
      const manga = editing ? await updateManga(editing.id, data) : await createManga(groupID, data);
      await reloadGroups();
      setMessage(editing ? `“${manga.title}” atualizado.` : `“${manga.title}” cadastrado e relacionado ao grupo.`);
      setEditing(null);
      setCover(null);
    } catch (error) {
      if (uploaded) await discardImage(uploaded.id).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally { setBusy(false); }
  }

  const visibleResults = title.trim().length >= 2 ? results : [];
  const selectedCandidate = jikanResults.find((candidate) => candidate.malId === selectedMalId);

  return <div className={styles.page}>
    <header className={styles.heading}><h1>Mangas</h1><p>Pesquise no catálogo global antes de cadastrar uma obra.</p></header>
    {!initialGroupID && <fieldset className={styles.groupPicker}><legend>1. Escolha o grupo que receberá a obra</legend><div className={styles.groupCards}>{groups.map((group) => <button type="button" key={group.id} className={`${styles.groupCard} ${groupID === group.id ? styles.groupCardSelected : ""}`} aria-pressed={groupID === group.id} onClick={() => { setGroupID(group.id); setTitle(""); setResults([]); setJikanResults([]); setExternalState("idle"); setManualMode(false); setSelectedMalId(null); setEditing(null); setMessage(""); }}><strong>{group.name}</strong><span>{group.countryFlag} {group.country} · {group.mangas?.length ?? group.stats?.mangas ?? 0} {(group.mangas?.length ?? group.stats?.mangas ?? 0) === 1 ? "manga" : "mangas"}</span><small>{groupID === group.id ? "Grupo selecionado" : "Selecionar grupo"}</small></button>)}</div></fieldset>}
    {selectedGroup && <fieldset className={styles.groupPicker}><legend>{initialGroupID ? `Adicionar obra a ${selectedGroup.name}` : "2. Pesquisar obra"}</legend><label>Pesquisar obra<input value={title} onChange={(event) => { setTitle(event.target.value); setSearching(false); setEditing(null); setSelectedMalId(null); setManualMode(false); setLocalBypassed(false); setExternalState("idle"); setResults([]); setJikanResults([]); setTrackers(EMPTY_TRACKERS); setMessage(""); }} placeholder="Comece a digitar…" /></label></fieldset>}
    <section className={styles.panel}>
      {selectedGroup ? <>
      {(searching || externalState === "loading" || loadingJikanDetails) ? <div className={styles.loadingStatus} role="status" aria-live="polite"><span className={styles.loadingSpinner} aria-hidden="true"/><span><strong>{loadingJikanDetails ? "Carregando dados da obra" : externalState === "loading" ? "Consultando o MyAnimeList" : "Pesquisando no catálogo"}</strong><small>{loadingJikanDetails ? "Buscando sinopse, gêneros e demografia para revisão." : externalState === "loading" ? "A Jikan está procurando resultados no catálogo do MAL." : "Verificando se a obra já existe no catálogo."}</small></span></div> : visibleResults.length && !localBypassed ? <p className={styles.muted}>Encontramos obras locais. Reutilize o registro correto.</p> : null}
      <div className={styles.results}>{visibleResults.map((manga) => <div className={styles.result} key={manga.id}><span><strong>{manga.title}</strong><small>{manga.mangaka}{manga.isAdult ? " · +18" : ""}</small></span><div className={styles.actions}><button className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={() => void handleUseExisting(manga.id)}>Usar existente</button>{isAegis && <button className={styles.button} onClick={() => beginEdit(manga)}>Editar</button>}</div></div>)}</div>
      {visibleResults.length > 0 && !localBypassed && <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setLocalBypassed(true)}>Nenhuma dessas corresponde — buscar no MAL</button>}
      {jikanResults.length > 0 && <div className={styles.results}><h2 className={styles.externalResultsTitle}>MyAnimeList (Jikan)</h2>{jikanResults.map((candidate) => <div className={styles.result} key={candidate.malId}>{candidate.imageUrl && <img className={styles.externalCover} src={candidate.imageUrl} alt="" />}<span><strong>{candidate.title}</strong><small>{[candidate.titleEnglish !== candidate.title ? candidate.titleEnglish : null, candidate.titleJapanese, candidate.authors.join(", "), candidate.type, candidate.year, candidate.rawStatus].filter(Boolean).join(" · ")}</small></span><button className={`${styles.button} ${styles.secondary}`} type="button" disabled={busy} onClick={() => void selectJikan(candidate)}>{selectedMalId === candidate.malId ? "Selecionado" : busy ? "Carregando…" : "Selecionar"}</button></div>)}</div>}
      {externalState === "error" && <div className={styles.notice}><span>A consulta ao MyAnimeList falhou; isso não confirma que a obra não exista.</span><button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setSearchNonce((value) => value + 1)}>Tentar novamente</button></div>}
      {externalState === "empty" && !manualMode && <div className={styles.notice}><span>Nenhuma obra foi encontrada localmente nem no MyAnimeList.</span><button className={styles.button} type="button" onClick={startManualRegistration}>Cadastrar manualmente</button></div>}
      {externalState === "results" && !selectedMalId && !manualMode && <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={startManualRegistration}>Nenhum resultado corresponde — cadastro manual</button>}
      </> : <p className={styles.muted}>{groups.length ? "Selecione um grupo acima. A busca e o cadastro serão exibidos depois da seleção." : "Você ainda não possui grupos cadastrados. Crie um grupo antes de adicionar mangas."}</p>}
    </section>
    {(editing || manualMode || selectedMalId) && <fieldset className={`${styles.panel} ${styles.stepPanel}`}><legend>{editing ? `Editar ${editing.title}` : "3. Novo registro global"}</legend><form className={styles.stepForm} autoComplete="off" onSubmit={submit}>
      {selectedCandidate && !editing && <p className={styles.muted}>Revise os dados importados. A sinopse é editável e não será substituída nas sincronizações futuras.</p>}
      {manualMode && <p className={styles.muted}>Este cadastro ficará sem MAL ID e poderá ser associado posteriormente.</p>}
      {!editing && <label>Idioma da tradução<input required maxLength={80} value={translationLanguage} onChange={(event) => setTranslationLanguage(event.target.value)} /></label>}
      <label>Descrição<textarea required minLength={120} maxLength={600} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label>Mangaka (Autor)<input required value={form.mangaka} readOnly /></label>
      <label>Gêneros (separados por vírgula)<input required value={form.genders} onChange={(event) => setForm({ ...form, genders: event.target.value })} /></label>
      <fieldset className={styles.demographics}><legend>Demografia do MyAnimeList</legend><p>Selecione as classificações que devem aparecer no catálogo. As opções vêm do registro escolhido no MAL.</p>{demographicOptions.length ? <div>{demographicOptions.map((value) => <label key={value}><input type="checkbox" checked={selectedDemographics.includes(value)} onChange={(event) => setSelectedDemographics((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))}/><span>{value}</span></label>)}</div> : <small>{selectedMalId ? "O MAL não informou demografias para esta obra." : "Selecione uma obra do MAL para carregar as opções."}</small>}</fieldset>
      <label>Títulos alternativos<input placeholder="Separe os títulos por vírgula" value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} /></label>
      <fieldset style={{display:"grid",gap:14,padding:18,border:"1px solid #ffffff18",borderRadius:10}}><legend style={{padding:"0 7px",fontWeight:700}}>Trackers</legend><p className={styles.muted}>O MyAnimeList é preenchido pela obra selecionada. Os demais links são opcionais e inseridos manualmente.</p>
        <label>MyAnimeList<input type="url" maxLength={500} placeholder="Preenchido automaticamente pela busca" value={trackers.myanimelist} readOnly /></label>
        <label>AniList<input type="url" maxLength={500} placeholder="https://anilist.co/manga/..." value={trackers.anilist} onChange={(event) => setTrackers({ ...trackers, anilist: event.target.value })} /></label>
        <label>Anime-Planet<input type="url" maxLength={500} placeholder="https://www.anime-planet.com/manga/..." value={trackers.animeplanet} onChange={(event) => setTrackers({ ...trackers, animeplanet: event.target.value })} /></label>
        <label>AniDB<input type="url" maxLength={500} placeholder="https://anidb.net/manga/..." value={trackers.anidb} onChange={(event) => setTrackers({ ...trackers, anidb: event.target.value })} /></label>
      </fieldset>
      <label className={styles.adultCheck}><input type="checkbox" checked={form.isAdult} onChange={(event) => setForm({ ...form, isAdult: event.target.checked })}/><span><strong>Esta obra contém conteúdo adulto (+18)</strong><small>Classificação separada dos gêneros.</small></span></label>
      <div className={styles.coverField}><span>Capa</span><label className={styles.coverPicker}>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
        {(coverPreview || editing?.mangaCover) ? <img src={coverPreview || editing?.mangaCover || ""} alt="Prévia da capa" /> : <span className={styles.coverPickerEmpty}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m20.5 15-5-5L5 20.5"/></svg><strong>Selecionar capa</strong><small>JPG, PNG ou WebP</small></span>}
        {(coverPreview || editing?.mangaCover) && <span className={styles.coverPickerAction}>Trocar capa</span>}
      </label><small className={styles.muted}>O upload será feito ao salvar.</small></div>
      {editing && isAegis && <section><h2>Dados oficiais</h2><p className={styles.muted}>MAL ID: {editing.externalMetadata?.malId ?? "não associado"} · {editing.officialPublicationStatus ?? "UNKNOWN"} · {editing.officialTotalChapters ?? "total desconhecido"}</p>{editing.externalMetadata?.malId && <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={() => void syncOfficialData()}>Sincronizar Jikan</button>}</section>}
      {editing && isAegis && !editing.externalMetadata?.malId && <p className={styles.muted}>Selecione acima o resultado correto da Jikan para associar esta obra antiga.</p>}
      {editing && isAegis && editing.translations?.length ? <section><h2>Status das traduções</h2><div className={styles.results}>{editing.translations.map((translation) => <div className={styles.result} key={translation.groupID}><span><strong>{translation.group.name}</strong><small>Calculado: {translation.calculatedTranslationStatus} · Exibido: {translation.translationStatus}{translation.overridden ? " (manual)" : " (automático)"}</small></span><select value={translation.translationStatusOverride ?? "AUTO"} onChange={(event) => void changeOverride(translation, event.target.value === "AUTO" ? null : event.target.value as TranslationStatus)}><option value="AUTO">Automático</option><option value="ONGOING">Em andamento</option><option value="PAUSED">Pausado</option><option value="COMPLETED">Concluído</option></select></div>)}</div></section> : null}
      <div className={`${styles.actions} ${styles.submitActions}`}><button className={styles.button} disabled={busy || (!editing && (!selectedMalId && !manualMode)) || Boolean(editing && !editing.externalMetadata?.malId && !selectedMalId)}>{busy ? "Salvando…" : editing ? "Salvar alterações" : selectedMalId ? "Importar e relacionar" : "Cadastrar manualmente"}</button>{editing && <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setEditing(null)}>Cancelar</button>}</div>
    </form></fieldset>}
    {selectedGroup && <section className={styles.panel}><h2>Mangas relacionados ao grupo</h2>{selectedGroup.mangas?.length ? <div className={styles.results}>{selectedGroup.mangas.map((manga) => <div className={styles.result} key={manga.id}><strong>{manga.title}{manga.isAdult ? " · +18" : ""}</strong>{isAegis && <button className={`${styles.button} ${styles.secondary}`} onClick={() => beginEdit(manga)}>Editar metadados</button>}</div>)}</div> : <p className={styles.muted}>Nenhum manga relacionado.</p>}</section>}
    {message && <p className={styles.message}>{message}</p>}
  </div>;
}
