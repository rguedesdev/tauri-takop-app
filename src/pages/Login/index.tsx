// Imports Principais
import { useState } from "react";
import { useToast } from "../../context/ToastContext";

// Requisições GraphQL
import { signIn, getMe } from "../../services/graphql";

// Style Sheet CSS
import styles from "./login.module.css";

// Ícones
import { FaUser, FaLock } from "react-icons/fa";

// Imagens Estáticas
import Logo from "../../assets/tako-logo.png";

function Login({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const { showToast } = useToast();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const result = await signIn(login, password);
      localStorage.setItem("token", result.signIn.token);
      let user;
      try {
        user = await getMe();
      } catch (error) {
        localStorage.removeItem("token");
        throw new Error(`Login aceito, mas falhou ao carregar o perfil: ${error instanceof Error ? error.message : String(error)}`);
      }
      localStorage.setItem("user", JSON.stringify(user));
      onLogin();
    } catch (error) {
      console.error(error);
      const responseErrors = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { errors?: Array<{ message?: string }> } }).response?.errors
        : undefined;
      const message = responseErrors?.[0]?.message
        ?? (error instanceof Error ? error.message : "Não foi possível entrar.");
      showToast(message, "error");
    }
  }

  return (
    <div className={styles.loginPage}>
      <form className={styles.loginContainer} onSubmit={handleSubmit}>
        <img className={styles.logoImage} src={Logo} alt="Logo" />

        {/* <h1 className={styles.loginTitle}>Login</h1> */}

        <div className={styles.inputsContainer}>
          {/* 1. CAMPO COMPLEXO: USERNAME */}
          <div className={styles.fieldWrapper}>
            <label className={styles.fieldLabel}>Username ou Email</label>
            <div className={styles.inputRelativeContainer}>
              <input
                className={styles.loginInput}
                type="text"
                placeholder="Digite o Username..."
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
              <div className={styles.iconContainer}>
                <FaUser size={14} />
              </div>
            </div>
            <p className={styles.helpText}>Error Username</p>
          </div>

          {/* 2. CAMPO COMPLEXO: SENHA */}
          <div className={styles.fieldWrapper}>
            <label className={styles.fieldLabel}>Senha</label>
            <div className={styles.inputRelativeContainer}>
              <input
                className={styles.loginInput}
                type="password"
                placeholder="Digite a Senha..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className={styles.iconContainer}>
                <FaLock size={14} />
              </div>
            </div>
            <p className={styles.helpText}>Error Senha</p>
          </div>
        </div>

        <button className={styles.enterBtn}>Entrar</button>
      </form>
    </div>
  );
}

export default Login;
