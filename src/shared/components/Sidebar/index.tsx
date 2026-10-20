import { useState } from "react";
import { FaBars, FaTimes, FaUserCircle } from "react-icons/fa";
import { FiLogOut } from "react-icons/fi";
import { MdStorage } from "react-icons/md";
import styles from "./sidebar.module.css";

import { RxDashboard } from "react-icons/rx";
import { ImMakeGroup } from "react-icons/im";

// Imagens Estáticas importadas corretamente via ESM
import Logo from "../../../assets/tako-logo.png";

// 1. Replicamos o tipo exato de Page do App para manter o TypeScript fortemente tipado
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

// 2. Tipamos as Props que a nossa Sidebar aceita receber
interface SidebarProps {
  setPage: React.Dispatch<React.SetStateAction<Page>>;
  onLogout: () => void;
}

export function Sidebar({ setPage, onLogout }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <aside
      className={`${styles.verticalSidebar} ${isOpen ? styles.expanded : styles.collapsed}`}
    >
      <nav className={styles.nav}>
        <header className={styles.header}>
          {/* Botão de Toggle */}
          <div className={styles.sidebarToggleContainer}>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={styles.navToggle}
              type="button"
            >
              <span className={styles.toggleIcons}>
                {isOpen ? <FaTimes size={20} /> : <FaBars size={20} />}
              </span>
            </button>
          </div>

          <figure className={styles.figure}>
            <img className={styles.logo} src={Logo} alt="Logo" />
            {isOpen && <figcaption className={styles.figcaption}></figcaption>}
          </figure>
        </header>

        <section className={styles.sidebarWrapper}>
          <ul className={styles.sidebarList}>
            {isOpen && (
              <li className={`${styles.sidebarItem} ${styles.itemHeading}`}>
                <h2 className={styles.sidebarItemHeading}>Geral</h2>
              </li>
            )}

            <li className={styles.sidebarItem}>
              <button
                type="button"
                className={styles.sidebarLink}
                onClick={() => setPage({ name: "home" })}
              >
                <span className={styles.icon}>
                  <RxDashboard size={18} />
                </span>
                {isOpen && <span className={styles.text}>Visão geral</span>}
              </button>
            </li>
            <li className={styles.sidebarItem}>
              <button
                type="button"
                className={styles.sidebarLink}
                onClick={() => setPage({ name: "manageGroup" })}
              >
                <span className={styles.icon}>
                  <ImMakeGroup size={16} />
                </span>
                {isOpen && <span className={styles.text}>Gerenciar grupos</span>}
              </button>
            </li>

            {/* <li className={styles.sidebarItem}>
              <a className={styles.sidebarLink} href="#" data-tooltip="Sent">
                <span className={styles.icon}>
                  <FaRegPaperPlane size={18} />
                </span>
                {isOpen && <span className={styles.text}>Sent</span>}
              </a>
            </li> */}
          </ul>

          <ul className={styles.sidebarList}>
            {isOpen && (
              <li className={`${styles.sidebarItem} ${styles.itemHeading}`}>
                <h2 className={styles.sidebarItemHeading}>Conta</h2>
              </li>
            )}

            <li className={styles.sidebarItem}>
              <button
                className={styles.sidebarLink}
                type="button"
                onClick={() => setPage({ name: "profile" })}
              >
                <span className={styles.icon}>
                  <FaUserCircle size={18} />
                </span>
                {isOpen && <span className={styles.text}>Perfil</span>}
              </button>
            </li>

            <li className={styles.sidebarItem}>
              <button
                className={styles.sidebarLink}
                type="button"
                onClick={() => setPage({ name: "storage" })}
                data-tooltip="Armazenamento IPFS"
              >
                <span className={styles.icon}>
                  <MdStorage size={20} />
                </span>
                {isOpen && <span className={styles.text}>Armazenamento IPFS</span>}
              </button>
            </li>
          </ul>
        </section>

        <ul className={`${styles.sidebarList} ${styles.logoutList}`}>
          <li className={styles.sidebarItem}>
            <button type="button" className={styles.sidebarLink} onClick={onLogout}>
              <span className={styles.icon}><FiLogOut size={18} /></span>
              {isOpen && <span className={styles.text}>Sair</span>}
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
