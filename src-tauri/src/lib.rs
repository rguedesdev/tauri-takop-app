use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Cursor},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[derive(Default)]
struct IpfsChildren {
    groups: Option<Child>,
    reader: Option<Child>,
}

struct IpfsProcess(Mutex<IpfsChildren>);

const MIN_IPFS_STORAGE_GB: f64 = 10.0;
const MIN_READER_STORAGE_GB: f64 = 1.0;
const BYTES_PER_GB: f64 = 1_073_741_824.0;

fn default_reader_storage_gb() -> f64 { MIN_READER_STORAGE_GB }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoragePreferences {
    max_storage_gb: f64,
    #[serde(default)]
    reader_collaboration_enabled: bool,
    #[serde(default = "default_reader_storage_gb")]
    reader_storage_gb: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IpfsStorageStatus {
    configured_storage_gb: f64,
    effective_storage_max: Option<String>,
    used_bytes: Option<u64>,
    storage_error: Option<String>,
}

fn reader_repo() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("takop/ipfs/collaborator-repo")
}

fn migrate_legacy_reader_repo() -> Result<(), String> {
    let data_dir = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("takop/ipfs");
    let legacy = data_dir.join("reader-repo");
    let collaborator = reader_repo();
    migrate_repo_directory(&legacy, &collaborator, "collaborator-repo")
}

fn migrate_repo_directory(legacy: &Path, current: &Path, name: &str) -> Result<(), String> {
    if current.exists() || !legacy.exists() {
        return Ok(());
    }
    fs::rename(legacy, current)
        .map_err(|error| format!("Não foi possível mover os dados antigos para {name}: {error}"))
}

fn storage_preferences_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("takop/ipfs/storage.json")
}

fn storage_preferences() -> StoragePreferences {
    fs::read_to_string(storage_preferences_path()).ok().and_then(|contents| serde_json::from_str::<StoragePreferences>(&contents).ok()).unwrap_or(StoragePreferences { max_storage_gb: MIN_IPFS_STORAGE_GB, reader_collaboration_enabled: false, reader_storage_gb: default_reader_storage_gb() })
}

fn reader_storage_gb() -> f64 {
    let value = storage_preferences().reader_storage_gb;
    if value.is_finite() && value >= MIN_READER_STORAGE_GB { value } else { default_reader_storage_gb() }
}

fn configured_storage_gb() -> f64 {
    Some(storage_preferences().max_storage_gb)
        .filter(|value| *value >= MIN_IPFS_STORAGE_GB)
        .unwrap_or(MIN_IPFS_STORAGE_GB)
}

fn apply_storage_limit(bin: &PathBuf, repo: &PathBuf) -> Result<(), String> {
    let storage_max = format!("{}B", (configured_storage_gb() * BYTES_PER_GB) as u64);
    let output = Command::new(bin)
        .args(["config", "Datastore.StorageMax", &storage_max])
        .env("IPFS_PATH", repo)
        .output()
        .map_err(|error| format!("Não foi possível configurar o limite do IPFS: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Não foi possível configurar o limite do IPFS: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn directory_size(root: &Path) -> Result<u64, String> {
    if !root.exists() {
        return Ok(0);
    }

    let mut total = 0_u64;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory)
            .map_err(|error| format!("Não foi possível ler {}: {error}", directory.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                total = total.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            }
        }
    }
    Ok(total)
}

fn repo_size_bytes(repo: &Path) -> Result<u64, String> {
    let api_size = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| client.post("http://127.0.0.1:5001/api/v0/repo/stat").send().ok())
        .filter(|response| response.status().is_success())
        .and_then(|response| response.json::<serde_json::Value>().ok())
        .and_then(|value| value.get("RepoSize").and_then(serde_json::Value::as_u64));
    if let Some(size) = api_size {
        return Ok(size);
    }
    directory_size(repo)
}

fn repo_storage_max(repo: &Path, fallback_gb: f64) -> Option<String> {
    let configured = fs::read_to_string(repo.join("config"))
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|value| value.get("Datastore")?.get("StorageMax")?.as_str().map(str::to_owned));
    configured.or_else(|| Some(format!("{fallback_gb}GB")))
}

