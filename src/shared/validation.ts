import { z } from "zod";

export const signInSchema = z.object({
  login: z.string().trim().min(1, "Informe seu username ou e-mail.").max(254, "Login muito longo."),
  password: z.string().min(1, "Informe sua senha.").max(120, "A senha deve ter no máximo 120 caracteres.").refine((value) => new TextEncoder().encode(value).length <= 72, "A senha é muito longa."),
}).strict();

export const profileSchema = z.object({
  name: z.string().trim().min(2, "O nome precisa ter pelo menos 2 caracteres.").max(120, "O nome deve ter no máximo 120 caracteres."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254, "O e-mail deve ter no máximo 254 caracteres."),
  showAdultContent: z.boolean(),
}).strict();

const httpsUrl = (label: string, hosts?: string[]) => z.string().trim().max(500, `${label}: o link pode ter no máximo 500 caracteres.`)
  .transform((value) => value || null)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        && (!hosts || hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
    } catch { return false; }
  }, `${label}: informe uma URL HTTPS válida.`);

export const groupSchema = z.object({
  name: z.string().trim().min(2, "O nome do grupo precisa ter pelo menos 2 caracteres.").max(120),
  description: z.string().trim().min(10, "A descrição precisa ter pelo menos 10 caracteres.").max(1200),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "Selecione um país válido."),
  socialMedias: z.object({
    site: httpsUrl("Website"),
    discord: httpsUrl("Discord", ["discord.gg", "discord.com", "discordapp.com"]),
    x: httpsUrl("X / Twitter", ["x.com", "twitter.com"]),
    instagram: httpsUrl("Instagram", ["instagram.com"]),
    facebook: httpsUrl("Facebook", ["facebook.com", "fb.com"]),
    youtube: httpsUrl("YouTube", ["youtube.com", "youtu.be"]),
    tiktok: httpsUrl("TikTok", ["tiktok.com"]),
  }).strict(),
}).strict();

export const chapterSchema = z.object({
  chapterTitle: z.string().trim().max(180),
  chapterNumber: z.string().trim().min(1, "Informe o número do capítulo.").regex(/^\d+(?:\.\d+)?$/, "Informe um número válido."),
  chapterType: z.enum(["MAIN", "EXTRA", "SPECIAL", "ONESHOT"]),
  folder: z.string().trim().min(1, "Selecione a pasta de imagens do capítulo."),
}).strict().refine((value) => value.chapterType !== "MAIN" || (Number.isInteger(Number(value.chapterNumber)) && Number(value.chapterNumber) > 0), {
  message: "Capítulos principais devem usar um número inteiro maior que zero.", path: ["chapterNumber"],
});

export const groupMangaSchema = z.object({
  description: z.string().trim().min(120, "A descrição precisa ter pelo menos 120 caracteres.").max(600, "A descrição deve ter no máximo 600 caracteres."),
}).strict();

export const catalogMangaSchema = z.object({
  title: z.string().trim().min(1, "Informe o título da obra.").max(180),
  description: z.string().trim().min(120, "A descrição precisa ter pelo menos 120 caracteres.").max(600),
  mangaka: z.string().trim().min(1, "Informe o autor da obra.").max(180),
  genders: z.array(z.string().trim().min(1).max(60)).min(1, "Insira pelo menos um gênero.").max(30),
  demographics: z.array(z.string().trim().min(1).max(60)).max(20),
  aliases: z.array(z.string().trim().min(1).max(180)).max(30),
  trackers: z.object({
    myanimelist: httpsUrl("MyAnimeList", ["myanimelist.net"]),
    anilist: httpsUrl("AniList", ["anilist.co"]),
    animeplanet: httpsUrl("Anime-Planet", ["anime-planet.com"]),
    anidb: httpsUrl("AniDB", ["anidb.net"]),
  }).strict(),
  isAdult: z.boolean(),
  malId: z.number().int().positive().optional(),
  translationLanguage: z.string().trim().min(2).max(80).optional(),
  mangaCoverID: z.string().regex(/^[a-f\d]{24}$/i, "Capa inválida.").optional(),
}).strict();
