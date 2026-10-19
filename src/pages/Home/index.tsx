// Imports Principais
import { useEffect, useState } from "react";

// Requisições GraphQL
import { getMe, type CurrentUser } from "../../services/graphql";

// Style Sheet CSS
import styles from "./home.module.css";

// Imagens
import GroupPlaceholder from "../../assets/group-placeholder.svg";

// Icones
import { HiOutlineBookOpen } from "react-icons/hi2";
import { BiHash } from "react-icons/bi";
import { MdVerified } from "react-icons/md";

function Home({ onSelectGroup }: { onSelectGroup: (groupID: string) => void }) {
  const [user, setUser] = useState<CurrentUser | null>(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) as CurrentUser : null;
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const me = await getMe();

        setUser(me);
        localStorage.setItem("user", JSON.stringify(me));
      } catch (err) {
        console.error("getMe error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Usuário não encontrado</div>;

  return (
    <div className={styles.homePage}>
      <div className={styles.homeContainer}>
        <h2 className={styles.scansTitle}>Minhas Scans</h2>

        <div className={styles.scansGrid}>
          {user.groups?.length ? (
            user.groups.map((scan) => (
              <article
                onClick={() => onSelectGroup(scan.id)}
                key={scan.id}
                className={styles.scanCard}
              >
                <figure className={styles.scanContent}>
                  <img
                    className={styles.scanPicture}
                    src={scan.groupImage || GroupPlaceholder}
                    alt={`Imagem de ${scan.name}`}
                  />
                  <figcaption className={styles.scanInfo}>
                    <div>
                      <h2 className={styles.scanNameWrapper}>
                        <span className={styles.scanName}>{scan.name}</span>
                        <span title={scan.country}>{scan.countryFlag}</span>

                        <MdVerified
                          className={styles.verifiedBadge}
                          size={17}
                        />
                      </h2>
                      <p className={styles.scanDescription}>
                        {scan.description}
                      </p>
                    </div>

                    <div className={styles.scanMoreInfo}>
                      <div className={styles.scanManga}>
                        <HiOutlineBookOpen
                          className={styles.scanMangaIcon}
                          size={17}
                        />
                        <span>{`${scan.stats?.mangas ?? 0} Mangas`}</span>
                      </div>

                      <div className={styles.scanManga}>
                        <BiHash className={styles.scanMangaIcon} size={17} />
                        <span>{`${scan.stats?.chapters ?? 0} Caps`}</span>
                      </div>
                    </div>
                  </figcaption>
                </figure>
              </article>
            ))
          ) : (
            <div>Você ainda não possui nenhuma Scan cadastrada.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Home;