#[tauri::command]
async fn get_ipfs_storage_status() -> IpfsStorageStatus {
    if let Err(error) = migrate_legacy_group_repo() {
        eprintln!("⚠️ {error}");
    }
    let configured_storage_gb = configured_storage_gb();
    let repo = ipfs_repo();
    let repo_for_size = repo.clone();
    let usage = tauri::async_runtime::spawn_blocking(move || repo_size_bytes(&repo_for_size)).await;
    let (used_bytes, storage_error) = match usage {
        Ok(Ok(size)) => (Some(size), None),
        Ok(Err(error)) => (None, Some(error)),
        Err(error) => (None, Some(format!("Falha ao medir o repositório IPFS: {error}"))),
    };
    IpfsStorageStatus {
        configured_storage_gb,
        effective_storage_max: repo_storage_max(&repo, configured_storage_gb),
        used_bytes,
        storage_error,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReaderStorageStatus {
    enabled: bool,
    running: bool,
    configured_storage_gb: f64,
    used_bytes: u64,
}

#[tauri::command]
fn get_reader_storage_status() -> ReaderStorageStatus {
    if let Err(error) = migrate_legacy_reader_repo() {
        eprintln!("⚠️ {error}");
    }
    let repo = reader_repo();
    let used_bytes = directory_size(&repo.join("blocks")).unwrap_or(0);
    ReaderStorageStatus {
        enabled: storage_preferences().reader_collaboration_enabled,
        running: reader_ipfs_api_is_ready(),
        configured_storage_gb: reader_storage_gb(),
        used_bytes,
    }
}

#[tauri::command]
fn set_reader_storage_limit(storage_gb: f64) -> Result<f64, String> {
    if !storage_gb.is_finite() || storage_gb < MIN_READER_STORAGE_GB {
        return Err(format!("O espaço mínimo para colaboração como leitor é de {MIN_READER_STORAGE_GB:.1} GB."));
    }
    let path = storage_preferences_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let mut preferences = storage_preferences();
    preferences.reader_storage_gb = storage_gb;
    let contents = serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())?;
    Ok(storage_gb)
}

#[tauri::command]
fn get_reader_collaboration_enabled() -> bool { storage_preferences().reader_collaboration_enabled }

#[tauri::command]
fn set_reader_collaboration_enabled(enabled: bool) -> Result<bool, String> {
    let path = storage_preferences_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let mut preferences = storage_preferences();
    preferences.reader_collaboration_enabled = enabled;
    let contents = serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())?;
    Ok(enabled)
}

