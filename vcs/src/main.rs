use std::collections::BTreeSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use walkdir::WalkDir;

use itehaas_lib::config;
use itehaas_lib::hash::{Hash, HashAlgo};
use itehaas_lib::index::{file_mode, path_to_string, Index, IndexEntry};
use itehaas_lib::object::{Blob, Object};

#[derive(Parser)]
#[command(name = "itehaas", version, about = "Itehaas VCS", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new repository
    Init {
        /// Path to initialize (default: current directory)
        #[arg(default_value = ".")]
        path: PathBuf,
        /// Hash algorithm (sha256 only Phase 1)
        #[arg(long, default_value = "sha256")]
        algo: String,
        /// Force re-init if exists
        #[arg(long)]
        force: bool,
    },
    /// Compute object hash, optionally write
    #[command(name = "hash-object")]
    HashObject {
        /// Object type
        #[arg(short = 't', long, default_value = "blob")]
        type_: String,
        /// Write object to store
        #[arg(short = 'w', long)]
        write: bool,
        /// Read from stdin
        #[arg(long)]
        stdin: bool,
        /// File to hash (if not --stdin)
        file: Option<PathBuf>,
    },
    /// Print object
    #[command(name = "cat-file")]
    CatFile {
        /// Pretty print
        #[arg(short = 'p', group = "mode")]
        pretty: bool,
        /// Show type
        #[arg(short = 't', group = "mode")]
        show_type: bool,
        /// Show size
        #[arg(short = 's', group = "mode")]
        show_size: bool,
        /// Hash
        hash: String,
    },
    /// Verify object integrity
    Verify {
        /// Hash to verify
        hash: String,
    },
    /// Add file(s) to index
    Add {
        /// Files or directories to add (use . for all)
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Commit staged changes
    Commit {
        /// Commit message
        #[arg(short = 'm', long)]
        message: String,
        /// Author name (overrides config)
        #[arg(long)]
        author: Option<String>,
        /// Author email (overrides config)
        #[arg(long)]
        email: Option<String>,
    },
    /// Show working tree status
    Status,
    /// Show commit history
    Log {
        /// Show oneline (hash + message)
        #[arg(long)]
        oneline: bool,
        /// Max count
        #[arg(long)]
        max_count: Option<usize>,
    },
    /// Get or set config
    Config {
        /// Key (e.g., user.name, user.email)
        key: Option<String>,
        /// Value (if setting)
        value: Option<String>,
    },
}

