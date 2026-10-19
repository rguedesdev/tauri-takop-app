import { useEffect, useState } from "react";
import { getGroup, type Group as GroupData } from "../../services/graphql";

// Style Sheet CSS
import styles from "./group.module.css";

// Ícones (Adicionei baseado no seu bloco de código)
import { GiEvilBook } from "react-icons/gi";
import { RiQuillPenLine } from "react-icons/ri";
import { FiEdit2 } from "react-icons/fi";
import { RiAddLine } from "react-icons/ri";

// Imagens Estáticas
import GroupPlaceholder from "../../assets/group-placeholder.svg";
import MangaPlaceholder from "../../assets/manga-placeholder.svg";

interface GroupProps { groupId: string; onSelectManga: (mangaID: string, groupID: string) => void; onEditGroup: (groupID: string) => void; onAddManga: (groupID: string) => void }
function Group({ groupId, onSelectManga, onEditGroup, onAddManga }: GroupProps) {
  const [group, setGroup] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getGroup(groupId);
        setGroup(data);
      } catch (e) {
        console.error(e);
        setGroup(null);
      } finally {
        setLoading(false);
      }
    }

    if (groupId) {
      load();
    }
  }, [groupId]);

  if (loading) return <div>Loading...</div>;
  if (!group) return <div>Grupo não encontrado</div>;

  return (
    <div className={styles.groupPage}>
      <div className={styles.groupContainer}>
        <div className={styles.groupHeader}>
          <img
            className={styles.profileImage}
            src={group.groupImage || GroupPlaceholder}
            alt="Profile Image"
          />
          <div className={styles.mangasHeaderTexts}>
            <h1 className={styles.name}>{group.name}</h1>
            <span>{group.countryFlag} {group.country}</span>
            <p>{group.description}</p>
          </div>
          <button className={styles.editGroupButton} type="button" onClick={() => onEditGroup(group.id)}>
            <FiEdit2 size={16} />
            Editar informações
          </button>
        </div>

        <hr className={styles.hrFaded} />

        <div className={styles.mangasSectionHeader}>
          <h2 className={styles.mangasTitle}>Mangas</h2>
          <button className={styles.addMangaButton} type="button" onClick={() => onAddManga(group.id)}>
            <RiAddLine size={18} />
            Adicionar manga
          </button>
        </div>

        {/* Inserido o seu layout customizado de cards aqui dentro do Grid */}
        <div className={styles.mangasGrid}>
          {group.mangas?.length ? (
            group.mangas.map((manga) => (
              <div
                key={manga.id}
                role="button"
                tabIndex={0}
                className={styles.cardLink}
                onClick={() => onSelectManga(manga.id, groupId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectManga(manga.id, groupId);
                  }
                }}
                style={{ cursor: "pointer" }} // Garante o feedback visual de clique
              >
                <article className={styles.mangaCard}>
                  <figure>
                    <div className={styles.mangaWraper}>
                      <img
                        className={styles.mangaCover}
                        src={manga.mangaCover || MangaPlaceholder}
                        alt="Manga Cover"
                      />
                    </div>

                    <figcaption className={styles.mangaInfo}>
                      <div className={styles.mangaInfoLine}>
                        <GiEvilBook size={16} />
                        <span>{manga.title}{manga.isAdult ? " · +18" : ""}</span>
                      </div>

                      <hr className={styles.hrFaded} />

                      <div className={styles.mangaInfoLine}>
                        <RiQuillPenLine size={16} />
                        <span>{manga.mangaka}</span>
                      </div>
                    </figcaption>
                  </figure>
                </article>
              </div>
            ))
          ) : (
            <div>Nenhum manga encontrado neste grupo.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Group;