#[tauri::command]
fn set_ipfs_storage_limit(storage_gb: f64) -> Result<f64, String> {
    if !storage_gb.is_finite() || storage_gb < MIN_IPFS_STORAGE_GB {
        return Err(format!(
            "O armazenamento mínimo para o nó é de {MIN_IPFS_STORAGE_GB} GB."
        ));
    }
    let path = storage_preferences_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut preferences = storage_preferences();
    preferences.max_storage_gb = storage_gb;
    let contents = serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())?;
    Ok(storage_gb)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadedImage {
    name: String,
    cid: String,
    telegram_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterUploadProgress {
    completed: usize,
    total: usize,
    file_name: String,
    stage: String,
    error: Option<String>,
}

fn emit_chapter_upload_progress(app: &tauri::AppHandle, progress: ChapterUploadProgress) {
    let _ = app.emit("chapter-upload-progress", progress);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterFolderInfo {
    path: String,
    folder_name: String,
    page_names: Vec<String>,
}

fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn telegram_upload_filename(name: &str, mime: &str) -> String {
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => return name.to_string(),
    };
    let stem = Path::new(name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    format!("{stem}.{extension}")
}

fn is_supported_image(path: &PathBuf) -> bool {
    path.is_file()
        && !path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with('.')
        && matches!(
            path.extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .as_str(),
            "png" | "jpg" | "jpeg" | "webp"
        )
}

fn natural_sort_key(path: &PathBuf) -> String {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mut key = String::new();
    let mut digits = String::new();
    for character in name.chars().chain(std::iter::once('\0')) {
        if character.is_ascii_digit() {
            digits.push(character);
        } else {
            if !digits.is_empty() {
                key.push_str(&format!("#{:0>24}", digits));
                digits.clear();
            }
            if character != '\0' {
                key.push(character);
            }
        }
    }
    key
}

#[cfg(test)]
mod batch_folder_tests {
    use super::*;

    #[test]
    fn sorts_page_names_naturally() {
        let mut pages = vec![
            PathBuf::from("10.jpg"),
            PathBuf::from("2.jpg"),
            PathBuf::from("1.jpg"),
        ];
        pages.sort_by_key(natural_sort_key);
        assert_eq!(
            pages,
            vec![
                PathBuf::from("1.jpg"),
                PathBuf::from("2.jpg"),
                PathBuf::from("10.jpg")
            ]
        );
    }

    #[test]
    fn inspects_only_supported_images_inside_chapter_folders() {
        let root = std::env::temp_dir().join(format!("tako-batch-test-{}", std::process::id()));
        let chapter = root.join("Capitulo 2");
        fs::create_dir_all(&chapter).unwrap();
        fs::write(chapter.join("10.jpg"), b"page").unwrap();
        fs::write(chapter.join("2.png"), b"page").unwrap();
        fs::write(chapter.join("notes.txt"), b"ignore").unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();

        let result = inspect_manga_folder(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].folder_name, "Capitulo 2");
        assert_eq!(result[0].page_names, vec!["2.png", "10.jpg"]);

        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
fn inspect_manga_folder(folder: String) -> Result<Vec<ChapterFolderInfo>, String> {
    let mut chapter_directories = fs::read_dir(&folder)
        .map_err(|error| format!("Não foi possível ler a pasta da obra: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().is_dir() && !entry.file_name().to_string_lossy().starts_with('.')
        })
        .collect::<Vec<_>>();
    chapter_directories.sort_by_key(|entry| natural_sort_key(&entry.path()));

    let mut chapters = Vec::new();
    for directory in chapter_directories {
        let path = directory.path();
        let mut pages = fs::read_dir(&path)
            .map_err(|error| format!("Não foi possível ler {}: {error}", path.display()))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(is_supported_image)
            .collect::<Vec<_>>();
        pages.sort_by_key(natural_sort_key);
        if pages.is_empty() {
            continue;
        }
        chapters.push(ChapterFolderInfo {
            path: path.to_string_lossy().to_string(),
            folder_name: directory.file_name().to_string_lossy().to_string(),
            page_names: pages
                .iter()
                .map(|page| {
                    page.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                })
                .collect(),
        });
    }

    if chapters.is_empty() {
        return Err("Nenhuma subpasta com imagens PNG, JPG, JPEG ou WEBP foi encontrada.".into());
    }
    Ok(chapters)
}

// Versão do IPFS Kubo que desejamos utilizar
const IPFS_VERSION: &str = "v0.31.0";

/* =========================
   Caminhos Dinâmicos (Pasta de Dados do App)
========================= */
fn ipfs_bin_dir() -> PathBuf {
    dirs::data_local_dir().unwrap().join("takop/ipfs/bin")
}

fn ipfs_bin() -> PathBuf {
    ipfs_bin_dir().join(if cfg!(target_os = "windows") {
        "ipfs.exe"
    } else {
        "ipfs"
    })
}

fn ipfs_repo() -> PathBuf {
    dirs::data_local_dir().unwrap().join("takop/ipfs/groups-repo")
}

fn migrate_legacy_group_repo() -> Result<(), String> {
    let data_dir = dirs::data_local_dir().unwrap().join("takop/ipfs");
    migrate_repo_directory(&data_dir.join("repo"), &ipfs_repo(), "groups-repo")
}

/* =========================
   DOWNLOAD E EXTRAÇÃO AUTOMÁTICA
========================= */
fn download_ipfs_if_needed() -> Result<(), String> {
    let bin_path = ipfs_bin();
    if bin_path.exists() {
        return Ok(()); // Já baixado!
    }

    println!(
        "📥 Binário do IPFS não encontrado. Iniciando download da versão {}...",
        IPFS_VERSION
    );
    let bin_dir = ipfs_bin_dir();
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    // Define a URL baseada no Sistema Operacional e Arquitetura
    let url = if cfg!(target_os = "windows") {
        format!(
            "https://dist.ipfs.tech/kubo/{}/kubo_{}_windows-amd64.zip",
            IPFS_VERSION, IPFS_VERSION
        )
    } else if cfg!(target_os = "macos") {
        format!(
            "https://dist.ipfs.tech/kubo/{}/kubo_{}_darwin-amd64.tar.gz",
            IPFS_VERSION, IPFS_VERSION
        )
    } else {
        // Padrão Linux (amd64)
        format!(
            "https://dist.ipfs.tech/kubo/{}/kubo_{}_linux-amd64.tar.gz",
            IPFS_VERSION, IPFS_VERSION
        )
    };

    // Baixa o arquivo para a memória
    let response = reqwest::blocking::get(&url)
        .map_err(|e| format!("Falha ao baixar IPFS: {}", e))?
        .bytes()
        .map_err(|e| format!("Falha ao ler bytes do download: {}", e))?;

    let cursor = Cursor::new(response);

    // Extrai o binário de dentro do pacote compactado oficial
    if url.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            if file.name().ends_with("ipfs.exe") {
                let mut out_file = File::create(&bin_path).map_err(|e| e.to_string())?;
                io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
                break;
            }
        }
    } else {
        // .tar.gz (Linux / macOS)
        let tar_gz = flate2::read::GzDecoder::new(cursor);
        let mut archive = tar::Archive::new(tar_gz);
        let entries = archive.entries().map_err(|e| e.to_string())?;

        for entry in entries {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?;
            if path.file_name().unwrap_or_default() == "ipfs" {
                entry.unpack(&bin_path).map_err(|e| e.to_string())?;

                // No Linux, precisamos dar permissão de execução ao binário extraído
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mut perms = fs::metadata(&bin_path)
                        .map_err(|e| e.to_string())?
                        .permissions();
                    perms.set_mode(0o755); // rwxr-xr-x
                    fs::set_permissions(&bin_path, perms).map_err(|e| e.to_string())?;
                }
                break;
            }
        }
    }

    println!("✅ IPFS baixado e extraído com sucesso em: {:?}", bin_path);
    Ok(())
}

