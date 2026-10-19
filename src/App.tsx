import { useState } from "react";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Group from "./pages/Group";
import Manga from "./pages/Manga";
import CreateChapter from "./pages/CreateChapter";
import Catalog from "./pages/Catalog";
import ManageGroup from "./pages/ManageGroup";
import Profile from "./pages/Profile";
import Storage from "./pages/Storage";
import ReaderPinSync from "./components/ReaderPinSync";

// Sua Sidebar importada normalmente
import { Sidebar } from "./shared/components/Sidebar/index.tsx";

// Definição estrita do tipo Page para evitar estados inválidos
type Page =
  | { name: "login" }
  | { name: "home" }
  | { name: "group"; groupId: string }
  | { name: "manga"; mangaId: string; groupId: string }
  | { name: "createChapter"; mangaId: string; groupId: string }
  | { name: "catalog"; groupId?: string }
  | { name: "manageGroup"; groupId?: string }
  | { name: "profile" }
  | { name: "storage" };

export default function App() {
  const [page, setPage] = useState<Page>({ name: "login" });

  // 1. Se for a tela de login, renderiza pura (sem sidebar, sem flexbox, ocupa a tela toda)
  if (page.name === "login") {
    return <Login onLogin={() => setPage({ name: "home" })} />;
  }

  // 2. Para qualquer outra página, o React monta esse bloco com Flexbox estrutural
  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <ReaderPinSync />
      {/* 💥 AJUSTE AQUI: Passamos a função setPage para a Sidebar conseguir mudar as telas */}
      <Sidebar setPage={setPage} />

      {/* Área da direita que recebe as suas páginas e gerencia o scroll horizontal/vertical */}
      <main
        style={{
          flexGrow: 1,
          height: "100vh",
          overflowY: "auto",
          padding: "24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
          {page.name === "home" && (
            <Home
              onSelectGroup={(groupId: string) =>
                setPage({ name: "group", groupId })
              }
            />
          )}

          {page.name === "group" && (
            <Group
              groupId={page.groupId}
              onEditGroup={(groupId) => setPage({ name: "manageGroup", groupId })}
              onAddManga={(groupId) => setPage({ name: "catalog", groupId })}
              onSelectManga={(mangaId: string) =>
                setPage({ name: "manga", mangaId, groupId: page.groupId })
              }
            />
          )}

          {page.name === "manga" && (
            <Manga
              mangaId={page.mangaId}
              groupId={page.groupId}
              onCreateChapter={(mangaId: string) =>
                setPage({
                  name: "createChapter",
                  mangaId,
                  groupId: page.groupId,
                })
              }
            />
          )}

          {page.name === "createChapter" && (
            <CreateChapter
              mangaID={page.mangaId}
              groupID={page.groupId}
              back={() =>
                setPage({
                  name: "manga",
                  mangaId: page.mangaId,
                  groupId: page.groupId,
                })
              }
            />
          )}
          {page.name === "catalog" && <Catalog initialGroupID={page.groupId} />}
          {page.name === "manageGroup" && <ManageGroup initialGroupID={page.groupId} />}
          {page.name === "profile" && <Profile />}
          {page.name === "storage" && <Storage />}
        </div>
      </main>
    </div>
  );
}
