import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { discardImage, getMe, updateMyProfile, uploadImage, type CurrentUser, type UploadedMedia } from "../../services/graphql";
import styles from "../admin.module.css";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { profileSchema } from "../../shared/validation";
import type { z } from "zod";

type ProfileValues = z.infer<typeof profileSchema>;

export default function Profile() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: "onTouched",
    defaultValues: { name: "", email: "", showAdultContent: false },
  });
  const showAdultContent = watch("showAdultContent");
  const [image, setImage] = useState<File | null>(null);
  const imagePreview = useObjectUrl(image);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMe().then((current) => {
      setUser(current);
      reset({ name: current.name, email: current.email, showAdultContent: current.preferences.showAdultContent });
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  async function save(values: ProfileValues) {
    setBusy(true);
    let uploaded: UploadedMedia | null = null;
    try {
      if (image) uploaded = await uploadImage(image, "USER_AVATAR");
      const next = await updateMyProfile({ ...values, ...(uploaded ? { profilePictureID: uploaded.id } : {}) });
      setUser(next);
      reset({ name: next.name, email: next.email, showAdultContent: next.preferences.showAdultContent });
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
    <form className={styles.panel} autoComplete="off" noValidate onSubmit={handleSubmit(save)}>
      <div className={styles.coverField}><span>Foto de perfil</span><label className={`${styles.coverPicker} ${styles.circlePicker}`}>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
        {(imagePreview || user.profilePicture) ? <img src={imagePreview || user.profilePicture || ""} alt="Prévia da foto de perfil" /> : <span className={styles.coverPickerEmpty}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m20.5 15-5-5L5 20.5"/></svg><strong>Selecionar foto</strong><small>JPG, PNG ou WebP</small></span>}
        {(imagePreview || user.profilePicture) && <span className={styles.coverPickerAction}>Trocar foto</span>}
      </label><small className={styles.muted}>A foto será enviada ao salvar.</small></div>
      <label>Nome<input autoComplete="off" aria-invalid={Boolean(errors.name)} {...register("name")} /></label>
      {errors.name && <p className={styles.message} role="alert">{errors.name.message}</p>}
      <label>E-mail<input type="email" maxLength={254} autoComplete="off" aria-invalid={Boolean(errors.email)} disabled={busy} {...register("email")} /></label>
      {errors.email && <p className={styles.message} role="alert">{errors.email.message}</p>}
      <label className={styles.adultCheck}><input type="checkbox" checked={showAdultContent} autoComplete="off" {...register("showAdultContent")} /><span><strong>Exibir conteúdo adulto (+18)</strong><small>Oculto por padrão e salvo na sua conta.</small></span></label>
      <button type="submit" className={styles.button} disabled={busy || isSubmitting}>{busy || isSubmitting ? "Salvando…" : "Salvar alterações"}</button>
      {message && <p className={styles.message}>{message}</p>}
    </form>
  </div>;
}