/* =========================
   INIT REPO
========================= */
fn init_repo(bin: &PathBuf, repo: &PathBuf) -> Result<(), String> {
    if repo.exists() {
        return Ok(());
    }
    fs::create_dir_all(repo).map_err(|e| e.to_string())?;

    let out = Command::new(bin)
        .args(["init", "--profile=lowpower"])
        .env("IPFS_PATH", repo)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/* =========================
   START DAEMON
========================= */
fn prepare_reader_repo() -> Result<(), String> {
    migrate_legacy_reader_repo()?;
    let bin = ipfs_bin();
    let repo = reader_repo();
    init_repo(&bin, &repo)?;
    let max = format!("{}B", (reader_storage_gb() * BYTES_PER_GB) as u64);
    for args in [
        vec!["config", "Addresses.API", "/ip4/127.0.0.1/tcp/5002"],
        vec!["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/8082"],
        vec!["config", "Datastore.StorageMax", &max],
    ] {
        let output = Command::new(&bin).args(args).env("IPFS_PATH", &repo).output().map_err(|error| format!("Não foi possível configurar o nó separado do leitor: {error}"))?;
        if !output.status.success() { return Err(format!("Não foi possível configurar o nó separado do leitor: {}", String::from_utf8_lossy(&output.stderr))); }
    }
    let swarm_addrs = r#"["/ip4/0.0.0.0/tcp/4002","/ip4/0.0.0.0/udp/4002/quic-v1","/ip6/::/tcp/4002","/ip6/::/udp/4002/quic-v1"]"#;
    let output = Command::new(&bin).args(["config", "--json", "Addresses.Swarm", swarm_addrs]).env("IPFS_PATH", &repo).output().map_err(|error| format!("Não foi possível configurar as portas do nó leitor: {error}"))?;
    if !output.status.success() { return Err(format!("Não foi possível configurar as portas do nó leitor: {}", String::from_utf8_lossy(&output.stderr))); }
    Ok(())
}

fn reader_ipfs_api_is_ready() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| client.post("http://127.0.0.1:5002/api/v0/id").send().ok())
        .is_some_and(|response| response.status().is_success())
}

fn start_reader_ipfs_daemon() -> Result<Option<Child>, String> {
    download_ipfs_if_needed()?;
    let bin = ipfs_bin();
    let repo = reader_repo();
    prepare_reader_repo()?;
    if reader_ipfs_api_is_ready() { return Ok(None); }

    let mut child = Command::new(&bin)
        .arg("daemon")
        .env("IPFS_PATH", &repo)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Não foi possível iniciar o nó IPFS do leitor: {error}"))?;

    for _ in 0..40 {
        thread::sleep(Duration::from_millis(500));
        if reader_ipfs_api_is_ready() { return Ok(Some(child)); }
        if let Some(status) = child.try_wait().map_err(|error| format!("Não foi possível verificar o nó IPFS do leitor: {error}"))? {
            return Err(format!("O nó IPFS do leitor encerrou durante a inicialização ({status})."));
        }
    }
    let _ = child.kill();
    Err("O nó IPFS do leitor não abriu a API local na porta 5002.".into())
}

fn is_safe_reader_backup_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" { return false; }
    let Some(host) = url.host_str() else { return false; };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") { return false; }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(address) => {
                let octets = address.octets();
                !(address.is_private() || address.is_loopback() || (octets[0] == 169 && octets[1] == 254) || address.is_unspecified() || address.is_multicast())
            }
            std::net::IpAddr::V6(address) => {
                !(address.is_loopback() || address.is_unspecified() || address.is_multicast() || (address.segments()[0] & 0xfe00 == 0xfc00) || (address.segments()[0] & 0xffc0 == 0xfe80))
            }
        };
    }
    true
}