fn find_repo_or_cwd() -> Result<PathBuf> {
    let cwd = std::env::current_dir()?;
    if let Some(repo) = itehaas_lib::find_repo(&cwd) {
        Ok(repo)
    } else {
        if cwd.join(".itehaas").exists() {
            Ok(cwd)
        } else {
            anyhow::bail!("not a repository (or any parent): .itehaas not found")
        }
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Init { path, algo, force } => {
            let a = HashAlgo::from_str(&algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let repo_path = if path == Path::new(".") {
                std::env::current_dir()?
            } else {
                path.clone()
            };
            let repo = if force {
                itehaas_lib::init_force(&repo_path, a).map_err(|e| anyhow::anyhow!(e.to_string()))?
            } else {
                itehaas_lib::init(&repo_path, a).map_err(|e| anyhow::anyhow!(e.to_string()))?
            };
            println!("Initialized empty Itehaas repository in {}", repo.join(".itehaas").display());
        }
        Commands::HashObject {
            type_,
            write,
            stdin,
            file,
        } => {
            if type_ != "blob" {
                anyhow::bail!("only blob supported in Phase 1 (got: {})", type_);
            }
            let data = if stdin {
                let mut buf = Vec::new();
                io::stdin().read_to_end(&mut buf)?;
                buf
            } else if let Some(f) = file {
                fs::read(&f).with_context(|| format!("reading {}", f.display()))?
            } else {
                anyhow::bail!("hash-object: need file or --stdin");
            };
            let blob = Blob::new(data);
            let obj = Object::Blob(blob);
            if write {
                let repo = find_repo_or_cwd()?;
                let algo = config::read_hasher(&repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
                let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
                let hash = itehaas_lib::object::store::write_object(&repo, &obj, hasher.as_ref())
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                println!("{}", hash.hex());
            } else {
                let hasher = itehaas_lib::hash::Sha256Hasher;
                let hash = obj.hash(&hasher);
                println!("{}", hash.hex());
            }
        }
        Commands::CatFile {
            pretty,
            show_type,
            show_size,
            hash: hash_hex,
        } => {
            let repo = find_repo_or_cwd()?;
            let algo = config::read_hasher(&repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let hash = Hash::from_hex(algo, &hash_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let obj = itehaas_lib::object::store::read_object(&repo, &hash, hasher.as_ref())
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            if show_type {
                println!("{}", obj.object_type());
            } else if show_size {
                println!("{}", obj.canonical_body().len());
            } else if pretty {
                match obj {
                    Object::Blob(b) => {
                        io::stdout().write_all(&b.content)?;
                    }
                    Object::Tree(t) => {
                        for e in t.entries {
                            println!("{:06o} {} {}", e.mode, e.hash.hex(), e.name);
                        }
                    }
                    Object::Commit(c) => {
                        print!("{}", String::from_utf8_lossy(&c.canonical_body()));
                    }
                    Object::Tag(t) => {
                        print!("{}", String::from_utf8_lossy(&t.canonical_body()));
                    }
                }
            } else {
                anyhow::bail!("cat-file: need -p, -t, or -s");
            }
        }
        Commands::Verify { hash: hash_hex } => {
            let repo = find_repo_or_cwd()?;
            let algo = config::read_hasher(&repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let hash = Hash::from_hex(algo, &hash_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            itehaas_lib::object::store::verify_object(&repo, &hash, hasher.as_ref())
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("ok: {}", hash_hex);
        }
        Commands::Add { paths } => {
            let repo = find_repo_or_cwd()?;
            cmd_add(&repo, paths)?;
        }
        Commands::Commit {
            message,
            author,
            email,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_commit(&repo, message, author, email)?;
        }
        Commands::Status => {
            let repo = find_repo_or_cwd()?;
            cmd_status(&repo)?;
        }
        Commands::Log { oneline, max_count } => {
            let repo = find_repo_or_cwd()?;
            cmd_log(&repo, oneline, max_count)?;
        }
        Commands::Config { key, value } => {
            let repo = find_repo_or_cwd()?;
            cmd_config(&repo, key, value)?;
        }
    }
    Ok(())
}

fn cmd_add(repo: &Path, paths: Vec<PathBuf>) -> Result<()> {
    let algo = config::read_hasher(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let mut index = Index::load(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let cwd = std::env::current_dir()?;

    // Handle "." separately to avoid double-scanning
    let has_dot = paths.iter().any(|p| p.as_os_str() == "." || p.as_os_str() == "./");
    let non_dot_paths: Vec<&PathBuf> = paths.iter().filter(|p| !(p.as_os_str() == "." || p.as_os_str() == "./")).collect();

    if has_dot {
        // Add all files recursively from repo root, also handle deletions
        let mut all_files: Vec<PathBuf> = Vec::new();
        for entry in WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
            let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
            !itehaas_lib::index::should_ignore(rel)
        }) {
            let entry = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let path = entry.path();
            if path.is_file() {
                all_files.push(path.to_path_buf());
            }
        }
        let existing_set: BTreeSet<String> = all_files
            .iter()
            .map(|abs| {
                let rel = abs.strip_prefix(repo).unwrap();
                path_to_string(rel)
            })
            .collect();

        for abs in all_files {
            let rel = abs.strip_prefix(repo).unwrap();
            let rel_str = path_to_string(rel);
            add_single_file(repo, &abs, &rel_str, &mut index, hasher.as_ref())?;
        }

        let to_remove: Vec<String> = index
            .entries_sorted()
            .into_iter()
            .map(|e| e.path.clone())
            .filter(|p| !existing_set.contains(p))
            .collect();
        for r in to_remove {
            index.remove(&r);
            println!("removed '{}' from index (deleted)", r);
        }
    }

    for p in non_dot_paths {
        let abs_path = if p.is_absolute() {
            p.clone()
        } else {
            cwd.join(p)
        };

        // Compute repo-relative string via strip_prefix (works even if file missing)
        let rel_str = abs_path
            .strip_prefix(repo)
            .map(|r| path_to_string(r))
            .map_err(|_| anyhow::anyhow!("path '{}' is outside repository", p.display()))?;

        if rel_str.is_empty() {
            anyhow::bail!("path '{}' is empty after relativizing", p.display());
        }

        // If canonical exists and is symlink-resolved outside, double-check
        if abs_path.exists() {
            if let Ok(canonical) = abs_path.canonicalize() {
                if canonical.strip_prefix(repo).is_err() && canonical != abs_path {
                    anyhow::bail!("path '{}' is outside repository (symlink)", p.display());
                }
            }
        }

        if abs_path.exists() {
            let metadata = fs::metadata(&abs_path)
                .with_context(|| format!("stat {}", abs_path.display()))?;
            if metadata.is_dir() {
                for entry in WalkDir::new(&abs_path).min_depth(1).into_iter().filter_entry(|e| {
                    let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
                    !itehaas_lib::index::should_ignore(rel)
                }) {
                    let entry = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
                    let path = entry.path();
                    if path.is_file() {
                        let rel = path.strip_prefix(repo).unwrap();
                        let rel_str2 = path_to_string(rel);
                        add_single_file(repo, path, &rel_str2, &mut index, hasher.as_ref())?;
                    }
                }
            } else if metadata.is_file() {
                add_single_file(repo, &abs_path, &rel_str, &mut index, hasher.as_ref())?;
            } else {
                anyhow::bail!("not a regular file: {}", abs_path.display());
            }
        } else {
            // File does not exist — check if in index (stage deletion)
            if index.contains(&rel_str) {
                index.remove(&rel_str);
                println!("removed '{}'", rel_str);
            } else {
                anyhow::bail!("pathspec '{}' did not match any files", p.display());
            }
        }
    }

    index.save(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    Ok(())
}

fn add_single_file(
    repo: &Path,
    abs: &Path,
    rel_str: &str,
    index: &mut Index,
    hasher: &dyn itehaas_lib::hash::Hasher,
) -> Result<()> {
    let data = fs::read(abs).with_context(|| format!("reading {}", abs.display()))?;
    let blob = Blob::new(data);
    let obj = Object::Blob(blob);
    let hash = itehaas_lib::object::store::write_object(repo, &obj, hasher)
        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let mode = file_mode(&fs::metadata(abs)?);
    let entry = IndexEntry::new(rel_str.to_string(), hash, mode);
    index.add_or_update(entry);
    Ok(())
}

fn cmd_commit(
    repo: &Path,
    message: String,
    author_opt: Option<String>,
    email_opt: Option<String>,
) -> Result<()> {
    if message.trim().is_empty() {
        anyhow::bail!("commit message cannot be empty");
    }
    let algo = config::read_hasher(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let index = Index::load(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    // Allow empty index if HEAD exists (deleting all files), but not for initial commit
    let parent_opt = itehaas_lib::refs::resolve_head(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    if index.is_empty() && parent_opt.is_none() {
        anyhow::bail!("nothing to commit (index empty, use 'itehaas add' to stage files)");
    }

    // Build tree from index
    let entries = index.entries_sorted();
    let tree_hash = itehaas_lib::tree_builder::build_tree_from_index(repo, &entries, hasher.as_ref())
        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;

    // Check if same as HEAD (nothing staged to commit)
    if let Some(head_hash) = &parent_opt {
        if let Ok(obj) = itehaas_lib::object::store::read_object(repo, head_hash, hasher.as_ref()) {
            if let Object::Commit(c) = obj {
                if c.tree.hex() == tree_hash.hex() {
                    let st = itehaas_lib::status::status(repo)
                        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                    if st.staged.is_empty() {
                        anyhow::bail!("nothing to commit, working tree clean (no staged changes)");
                    }
                }
            }
        }
    }

    // Get parent(s) — reuse parent_opt from earlier
    let parents = if let Some(p) = parent_opt { vec![p] } else { vec![] };

    // Get author/committer
    let (cfg_name, cfg_email) = config::read_user(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let name = author_opt.or(cfg_name).unwrap_or_else(|| "Author".to_string());
    let email = email_opt.or(cfg_email).unwrap_or_else(|| "author@example.com".to_string());

    // Validate name/email
    if name.contains('<') || name.contains('>') || name.contains('\n') || name.is_empty() {
        anyhow::bail!("invalid author name: {:?}", name);
    }
    if email.contains('<') || email.contains('>') || email.contains('\n') || email.is_empty() {
        anyhow::bail!("invalid author email: {:?}", email);
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let tz = "+0000".to_string(); // UTC Phase 2

    let author_sig = itehaas_lib::object::Signature::new(name.clone(), email.clone(), timestamp, tz.clone())
        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let committer_sig = itehaas_lib::object::Signature::new(name, email, timestamp, tz)
        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;

    let commit = itehaas_lib::object::Commit::new(tree_hash.clone(), parents.clone(), author_sig, committer_sig, message.clone());
    let commit_obj = Object::Commit(commit);
    let commit_hash = itehaas_lib::object::store::write_object(repo, &commit_obj, hasher.as_ref())
        .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;

    // Update ref
    let head = itehaas_lib::refs::read_head(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    match head {
        itehaas_lib::refs::Head::Ref(r) | itehaas_lib::refs::Head::Unborn(r) => {
            itehaas_lib::refs::write_ref(repo, &r, &commit_hash)
                .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
            let branch = r.strip_prefix("refs/heads/").unwrap_or(&r);
            println!("[{} {}] {}", branch, &commit_hash.hex()[..7], message.lines().next().unwrap_or(""));
        }
        itehaas_lib::refs::Head::Detached(_) => {
            itehaas_lib::refs::write_head_detached(repo, &commit_hash)
                .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
            println!("[detached {}] {}", &commit_hash.hex()[..7], message.lines().next().unwrap_or(""));
        }
    }

    println!(" {} files staged, tree {}", index.len(), tree_hash.hex()[..7].to_string());
    Ok(())
}

fn cmd_status(repo: &Path) -> Result<()> {
    let st = itehaas_lib::status::status(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    if let Some(branch) = &st.branch {
        println!("On branch {}", branch);
    } else {
        println!("HEAD detached");
    }
    if st.head_hash.is_none() {
        println!("No commits yet");
    }
    if st.staged.is_empty() && st.not_staged.is_empty() && st.untracked.is_empty() {
        println!("nothing to commit, working tree clean");
        return Ok(());
    }
    if !st.staged.is_empty() {
        println!("\nChanges to be committed:");
        println!("  (use \"itehaas restore --staged <file>...\" to unstage)");
        for e in &st.staged {
            println!("        {}:   {}", e.status, e.path);
        }
    }
    if !st.not_staged.is_empty() {
        println!("\nChanges not staged for commit:");
        println!("  (use \"itehaas add <file>...\" to update what will be committed)");
        for e in &st.not_staged {
            println!("        {}:   {}", e.status, e.path);
        }
    }
    if !st.untracked.is_empty() {
        println!("\nUntracked files:");
        println!("  (use \"itehaas add <file>...\" to include in what will be committed)");
        for p in &st.untracked {
            println!("        {}", p);
        }
    }
    Ok(())
}

fn cmd_log(repo: &Path, oneline: bool, max_count: Option<usize>) -> Result<()> {
    let algo = config::read_hasher(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let head = itehaas_lib::refs::resolve_head(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    let Some(mut cur) = head else {
        anyhow::bail!("no commits yet");
    };
    let mut count = 0;
    loop {
        if let Some(max) = max_count {
            if count >= max {
                break;
            }
        }
        let obj = itehaas_lib::object::store::read_object(repo, &cur, hasher.as_ref())
            .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
        let commit = match obj {
            Object::Commit(c) => c,
            _ => anyhow::bail!("object {} is not a commit", cur.hex()),
        };
        if oneline {
            println!("{} {}", &cur.hex()[..7], commit.message.lines().next().unwrap_or(""));
        } else {
            println!("commit {}", cur.hex());
            println!("Author: {} <{}>", commit.author.name, commit.author.email);
            println!("Date:   {} {}", commit.author.timestamp, commit.author.tz_offset);
            println!();
            for line in commit.message.lines() {
                println!("    {}", line);
            }
            println!();
        }
        count += 1;
        if commit.parents.is_empty() {
            break;
        }
        // Follow first parent (simple log, not full DAG)
        cur = commit.parents[0].clone();
    }
    Ok(())
}

fn cmd_config(repo: &Path, key: Option<String>, value: Option<String>) -> Result<()> {
    match (key, value) {
        (None, _) => {
            // Show all config
            let cfg_path = repo.join(".itehaas").join("config");
            if cfg_path.exists() {
                let content = fs::read_to_string(&cfg_path)?;
                print!("{}", content);
            } else {
                println!("no config");
            }
        }
        (Some(k), None) => {
            // Get
            if k == "user.name" {
                let (name, _) = config::read_user(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                if let Some(n) = name {
                    println!("{}", n);
                } else {
                    anyhow::bail!("user.name not set");
                }
            } else if k == "user.email" {
                let (_, email) = config::read_user(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                if let Some(e) = email {
                    println!("{}", e);
                } else {
                    anyhow::bail!("user.email not set");
                }
            } else {
                anyhow::bail!("unknown config key: {} (supported: user.name, user.email)", k);
            }
        }
        (Some(k), Some(v)) => {
            // Set
            if k == "user.name" {
                let (_, email) = config::read_user(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                let email = email.unwrap_or_else(|| "author@example.com".to_string());
                config::write_user(repo, &v, &email).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                println!("set user.name = {}", v);
            } else if k == "user.email" {
                let (name, _) = config::read_user(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                let name = name.unwrap_or_else(|| "Author".to_string());
                config::write_user(repo, &name, &v).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
                println!("set user.email = {}", v);
            } else {
                anyhow::bail!("unknown config key: {} (supported: user.name, user.email)", k);
            }
        }
    }
    Ok(())
}
