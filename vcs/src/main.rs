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
    /// List, create, or delete branches
    Branch {
        /// Branch name to create (omit to list)
        name: Option<String>,
        /// Start point for new branch (default HEAD)
        start_point: Option<String>,
        /// Delete branch (use -d)
        #[arg(short = 'd', long, group = "branch_action")]
        delete: bool,
        /// Force delete (use -D)
        #[arg(short = 'D', long, group = "branch_action")]
        force_delete: bool,
    },
    /// Switch branches or restore working tree
    Checkout {
        /// Branch or commit to checkout
        target: Option<String>,
        /// Create new branch before checkout (-b)
        #[arg(short = 'b')]
        create_branch: Option<String>,
        /// Force checkout (ignore dirty working tree)
        #[arg(short = 'f', long)]
        force: bool,
    },
    /// Switch branches (alias for checkout)
    Switch {
        /// Branch to switch to
        branch: Option<String>,
        /// Create new branch (-c)
        #[arg(short = 'c')]
        create_branch: Option<String>,
        /// Force switch
        #[arg(short = 'f', long)]
        force: bool,
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
        Commands::Branch {
            name,
            start_point,
            delete,
            force_delete,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_branch(&repo, name, start_point, delete, force_delete)?;
        }
        Commands::Checkout {
            target,
            create_branch,
            force,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_checkout(&repo, target, create_branch, force)?;
        }
        Commands::Switch {
            branch,
            create_branch,
            force,
        } => {
            let repo = find_repo_or_cwd()?;
            // switch maps to checkout: if create_branch Some, then target is branch's start_point
            if let Some(new_branch) = create_branch {
                cmd_checkout(&repo, branch, Some(new_branch), force)?;
            } else {
                cmd_checkout(&repo, branch, None, force)?;
            }
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

fn cmd_branch(
    repo: &Path,
    name: Option<String>,
    start_point: Option<String>,
    delete: bool,
    force_delete: bool,
) -> Result<()> {
    if delete || force_delete {
        let n = name.ok_or_else(|| anyhow::anyhow!("branch name required for deletion"))?;
        if start_point.is_some() {
            anyhow::bail!("cannot use start point with -d/-D");
        }
        itehaas_lib::refs::delete_branch(repo, &n).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!("Deleted branch {}", n);
        return Ok(());
    }
    if let Some(n) = name {
        // Create new branch
        itehaas_lib::refs::validate_branch_name(&n).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Check exists
        let ref_name = format!("refs/heads/{}", n);
        if itehaas_lib::refs::read_ref(repo, &ref_name)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .is_some()
        {
            anyhow::bail!("branch '{}' already exists", n);
        }
        // Resolve start point
        let start = start_point.unwrap_or_else(|| "HEAD".to_string());
        let hash = itehaas_lib::refs::resolve_rev(repo, &start)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("failed to resolve start point '{}'", start))?;
        // Ensure start point is a commit
        let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let obj = itehaas_lib::object::store::read_object(repo, &hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if !matches!(obj, Object::Commit(_)) {
            anyhow::bail!("start point '{}' is not a commit", start);
        }
        itehaas_lib::refs::create_branch(repo, &n, &hash).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!("Created branch '{}' at {}", n, &hash.hex()[..7]);
    } else {
        // List
        let branches = itehaas_lib::refs::list_branches(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let current = itehaas_lib::refs::current_branch(repo)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .unwrap_or_default();
        let head = itehaas_lib::refs::read_head(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let is_detached = matches!(head, itehaas_lib::refs::Head::Detached(_));
        if branches.is_empty() {
            println!("No branches");
            if is_detached {
                println!("HEAD detached");
            }
            return Ok(());
        }
        for b in branches {
            if b == current && !is_detached {
                println!("* {}", b);
            } else {
                println!("  {}", b);
            }
        }
        if is_detached {
            if let itehaas_lib::refs::Head::Detached(h) = head {
                println!("(HEAD detached at {})", &h.hex()[..7]);
            }
        }
    }
    Ok(())
}

fn cmd_checkout(
    repo: &Path,
    target: Option<String>,
    create_branch: Option<String>,
    force: bool,
) -> Result<()> {
    // checkout -b <new> [start_point]
    if let Some(new_branch) = create_branch {
        // Validate new branch name
        itehaas_lib::refs::validate_branch_name(&new_branch).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let ref_name = format!("refs/heads/{}", new_branch);
        if itehaas_lib::refs::read_ref(repo, &ref_name)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .is_some()
        {
            anyhow::bail!("branch '{}' already exists", new_branch);
        }
        // Resolve start point
        let start = target.unwrap_or_else(|| "HEAD".to_string());
        let hash = itehaas_lib::refs::resolve_rev(repo, &start)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("failed to resolve start point '{}'", start))?;
        // Check is commit
        let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let obj = itehaas_lib::object::store::read_object(repo, &hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if !matches!(obj, Object::Commit(_)) {
            anyhow::bail!("start point '{}' is not a commit", start);
        }
        itehaas_lib::refs::create_branch(repo, &new_branch, &hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Now checkout that branch
        if force {
            // For force, bypass clean check via direct checkout with force flag
            // Temporarily implement by calling checkout with force logic
            // We'll use internal checkout that respects force
            checkout_with_force(repo, &hash, false, Some(&new_branch), force)?;
        } else {
            itehaas_lib::checkout::checkout_branch(repo, &new_branch)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
        println!("Switched to a new branch '{}'", new_branch);
        return Ok(());
    }

    // No create_branch — target is required
    let tgt = target.ok_or_else(|| anyhow::anyhow!("target branch or commit required"))?;

    // First, check if target is a branch
    let branch_hash = itehaas_lib::refs::read_ref(repo, &format!("refs/heads/{}", tgt))
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if let Some(hash) = branch_hash {
        // Checkout branch
        if force {
            checkout_with_force(repo, &hash, false, Some(&tgt), true)?;
        } else {
            itehaas_lib::checkout::checkout_branch(repo, &tgt)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
        println!("Switched to branch '{}'", tgt);
        return Ok(());
    }

    // Try as hash or HEAD
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Try HEAD
    if tgt == "HEAD" {
        let h = itehaas_lib::refs::resolve_head(repo)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("HEAD is unborn, no commit"))?;
        if force {
            checkout_with_force(repo, &h, true, None, true)?;
        } else {
            itehaas_lib::checkout::checkout_detached(repo, &h)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
        println!("Note: switching to '{}'.", tgt);
        println!("You are in 'detached HEAD' state.");
        return Ok(());
    }

    // Try as hash
    if tgt.len() == algo.hex_len() {
        if let Ok(hash) = Hash::from_hex(algo, &tgt) {
            let path = itehaas_lib::object::store::object_path(repo, &hash);
            if path.exists() {
                let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
                let obj = itehaas_lib::object::store::read_object(repo, &hash, hasher.as_ref())
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                if matches!(obj, Object::Commit(_)) {
                    if force {
                        checkout_with_force(repo, &hash, true, None, true)?;
                    } else {
                        itehaas_lib::checkout::checkout_detached(repo, &hash)
                            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                    }
                    println!("Note: switching to '{}'.", &tgt[..7]);
                    println!("You are in 'detached HEAD' state.");
                    return Ok(());
                } else {
                    anyhow::bail!("object '{}' is not a commit", tgt);
                }
            }
        }
    }

    // Try resolve_rev as last fallback (covers branch via resolve_rev)
    if let Some(hash) = itehaas_lib::refs::resolve_rev(repo, &tgt)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    {
        // Check if it's a commit
        let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let obj = itehaas_lib::object::store::read_object(repo, &hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if matches!(obj, Object::Commit(_)) {
            // If target was a branch name, we would have caught earlier; this is hash path
            if force {
                checkout_with_force(repo, &hash, true, None, true)?;
            } else {
                itehaas_lib::checkout::checkout_detached(repo, &hash)
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            }
            println!("Note: switching to '{}'.", &tgt[..7.min(tgt.len())]);
            println!("You are in 'detached HEAD' state.");
            return Ok(());
        }
    }

    anyhow::bail!("target '{}' not found (branch or commit)", tgt);
}

fn checkout_with_force(
    repo: &Path,
    hash: &Hash,
    detached: bool,
    branch: Option<&str>,
    _force: bool,
) -> Result<()> {
    // For now, force just bypasses the clean check by directly calling low-level checkout
    // We need a force version that doesn't check status
    // Temporarily implement here by duplicating checkout logic without status check
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let target_commit_obj = itehaas_lib::object::store::read_object(repo, hash, hasher.as_ref())
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let target_tree_hash = match target_commit_obj {
        Object::Commit(c) => c.tree,
        _ => anyhow::bail!("target is not a commit"),
    };
    let target_map =
        itehaas_lib::tree_builder::flatten_tree_root(repo, &target_tree_hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Get current map for deletion (if HEAD exists)
    let current_head = itehaas_lib::refs::resolve_head(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let current_map = if let Some(head_hash) = current_head {
        let obj = itehaas_lib::object::store::read_object(repo, &head_hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let cur_tree = match obj {
            Object::Commit(c) => c.tree,
            _ => anyhow::bail!("HEAD is not a commit"),
        };
        itehaas_lib::tree_builder::flatten_tree_root(repo, &cur_tree, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
    } else {
        std::collections::BTreeMap::new()
    };
    // Delete files not in target
    for (path, _) in &current_map {
        if !target_map.contains_key(path) {
            let abs = repo.join(path);
            if abs.exists() {
                std::fs::remove_file(&abs)?;
                if let Some(parent) = abs.parent() {
                    let mut cur = parent.to_path_buf();
                    while cur != *repo && cur.starts_with(repo) {
                        match std::fs::remove_dir(&cur) {
                            Ok(_) => {
                                if let Some(p) = cur.parent() {
                                    cur = p.to_path_buf();
                                } else {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }
    }
    for (path, (hash, mode)) in &target_map {
        let abs = repo.join(path);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let obj = itehaas_lib::object::store::read_object(repo, hash, hasher.as_ref())
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let content = match obj {
            Object::Blob(b) => b.content,
            _ => anyhow::bail!("tree entry {} is not blob", path),
        };
        std::fs::write(&abs, &content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = if *mode == 0o100755 { 0o755 } else { 0o644 };
            let _ = std::fs::set_permissions(&abs, std::fs::Permissions::from_mode(perm));
        }
    }
    // Update index
    let mut index = itehaas_lib::index::Index::new();
    for (path, (hash, mode)) in target_map {
        let entry = itehaas_lib::index::IndexEntry::new(path, hash, mode);
        index.add_or_update(entry);
    }
    index.save(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if detached {
        itehaas_lib::refs::write_head_detached(repo, hash).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    } else if let Some(branch) = branch {
        let ref_name = format!("refs/heads/{}", branch);
        itehaas_lib::refs::write_head_ref(repo, &ref_name).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    Ok(())
}