fn pin_reader_content_blocking(cid: String, telegram_url: Option<String>) -> Result<(), String> {
    if cid.len() < 40 || cid.len() > 120 || !cid.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("CID inválido para armazenamento colaborativo.".into());
    }
    if !reader_ipfs_api_is_ready() { return Err("O nó IPFS do leitor ainda não está ativo. Reinicie o Takop após ativar a colaboração.".into()); }

    let bin = ipfs_bin();
    let repo = reader_repo();
    let pin = Command::new(&bin).args(["pin", "add", "--progress=false", &cid]).env("IPFS_PATH", &repo).output().map_err(|error| format!("Falha ao solicitar o CID ao IPFS: {error}"))?;
    if pin.status.success() { return Ok(()); }
    let pin_error = String::from_utf8_lossy(&pin.stderr).trim().to_string();

    let Some(telegram_url) = telegram_url else {
        return Err(if pin_error.is_empty() { "CID ainda não disponível na rede IPFS.".into() } else { pin_error });
    };
    let parsed_url = reqwest::Url::parse(&telegram_url).map_err(|_| "URL de reserva inválida.".to_string())?;
    if !is_safe_reader_backup_url(&parsed_url) { return Err("A URL de reserva não é HTTPS pública e segura.".into()); }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !is_safe_reader_backup_url(attempt.url()) { attempt.stop() } else { attempt.follow() }
        }))
        .build()
        .map_err(|error| format!("Falha ao preparar o download de reserva: {error}"))?;
    let response = client.get(parsed_url).send().map_err(|error| format!("CID indisponível no IPFS e falha ao buscar a reserva: {error}"))?;
    if !response.status().is_success() { return Err(format!("A reserva retornou HTTP {}.", response.status())); }
    if response.content_length().is_some_and(|length| length > 50_000_000) { return Err("A página excede o limite permitido de 50 MB.".into()); }
    let bytes = response.bytes().map_err(|error| format!("Falha ao ler a página de reserva: {error}"))?;
    if bytes.len() > 50_000_000 || detect_image_mime(&bytes).is_none() { return Err("A reserva não retornou uma imagem válida de até 50 MB.".into()); }

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temporary_file = std::env::temp_dir().join(format!("takop-reader-{}-{nonce}.img", std::process::id()));
    fs::write(&temporary_file, &bytes).map_err(|error| format!("Falha ao preparar a página para o IPFS: {error}"))?;
    let add = Command::new(&bin).args(["add", "-Q", "--cid-version=1", "--pin=true", temporary_file.to_string_lossy().as_ref()]).env("IPFS_PATH", &repo).output();
    let _ = fs::remove_file(&temporary_file);
    let add = add.map_err(|error| format!("Falha ao importar a página de reserva: {error}"))?;
    if !add.status.success() { return Err(format!("Falha ao importar a página de reserva: {}", String::from_utf8_lossy(&add.stderr).trim())); }
    let imported_cid = String::from_utf8_lossy(&add.stdout).trim().to_string();
    if imported_cid != cid {
        let _ = Command::new(&bin).args(["pin", "rm", &imported_cid]).env("IPFS_PATH", &repo).output();
        return Err("A imagem de reserva não corresponde ao CID publicado; ela não foi mantida no nó.".into());
    }
    Ok(())
}

#[tauri::command]
async fn is_reader_ipfs_running() -> bool {
    tauri::async_runtime::spawn_blocking(reader_ipfs_api_is_ready).await.unwrap_or(false)
}

#[tauri::command]
async fn pin_reader_content(cid: String, telegram_url: Option<String>) -> Result<(), String> {
    if !storage_preferences().reader_collaboration_enabled { return Err("Ative o armazenamento de colaborador antes de fixar capítulos.".into()); }
    tauri::async_runtime::spawn_blocking(move || pin_reader_content_blocking(cid, telegram_url))
        .await
        .map_err(|error| format!("A tarefa de armazenamento foi interrompida: {error}"))?
}

fn stop_ipfs_children(app: &tauri::AppHandle) {
    let state = app.state::<IpfsProcess>();
    let mut processes = state.0.lock().unwrap();
    if let Some(mut child) = processes.reader.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut child) = processes.groups.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn restart_ipfs_nodes(app: tauri::AppHandle) -> Result<(), String> {
    stop_ipfs_children(&app);
    if let Some(child) = start_ipfs_daemon()? {
        app.state::<IpfsProcess>().0.lock().unwrap().groups = Some(child);
    }
    if storage_preferences().reader_collaboration_enabled {
        if let Some(child) = start_reader_ipfs_daemon()? {
            app.state::<IpfsProcess>().0.lock().unwrap().reader = Some(child);
        }
    }
    Ok(())
}

#[tauri::command]
async fn restart_storage_nodes(
    app: tauri::AppHandle,
    group_storage_gb: f64,
    reader_storage_gb: f64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_ipfs_storage_limit(group_storage_gb)?;
        set_reader_storage_limit(reader_storage_gb)?;
        restart_ipfs_nodes(app)
    })
        .await
        .map_err(|error| format!("Falha ao reiniciar os nós IPFS: {error}"))?
}

