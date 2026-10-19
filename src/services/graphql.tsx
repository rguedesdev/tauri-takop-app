import { GraphQLClient, gql, type RequestDocument, type Variables } from "graphql-request";

const API_URL = "http://localhost:5000";
const client = new GraphQLClient(`${API_URL}/graphql`);

export interface UploadedMedia { id: string; url: string; originalName: string; size: number }
export type TranslationStatus = "ONGOING" | "PAUSED" | "COMPLETED";
export interface MangaTranslation { mangaID: string; groupID: string; language: string; translationStatus: TranslationStatus; calculatedTranslationStatus: TranslationStatus; translationStatusOverride?: TranslationStatus | null; overridden: boolean; group: { id: string; name: string } }
export interface Trackers { myanimelist?: string | null; anilist?: string | null; animeplanet?: string | null; anidb?: string | null }
export interface Manga { id: string; title: string; aliases: string[]; mangaka: string; mangaCover?: string | null; description: string; genders: string[]; demographics: string[]; trackers?: Trackers | null; isAdult: boolean; officialPublicationStatus?: "ONGOING" | "COMPLETED" | "HIATUS" | "UNKNOWN"; officialTotalChapters?: number | null; externalMetadata?: { malId?: number | null; lastSyncedAt?: string | null; lastSyncError?: string | null } | null; translations?: MangaTranslation[] }
export interface JikanMangaCandidate { malId: number; title: string; titleEnglish?: string | null; titleJapanese?: string | null; aliases: string[]; synopsis?: string | null; totalChapters?: number | null; publicationStatus: "ONGOING" | "COMPLETED" | "HIATUS" | "UNKNOWN"; rawStatus?: string | null; authors: string[]; genres: string[]; demographics: string[]; imageUrl?: string | null; malUrl?: string | null; type?: string | null; year?: number | null }
export interface SocialMedias { site?: string | null; discord?: string | null; x?: string | null; instagram?: string | null; facebook?: string | null; youtube?: string | null; tiktok?: string | null }
export interface Group { id: string; ownerID?: string; groupImage?: string | null; name: string; description: string; country: string; countryCode: string; countryFlag: string; socialMedias?: SocialMedias | null; stats?: { mangas: number; chapters: number; followers: number; views: number; likes: number }; mangas?: Manga[] }
export interface CountryOption { code: string; name: string; flag: string }
export interface CurrentUser { id: string; name: string; username: string; email: string; profilePicture?: string | null; accountType: string; preferences: { showAdultContent: boolean }; groups: Group[] }
export interface Chapter { id: string; chapterNumber: number; chapterTitle: string }
export interface ReaderPinRequest { cid: string; telegramUrl?: string | null }

async function request<T>(document: RequestDocument, variables?: Variables): Promise<T> {
  try {
    return await client.request<T>(document, variables);
  } catch (error) {
    const responseErrors = typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { errors?: Array<{ message?: string }> } }).response?.errors
      : undefined;
    const message = responseErrors?.[0]?.message;
    if (message) throw new Error(message);
    throw error;
  }
}

function setAuthHeader() {
  const token = localStorage.getItem("token");
  client.setHeader("Authorization", token ? `Bearer ${token}` : "");
}

export async function signIn(login: string, password: string) {
  return request<{ signIn: { token: string } }>(gql`mutation ($data: SignInInput!) { signIn(data: $data) { token } }`, { data: { login, password } });
}

export async function getMe() {
  setAuthHeader();
  const result = await request<{ me: CurrentUser }>(gql`
    query {
      me {
        id name username email profilePicture accountType preferences { showAdultContent }
        groups { id groupImage name description country countryCode countryFlag socialMedias { site discord x instagram facebook youtube tiktok } stats { mangas chapters followers views likes } mangas { id title aliases mangaka mangaCover description genders demographics trackers{myanimelist anilist animeplanet anidb} isAdult officialPublicationStatus officialTotalChapters externalMetadata{malId lastSyncedAt lastSyncError} translations{mangaID groupID language translationStatus calculatedTranslationStatus translationStatusOverride overridden group{id name}} } }
      }
    }
  `);
  return result.me;
}

export async function setReaderNodeOnline(online: boolean) {
  setAuthHeader();
  const result = await request<{ setReaderNodeOnline: boolean }>(gql`mutation($online:Boolean!){setReaderNodeOnline(online:$online)}`, { online });
  return result.setReaderNodeOnline;
}

export async function getReaderPinRequests() {
  setAuthHeader();
  const result = await request<{ readerPinRequests: ReaderPinRequest[] }>(gql`query{readerPinRequests(limit:100){cid telegramUrl}}`);
  return result.readerPinRequests;
}

