import { useEffect, useState } from "react";

import { discardImage, getMe, updateMyProfile, uploadImage, type CurrentUser, type UploadedMedia } from "../../services/graphql";
import styles from "../admin.module.css";
import { useObjectUrl } from "../../hooks/useObjectUrl";

export default function Profile() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showAdultContent, setShowAdultContent] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const imagePreview = useObjectUrl(image);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMe().then((current) => {
      setUser(current);
      setName(current.name);
      setEmail(current.email);
      setShowAdultContent(current.preferences.showAdultContent);
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  async function save() {
    setBusy(true);
    let uploaded: UploadedMedia | null = null;
    try {
      if (image) uploaded = await uploadImage(image, "USER_AVATAR");
      const next = await updateMyProfile({ name, email, showAdultContent, ...(uploaded ? { profilePictureID: uploaded.id } : {}) });
      setUser(next);
      setName(next.name);
      setEmail(next.email);
      setShowAdultContent(next.preferences.showAdultContent);
      setImage(null);
      setMessage("Perfil atualizado.");
    } catch (error) {
      if (uploaded) await discardImage(uploaded.id).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally { setBusy(false); }
  }

  if (!user) return <p className={styles.muted}>{message || "Carregando…"}</p>;
  return <div className={styles.page}>
    <header className={styles.heading}><h1>Perfil e conta</h1><p>Dados da conta usada para administrar seus grupos.</p></header>
    <form className={styles.panel} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={styles.coverField}><span>Foto de perfil</span><label className={`${styles.coverPicker} ${styles.circlePicker}`}>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
        {(imagePreview || user.profilePicture) ? <img src={imagePreview || user.profilePicture || ""} alt="Prévia da foto de perfil" /> : <span className={styles.coverPickerEmpty}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m20.5 15-5-5L5 20.5"/></svg><strong>Selecionar foto</strong><small>JPG, PNG ou WebP</small></span>}
        {(imagePreview || user.profilePicture) && <span className={styles.coverPickerAction}>Trocar foto</span>}
      </label><small className={styles.muted}>A foto será enviada ao salvar.</small></div>
      <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>E-mail<input type="email" value={email} maxLength={254} autoComplete="email" required disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className={styles.adultCheck}><input type="checkbox" checked={showAdultContent} onChange={(event) => setShowAdultContent(event.target.checked)} /><span><strong>Exibir conteúdo adulto (+18)</strong><small>Oculto por padrão e salvo na sua conta.</small></span></label>
      <button type="submit" className={styles.button} disabled={busy || name.trim().length < 2}>{busy ? "Salvando…" : "Salvar alterações"}</button>
      {message && <p className={styles.message}>{message}</p>}
    </form>
  </div>;
}