fn start_ipfs_daemon() -> Result<Option<Child>, String> {
    download_ipfs_if_needed()?;
    migrate_legacy_group_repo()?;

    let bin = ipfs_bin();
    let repo = ipfs_repo();
    init_repo(&bin, &repo)?;

    // The local Telegram FileStream service uses port 8080. Keep Kubo's
    // optional HTTP gateway on a separate port so it cannot prevent startup.
    let gateway = Command::new(&bin)
        .args(["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/8081"])
        .env("IPFS_PATH", &repo)
        .output()
        .map_err(|e| format!("Erro ao configurar gateway IPFS: {e}"))?;
    if !gateway.status.success() {
        return Err(format!(
            "Erro ao configurar gateway IPFS: {}",
            String::from_utf8_lossy(&gateway.stderr)
        ));
    }

    apply_storage_limit(&bin, &repo)?;

    let api = "http://127.0.0.1:5001/api/v0/id";
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Erro ao criar cliente da API IPFS: {e}"))?;

    let api_is_ready = || {
        http.post(api)
            .send()
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    };

    if api_is_ready() {
        println!("🟢 IPFS já estava ativo.");
        // The app must not try to stop a daemon it did not start.
        return Ok(None);
    }

    println!("🚀 Iniciando IPFS daemon em background...");
    let mut child = Command::new(&bin)
        .arg("daemon")
        .env("IPFS_PATH", &repo)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Erro ao iniciar daemon: {e}"))?;

    for _ in 0..40 {
        thread::sleep(Duration::from_millis(500));
        if api_is_ready() {
            println!("🟢 IPFS Daemon pronto para uso!");
            return Ok(Some(child));
        }
        if let Some(status) = child.try_wait().map_err(|e| format!("Erro ao verificar daemon IPFS: {e}"))? {
            return Err(format!("Daemon IPFS encerrou durante a inicialização ({status}). Verifique o log acima."));
        }
    }

    let _ = child.kill();
    Err("Daemon IPFS não abriu a API local na porta 5001 dentro do tempo esperado".into())
}

/* =========================
   UPLOAD COMMAND
========================= */
#[tauri::command]
async fn upload_folder_to_ipfs(
    app: tauri::AppHandle,
    folder: String,
    api_url: String,
    auth_token: String,
) -> Result<Vec<UploadedImage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        upload_folder_to_ipfs_blocking(app, folder, api_url, auth_token)
    })
    .await
    .map_err(|error| format!("A tarefa de upload foi interrompida: {error}"))?
}

fn upload_folder_to_ipfs_blocking(
    app: tauri::AppHandle,
    folder: String,
    api_url: String,
    auth_token: String,
) -> Result<Vec<UploadedImage>, String> {
    let bin = ipfs_bin();
    let repo = ipfs_repo();
    let mut result = Vec::new();
    let http = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Não foi possível configurar o cliente HTTP do upload: {error}"))?;

    // 1. Coleta todas as entradas do diretório em um vetor
    let mut entries = fs::read_dir(folder)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // Remove erros de leitura individuais
        .collect::<Vec<_>>();

    // Mantém o fluxo de upload existente, usando ordem natural (1, 2, 10).
    entries.sort_by_key(|entry| natural_sort_key(&entry.path()));
    let total = entries.iter().filter(|entry| is_supported_image(&entry.path())).count();

    let incoming_bytes = entries
        .iter()
        .filter(|entry| is_supported_image(&entry.path()))
        .try_fold(0_u64, |total, entry| {
            entry
                .metadata()
                .map(|metadata| total.saturating_add(metadata.len()))
                .map_err(|error| format!("Não foi possível calcular o espaço do upload: {error}"))
        })?;
    let used_bytes = repo_size_bytes(&repo)?;
    let configured_limit_gb = configured_storage_gb();
    let max_bytes = (configured_limit_gb * BYTES_PER_GB) as u64;
    if used_bytes.saturating_add(incoming_bytes) > max_bytes {
        return Err(format!(
            "Sem espaço no nó IPFS: o limite é {:.1} GB, mas já há {:.1} MB em uso e este capítulo precisa de {:.1} MB. Aumente o limite de armazenamento.",
            configured_limit_gb,
            used_bytes as f64 / 1_048_576.0,
            incoming_bytes as f64 / 1_048_576.0
        ));
    }

    // 3. Agora o loop vai seguir a sequência correta de leitura
    for entry in entries {
        let path = entry.path();
        if !is_supported_image(&path) {
            continue;
        }

        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let completed = result.len();
        emit_chapter_upload_progress(&app, ChapterUploadProgress {
            completed, total, file_name: name.clone(), stage: "ipfs".into(), error: None,
        });

        let bytes = fs::read(&path).map_err(|error| format!("Não foi possível ler {name}: {error}"))?;
        let mime = detect_image_mime(&bytes)
            .ok_or_else(|| format!("{name} não contém uma imagem JPEG, PNG ou WebP válida."))?;
        let upload_name = telegram_upload_filename(&name, mime);

        let output = match Command::new(&bin)
            .args([
                "add",
                "-Q",
                "--cid-version=1",
                "--pin=true",
                path.to_str().unwrap(),
            ])
            .env("IPFS_PATH", &repo)
            .output() {
            Ok(output) => output,
            Err(error) => {
                let reason = format!("Falha ao iniciar o IPFS para armazenar {name}: {error}");
                emit_chapter_upload_progress(&app, ChapterUploadProgress {
                    completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
                });
                return Err(reason);
            }
        };

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let reason = format!("Falha no IPFS ao armazenar {name}: {}", if detail.is_empty() { output.status.to_string() } else { detail });
            emit_chapter_upload_progress(&app, ChapterUploadProgress {
                completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
            });
            return Err(reason);
        }

        let cid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        emit_chapter_upload_progress(&app, ChapterUploadProgress {
            completed, total, file_name: name.clone(), stage: "telegram".into(), error: None,
        });
        let part = reqwest::blocking::multipart::Part::bytes(bytes)
            .file_name(upload_name)
            .mime_str(mime)
            .map_err(|error| error.to_string())?;
        let response = match http
            .post(format!(
                "{}/uploads/chapter-pages/telegram",
                api_url.trim_end_matches('/')
            ))
            .bearer_auth(&auth_token)
            .multipart(reqwest::blocking::multipart::Form::new().part("file", part))
            .send() {
            Ok(response) => response,
            Err(error) => {
                let mut causes = Vec::new();
                let mut cause = std::error::Error::source(&error);
                while let Some(source) = cause {
                    causes.push(source.to_string());
                    cause = std::error::Error::source(source);
                }
                let detail = if causes.is_empty() {
                    error.to_string()
                } else {
                    format!("{}: {}", error, causes.join(": "))
                };
                let reason = format!(
                    "Falha de comunicação com o backend local ao enviar {name} ({api_url}): {detail}. Verifique se o backend continua ativo e acessível."
                );
                emit_chapter_upload_progress(&app, ChapterUploadProgress {
                    completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
                });
                return Err(reason);
            }
        };
        let status = response.status();
        let body: serde_json::Value = match response.json() {
            Ok(body) => body,
            Err(error) => {
                let reason = format!("O backend retornou uma resposta inválida ao enviar {name}: {error}");
                emit_chapter_upload_progress(&app, ChapterUploadProgress {
                    completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
                });
                return Err(reason);
            }
        };
        if !status.is_success() {
            let detail = body
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("Falha no upload de reserva do Telegram.");
            let reason = format!("Falha ao armazenar {name} no backend/Telegram (HTTP {status}): {detail}");
            emit_chapter_upload_progress(&app, ChapterUploadProgress {
                completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
            });
            return Err(reason);
        }
        let telegram_url = match body
            .get("url")
            .and_then(|value| value.as_str())
        {
            Some(url) => url.to_string(),
            None => {
                let reason = format!("O backend não retornou o link do Telegram para {name}.");
                emit_chapter_upload_progress(&app, ChapterUploadProgress {
                    completed, total, file_name: name, stage: "failed".into(), error: Some(reason.clone()),
                });
                return Err(reason);
            }
        };

        result.push(UploadedImage {
            name,
            cid,
            telegram_url,
        });
        let uploaded_name = result.last().map(|image| image.name.clone()).unwrap_or_default();
        emit_chapter_upload_progress(&app, ChapterUploadProgress {
            completed: result.len(), total, file_name: uploaded_name, stage: "completed".into(), error: None,
        });
    }

    Ok(result)
}

