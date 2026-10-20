// Imports Principais
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "../../shared/validation";
import type { z } from "zod";
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
  const { showToast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema), mode: "onTouched" });

  async function submit({ login, password }: z.infer<typeof signInSchema>) {
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
      <form className={styles.loginContainer} autoComplete="off" noValidate onSubmit={handleSubmit(submit)}>
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
                placeholder="Digite seu username ou email"
                autoComplete="off"
                aria-invalid={Boolean(errors.login)}
                aria-describedby={errors.login ? "login-error" : undefined}
                {...register("login")}
              />
              <div className={styles.iconContainer}>
                <FaUser size={14} />
              </div>
            </div>
            <p id="login-error" className={styles.helpText} role={errors.login ? "alert" : undefined}>{errors.login?.message ?? ""}</p>
          </div>

          {/* 2. CAMPO COMPLEXO: SENHA */}
          <div className={styles.fieldWrapper}>
            <label className={styles.fieldLabel}>Senha</label>
            <div className={styles.inputRelativeContainer}>
              <input
                className={styles.loginInput}
                type="password"
                placeholder="Digite sua senha"
                autoComplete="off"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              <div className={styles.iconContainer}>
                <FaLock size={14} />
              </div>
            </div>
            <p id="password-error" className={styles.helpText} role={errors.password ? "alert" : undefined}>{errors.password?.message ?? ""}</p>
          </div>
        </div>

        <button className={styles.enterBtn} disabled={isSubmitting}>{isSubmitting && <span className={styles.spinner} aria-hidden="true" />}{isSubmitting ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}

export default Login;
