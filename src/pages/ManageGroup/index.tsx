import { useEffect, useState } from "react";
import { useToast } from "../../context/ToastContext";

import { createGroup, discardImage, getCountries, getMe, updateGroup, uploadImage, type CountryOption, type Group, type SocialMedias, type UploadedMedia } from "../../services/graphql";
import styles from "../admin.module.css";
import { useObjectUrl } from "../../hooks/useObjectUrl";

type SocialForm = Record<keyof SocialMedias, string>;
const EMPTY_SOCIALS: SocialForm = { site: "", discord: "", x: "", instagram: "", facebook: "", youtube: "", tiktok: "" };

function socialForm(values?: SocialMedias | null): SocialForm {
  return {
    site: values?.site ?? "",
    discord: values?.discord ?? "",
    x: values?.x ?? "",
    instagram: values?.instagram ?? "",
    facebook: values?.facebook ?? "",
    youtube: values?.youtube ?? "",
    tiktok: values?.tiktok ?? "",
  };
}

export default function ManageGroup({ initialGroupID }: { initialGroupID?: string }) {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [selectedID, setSelectedID] = useState(initialGroupID ?? "new");
  const [data, setData] = useState({ name: "", description: "", countryCode: "" });
  const [socialMedias, setSocialMedias] = useState<SocialForm>(EMPTY_SOCIALS);
  const [image, setImage] = useState<File | null>(null);
  const imagePreview = useObjectUrl(image);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = groups.find((group) => group.id === selectedID);

  async function reload(preferredID?: string) {
    const user = await getMe();
    setGroups(user.groups);
    if (preferredID) setSelectedID(preferredID);
  }

  useEffect(() => {
    Promise.all([getMe(), getCountries()]).then(([user, availableCountries]) => {
      setGroups(user.groups);
      setCountries(availableCountries);
      const initialGroup = user.groups.find((group) => group.id === initialGroupID);
      if (initialGroup) {
        setSelectedID(initialGroup.id);
        setData({ name: initialGroup.name, description: initialGroup.description, countryCode: initialGroup.countryCode });
        setSocialMedias(socialForm(initialGroup.socialMedias));
      }
    }).catch((error: Error) => setMessage(error.message));
  }, [initialGroupID]);

  function choose(id: string) {
    setSelectedID(id);
    const group = groups.find((item) => item.id === id);
    setData(group ? { name: group.name, description: group.description, countryCode: group.countryCode } : { name: "", description: "", countryCode: "" });
    setSocialMedias(socialForm(group?.socialMedias));
    setImage(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    let uploaded: UploadedMedia | null = null;
    try {
      if (image) uploaded = await uploadImage(image, "GROUP_IMAGE");
      const payload = { ...data, socialMedias, ...(uploaded ? { groupImageID: uploaded.id } : {}) };
      const group = selected ? await updateGroup(selected.id, payload) : await createGroup(payload);
      await reload(group.id);
      setImage(null);
      setMessage(selected ? "Grupo atualizado." : `Grupo “${group.name}” criado.`);
    } catch (error) {
      if (uploaded) await discardImage(uploaded.id).catch(() => undefined);
      const detail = error instanceof Error ? error.message : "";
      const message = /^Discord:/i.test(detail)
        ? "O link do Discord precisa ser um endereço do Discord, como https://discord.gg/seu-convite."
        : detail || "Não foi possível salvar os dados do grupo. Tente novamente.";
      showToast(message, "error");
    } finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <header className={styles.heading}><h1>Gerenciar grupos</h1><p>Selecione uma scan para editar ou comece um novo cadastro.</p></header>
    <form className={styles.panel} onSubmit={submit}>
      <fieldset className={styles.groupPicker}>
        <legend>Grupo</legend>
        <div className={styles.groupCards}>
          <button type="button" className={`${styles.groupCard} ${selectedID === "new" ? styles.groupCardSelected : ""}`} aria-pressed={selectedID === "new"} onClick={() => choose("new")}>
            <strong>Novo grupo</strong><span>Começar um cadastro</span><small>{selectedID === "new" ? "Selecionado" : "Criar grupo"}</small>
          </button>
          {groups.map((group) => <button type="button" key={group.id} className={`${styles.groupCard} ${selectedID === group.id ? styles.groupCardSelected : ""}`} aria-pressed={selectedID === group.id} onClick={() => choose(group.id)}>
            <strong>{group.name}</strong><span>{group.countryFlag} {group.country}</span><small>{selectedID === group.id ? "Selecionado para edição" : "Editar informações"}</small>
          </button>)}
        </div>
      </fieldset>
      <input required placeholder="Nome do grupo" value={data.name} onChange={(event) => setData({ ...data, name: event.target.value })} />
      <textarea required placeholder="Descrição" value={data.description} onChange={(event) => setData({ ...data, description: event.target.value })} />
      <label>País<select required value={data.countryCode} onChange={(event) => setData({ ...data, countryCode: event.target.value })}><option value="" disabled>Selecione um país</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.flag} {country.name}</option>)}</select></label>
      <fieldset style={{display:"grid",gap:14,padding:18,border:"1px solid #ffffff18",borderRadius:10}}><legend style={{padding:"0 7px",fontWeight:700}}>Redes sociais</legend><p className={styles.muted}>Todos os links são opcionais e devem usar HTTPS.</p>
        <label>Website<input type="url" maxLength={500} placeholder="https://seusite.com" value={socialMedias.site} onChange={(event) => setSocialMedias({ ...socialMedias, site: event.target.value })} /></label>
        <label>Discord<input type="url" maxLength={500} placeholder="https://discord.gg/..." value={socialMedias.discord} onChange={(event) => setSocialMedias({ ...socialMedias, discord: event.target.value })} /></label>
        <label>X / Twitter<input type="url" maxLength={500} placeholder="https://x.com/..." value={socialMedias.x} onChange={(event) => setSocialMedias({ ...socialMedias, x: event.target.value })} /></label>
        <label>Instagram<input type="url" maxLength={500} placeholder="https://instagram.com/..." value={socialMedias.instagram} onChange={(event) => setSocialMedias({ ...socialMedias, instagram: event.target.value })} /></label>
        <label>Facebook<input type="url" maxLength={500} placeholder="https://facebook.com/..." value={socialMedias.facebook} onChange={(event) => setSocialMedias({ ...socialMedias, facebook: event.target.value })} /></label>
        <label>YouTube<input type="url" maxLength={500} placeholder="https://youtube.com/@..." value={socialMedias.youtube} onChange={(event) => setSocialMedias({ ...socialMedias, youtube: event.target.value })} /></label>
        <label>TikTok<input type="url" maxLength={500} placeholder="https://tiktok.com/@..." value={socialMedias.tiktok} onChange={(event) => setSocialMedias({ ...socialMedias, tiktok: event.target.value })} /></label>
      </fieldset>
      <div className={styles.coverField}><span>Imagem do grupo</span><label className={`${styles.coverPicker} ${styles.squarePicker}`}>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
        {(imagePreview || selected?.groupImage) ? <img src={imagePreview || selected?.groupImage || ""} alt="Prévia da imagem do grupo" /> : <span className={styles.coverPickerEmpty}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m20.5 15-5-5L5 20.5"/></svg><strong>Selecionar imagem</strong><small>JPG, PNG ou WebP</small></span>}
        {(imagePreview || selected?.groupImage) && <span className={styles.coverPickerAction}>Trocar imagem</span>}
      </label><small className={styles.muted}>A imagem será enviada ao salvar.</small></div>
      <button className={styles.button} disabled={busy}>{busy ? "Salvando…" : selected ? "Salvar grupo" : "Criar grupo"}</button>
      {message && <p className={styles.message}>{message}</p>}
    </form>
  </div>;
}