/* =========================
   FLUXO PRINCIPAL
========================= */
/* =========================
   FLUXO PRINCIPAL
========================= */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(IpfsProcess(Mutex::new(IpfsChildren::default())))
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. Criamos os itens do menu da bandeja
            let show_menu_item =
                tauri::menu::MenuItem::with_id(app, "show", "Abrir Takop", true, None::<&str>)
                    .unwrap();
            let quit_menu_item =
                tauri::menu::MenuItem::with_id(app, "quit", "Sair do Takop", true, None::<&str>)
                    .unwrap();

            // Colocamos "Abrir" primeiro e depois o "Sair" com uma linha separadora entre eles
            let menu = tauri::menu::Menu::with_items(
                app,
                &[
                    &show_menu_item,
                    &tauri::menu::PredefinedMenuItem::separator(app).unwrap(),
                    &quit_menu_item,
                ],
            )
            .unwrap();

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app_handle, event| {
                    match event.id.as_ref() {
                        "show" => {
                            // Garante a abertura via clique direito -> Abrir Takop
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            // Se clicou em "Sair", limpa o IPFS e fecha tudo
                            let app_state = app_handle.state::<IpfsProcess>();
                            let mut process_guard = app_state.0.lock().unwrap();
                            if let Some(mut child) = process_guard.reader.take() {
                                println!("🛑 Finalizando nó IPFS do leitor...");
                                let _ = child.kill();
                            }
                            if let Some(mut child) = process_guard.groups.take() {
                                println!("🛑 Finalizando daemon do IPFS definitivamente...");
                                let _ = child.kill();
                            }
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Simplificamos o tratamento do evento: qualquer tipo de clique físico direto no ícone (Single ou Double) vai tentar restaurar a janela
                    match event {
                        tauri::tray::TrayIconEvent::Click { .. } => {
                            let app_handle = tray.app_handle();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)
                .unwrap();

            // Inicia o IPFS em outra thread normalmente
            thread::spawn(move || {
                match start_ipfs_daemon() {
                    Ok(Some(child)) => { let app_state = handle.state::<IpfsProcess>(); let mut process_guard = app_state.0.lock().unwrap(); process_guard.groups = Some(child); }
                    Ok(None) => {}
                    Err(e) => eprintln!("❌ Falha crítica ao configurar/iniciar IPFS: {}", e),
                }
                if storage_preferences().reader_collaboration_enabled {
                    match start_reader_ipfs_daemon() {
                        Ok(Some(child)) => { let app_state = handle.state::<IpfsProcess>(); let mut process_guard = app_state.0.lock().unwrap(); process_guard.reader = Some(child); }
                        Ok(None) => {}
                        Err(error) => eprintln!("❌ Falha ao iniciar o nó IPFS separado do leitor: {error}"),
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            upload_folder_to_ipfs,
            inspect_manga_folder,
            get_ipfs_storage_status,
            set_ipfs_storage_limit,
            get_reader_collaboration_enabled,
            set_reader_collaboration_enabled,
            get_reader_storage_status,
            set_reader_storage_limit,
            is_reader_ipfs_running,
            pin_reader_content,
            restart_storage_nodes
        ])
        .build(tauri::generate_context!())
        .expect("Erro ao buildar aplicação tauri")
        .run(|app_handle, event| match event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                    println!("🥷 Janela ocultada. Nó IPFS continua ativo em background.");
                }
            }
            _ => {}
        });
}

// use serde::Serialize;
// use std::{
//     fs,
//     process::{Command, Stdio},
//     thread,
//     time::Duration,
// };

// #[derive(Serialize)]
// struct UploadedImage {
//     name: String,
//     cid: String,
// }

// /* =========================
//    IPFS CORE HELPERS
// ========================= */
// fn run_ipfs(args: &[&str]) -> Result<String, String> {
//     let output = Command::new("ipfs")
//         .args(args)
//         .output()
//         .map_err(|e| format!("erro executando ipfs: {e}"))?;

//     if !output.status.success() {
//         return Err(String::from_utf8_lossy(&output.stderr).to_string());
//     }

//     Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
// }

// /* =========================
//    DAEMON CONTROL
// ========================= */
// fn ensure_ipfs_daemon() -> Result<(), String> {
//     // tenta detectar se API está viva
//     let check = Command::new("ipfs").args(["id"]).output();

//     if check.is_ok() && check.unwrap().status.success() {
//         println!("🟢 IPFS daemon já está rodando");
//         return Ok(());
//     }

//     println!("🚀 iniciando IPFS daemon...");

//     Command::new("ipfs")
//         .arg("daemon")
//         .stdout(Stdio::null())
//         .stderr(Stdio::null())
//         .spawn()
//         .map_err(|e| format!("erro ao iniciar daemon: {e}"))?;

//     // espera daemon subir (simples e robusto)
//     for _ in 0..10 {
//         thread::sleep(Duration::from_millis(800));

//         let test = Command::new("ipfs").args(["id"]).output();

//         if let Ok(out) = test {
//             if out.status.success() {
//                 println!("🟢 IPFS daemon pronto");
//                 return Ok(());
//             }
//         }
//     }

//     Err("IPFS daemon não iniciou corretamente".into())
// }

// /* =========================
//    UPLOAD
// ========================= */
// #[tauri::command]
// fn upload_folder_to_ipfs(folder: String) -> Result<Vec<UploadedImage>, String> {
//     ensure_ipfs_daemon()?;

//     let mut result = Vec::new();

//     let entries = fs::read_dir(&folder).map_err(|e| format!("erro lendo pasta: {e}"))?;

//     for entry in entries {
//         let path = entry.map_err(|e| e.to_string())?.path();

//         if !path.is_file() {
//             continue;
//         }

//         let ext = path
//             .extension()
//             .unwrap_or_default()
//             .to_string_lossy()
//             .to_lowercase();

//         if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
//             continue;
//         }

//         let path_str = path.to_str().ok_or("caminho inválido (UTF-8)")?;

//         println!("📤 enviando: {}", path.display());

//         // 1. upload + pin embutido
//         let cid = run_ipfs(&[
//             "add",
//             "-Q",
//             "--raw-leaves",
//             "--cid-version=1",
//             "--pin=true",
//             path_str,
//         ])?;

//         println!("✅ CID: {}", cid);

//         // 2. garante pin explícito (segurança extra)
//         run_ipfs(&["pin", "add", &cid])?;

//         result.push(UploadedImage {
//             name: path.file_name().unwrap().to_string_lossy().to_string(),
//             cid,
//         });
//     }

//     Ok(result)
// }

// /* =========================
//    TAURI ENTRY
// ========================= */
// #[cfg_attr(mobile, tauri::mobile_entry_point)]
// pub fn run() {
//     tauri::Builder::default()
//         .invoke_handler(tauri::generate_handler![upload_folder_to_ipfs])
//         .run(tauri::generate_context!())
//         .expect("erro iniciando aplicação");
// }