export async function acknowledgeReaderPinRequests(cids: string[]) {
  if (!cids.length) return 0;
  setAuthHeader();
  const result = await request<{ acknowledgeReaderPinRequests: number }>(gql`mutation($cids:[String!]!){acknowledgeReaderPinRequests(cids:$cids)}`, { cids });
  return result.acknowledgeReaderPinRequests;
}

export async function uploadImage(file: File, purpose: "USER_AVATAR" | "GROUP_IMAGE" | "MANGA_COVER") {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/uploads/images?purpose=${purpose}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
    body: form,
  });
  const body = await response.json() as { error?: string; media?: UploadedMedia };
  if (!response.ok || !body.media) throw new Error(body.error ?? "Falha no upload.");
  return body.media;
}

export async function discardImage(id: string) {
  const response = await fetch(`${API_URL}/uploads/images/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
  });
  if (!response.ok && response.status !== 404) throw new Error("Falha ao descartar a imagem.");
}

export async function getCountries() {
  setAuthHeader();
  const result = await request<{ countries: CountryOption[] }>(gql`query { countries { code name flag } }`);
  return result.countries;
}

export async function searchMangas(query: string) {
  setAuthHeader();
  const result = await request<{ searchMangas: Manga[] }>(gql`query($query:String!){searchMangas(query:$query){id title aliases mangaka mangaCover description genders demographics trackers{myanimelist anilist animeplanet anidb} isAdult officialPublicationStatus officialTotalChapters externalMetadata{malId lastSyncedAt lastSyncError} translations{mangaID groupID language translationStatus calculatedTranslationStatus translationStatusOverride overridden group{id name}}}}`, { query });
  return result.searchMangas;
}

export async function searchJikanMangas(query: string) {
  setAuthHeader();
  const result = await request<{ searchJikanMangas: JikanMangaCandidate[] }>(gql`query($query:String!){searchJikanMangas(query:$query){malId title titleEnglish titleJapanese aliases synopsis totalChapters publicationStatus rawStatus authors genres demographics imageUrl malUrl type year}}`, { query });
  return result.searchJikanMangas;
}

export async function getJikanManga(malId: number) {
  setAuthHeader();
  const result = await request<{ jikanManga: JikanMangaCandidate }>(gql`query($malId:Int!){jikanManga(malId:$malId){malId title titleEnglish titleJapanese aliases synopsis totalChapters publicationStatus rawStatus authors genres demographics imageUrl malUrl type year}}`, { malId });
  return result.jikanManga;
}

export async function createManga(groupID: string, data: Record<string, unknown>) {
  setAuthHeader();
  const result = await request<{ createManga: Manga }>(gql`mutation($groupID:ID!,$data:CreateMangaInput!){createManga(groupID:$groupID,data:$data){id title aliases mangaka mangaCover description genders trackers{myanimelist anilist animeplanet anidb} isAdult}}`, { groupID, data });
  return result.createManga;
}

export async function updateManga(id: string, data: Record<string, unknown>) {
  setAuthHeader();
  const result = await request<{ updateManga: Manga }>(gql`mutation($id:ID!,$data:UpdateMangaInput!){updateManga(id:$id,data:$data){id title aliases mangaka mangaCover description genders trackers{myanimelist anilist animeplanet anidb} isAdult}}`, { id, data });
  return result.updateManga;
}

export async function updateGroupManga(groupID: string, mangaID: string, data: { description?: string; mangaCoverID?: string }) {
  setAuthHeader();
  const result = await request<{ updateGroupManga: Manga }>(gql`mutation($groupID:ID!,$mangaID:ID!,$data:UpdateGroupMangaInput!){updateGroupManga(groupID:$groupID,mangaID:$mangaID,data:$data){id title mangaCover description}}`, { groupID, mangaID, data });
  return result.updateGroupManga;
}

export async function addMangaToGroup(mangaID: string, groupID: string, translationLanguage?: string) {
  setAuthHeader();
  const result = await request<{ addMangaToGroup: Pick<Manga, "id" | "title"> }>(gql`mutation($mangaID:ID!,$groupID:ID!,$language:String){addMangaToGroup(mangaID:$mangaID,groupID:$groupID,translationLanguage:$language){id title}}`, { mangaID, groupID, language: translationLanguage });
  return result.addMangaToGroup;
}

export async function createGroup(data: Record<string, unknown>) {
  setAuthHeader();
  const result = await request<{ createGroup: Group }>(gql`mutation($data:CreateGroupInput!){createGroup(data:$data){id name description country countryCode countryFlag groupImage socialMedias{site discord x instagram facebook youtube tiktok}}}`, { data });
  return result.createGroup;
}

export async function updateGroup(id: string, data: Record<string, unknown>) {
  setAuthHeader();
  const result = await request<{ updateGroup: Group }>(gql`mutation($id:ID!,$data:UpdateGroupInput!){updateGroup(id:$id,data:$data){id name description country countryCode countryFlag groupImage socialMedias{site discord x instagram facebook youtube tiktok}}}`, { id, data });
  return result.updateGroup;
}

export async function updateMyProfile(data: Record<string, unknown>) {
  setAuthHeader();
  const result = await request<{ updateMyProfile: CurrentUser }>(gql`mutation($data:UpdateProfileInput!){updateMyProfile(data:$data){id name username email profilePicture accountType preferences{showAdultContent} groups{id}}}`, { data });
  return result.updateMyProfile;
}

export async function getGroup(id: string) {
  setAuthHeader();
  const result = await request<{ group: Group }>(gql`
      query GetGroup($id: ID!) {
      group(id: $id) { id ownerID name description groupImage country countryCode countryFlag socialMedias { site discord x instagram facebook youtube tiktok } mangas { id title aliases description mangaka genders mangaCover trackers{myanimelist anilist animeplanet anidb} isAdult officialPublicationStatus officialTotalChapters externalMetadata{malId lastSyncedAt lastSyncError} translations{mangaID groupID language translationStatus calculatedTranslationStatus translationStatusOverride overridden group{id name}} } }
    }
  `, { id });
  return result.group;
}

export async function getMangaChapters(mangaId: string, groupId: string) {
  setAuthHeader();
  const result = await request<{ chaptersByManga: Chapter[] }>(gql`
    query GetChapters($mangaId: ID!, $groupId: ID!) {
      chaptersByManga(mangaId: $mangaId, groupId: $groupId) { id chapterNumber chapterTitle }
    }
  `, { mangaId, groupId });
  return result.chaptersByManga;
}

export async function getExistingChapterNumbers(mangaID: string, groupID: string) {
  setAuthHeader();
  const result = await request<{ existingChapterNumbers: number[] }>(gql`query($mangaID:ID!,$groupID:ID!){existingChapterNumbers(mangaID:$mangaID,groupID:$groupID)}`, { mangaID, groupID });
  return result.existingChapterNumbers;
}

export async function createChapter(input: { manga: string; group: string; chapterNumber: number; chapterTitle: string; chapterType: "MAIN" | "EXTRA" | "SPECIAL" | "ONESHOT"; pages: string[]; telegramPages: string[] }) {
  setAuthHeader();
  return request<{ createChapter: { id: string } }>(gql`
    mutation ($manga: ID!, $group: ID!, $data: CreateChapterInput!) {
      createChapter(mangaID: $manga, groupID: $group, data: $data) { id }
    }
  `, { manga: input.manga, group: input.group, data: { chapterNumber: input.chapterNumber, chapterTitle: input.chapterTitle, chapterType: input.chapterType, pages: input.pages, telegramPages: input.telegramPages } });
}

export async function setTranslationStatusOverride(mangaID: string, groupID: string, status: TranslationStatus | null) {
  setAuthHeader();
  const result = await request<{ setTranslationStatusOverride: MangaTranslation }>(gql`mutation($mangaID:ID!,$groupID:ID!,$status:TranslationStatus){setTranslationStatusOverride(mangaID:$mangaID,groupID:$groupID,status:$status){mangaID groupID language translationStatus calculatedTranslationStatus translationStatusOverride overridden group{id name}}}`, { mangaID, groupID, status });
  return result.setTranslationStatusOverride;
}

export async function syncMangaExternalMetadata(mangaID: string) {
  setAuthHeader();
  const result = await request<{ syncMangaExternalMetadata: Manga }>(gql`mutation($mangaID:ID!){syncMangaExternalMetadata(mangaID:$mangaID){id officialPublicationStatus officialTotalChapters externalMetadata{malId lastSyncedAt lastSyncError}}}`, { mangaID });
  return result.syncMangaExternalMetadata;
}

export async function linkMangaExternalMetadata(mangaID: string, malId: number) {
  setAuthHeader();
  const result = await request<{ linkMangaExternalMetadata: Manga }>(gql`mutation($mangaID:ID!,$malId:Int!){linkMangaExternalMetadata(mangaID:$mangaID,malId:$malId){id officialPublicationStatus officialTotalChapters externalMetadata{malId lastSyncedAt lastSyncError}}}`, { mangaID, malId });
  return result.linkMangaExternalMetadata;
}
