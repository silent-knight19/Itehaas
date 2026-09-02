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
        /// Start point for new branch (default HEAD) or new name for -m
        start_point: Option<String>,
        /// Delete branch (use -d)
        #[arg(short = 'd', long, group = "branch_action")]
        delete: bool,
        /// Force delete (use -D)
        #[arg(short = 'D', long, group = "branch_action")]
        force_delete: bool,
        /// List all branches (local + remote)
        #[arg(short = 'a', long)]
        all: bool,
        /// List remote branches only
        #[arg(short = 'r', long)]
        remotes: bool,
        /// Move/rename branch (-m)
        #[arg(short = 'm', long)]
        move_branch: bool,
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
    /// Show changes between commits, index, and working tree
    Diff {
        /// Show staged changes (index vs HEAD)
        #[arg(long, group = "diff_mode")]
        staged: bool,
        /// Alias for --staged
        #[arg(long, group = "diff_mode")]
        cached: bool,
        /// Target branch/commit to diff against HEAD
        target: Option<String>,
    },
    /// Merge a branch into current branch
    Merge {
        /// Branch to merge into current
        branch: String,
        /// Merge message (default auto)
        #[arg(short = 'm', long)]
        message: Option<String>,
    },
    /// Manage remotes
    Remote {
        #[command(subcommand)]
        command: Option<RemoteCommands>,
        /// Verbose (show URLs)
        #[arg(short = 'v', long)]
        verbose: bool,
    },
    /// Clone a repository
    Clone {
        /// Remote URL (filesystem path for Phase 5)
        url: String,
        /// Destination path
        path: Option<PathBuf>,
    },
    /// Fetch from remote
    Fetch {
        /// Remote name (default origin)
        remote: Option<String>,
    },
    /// Push to remote
    Push {
        /// Remote name (default origin)
        remote: Option<String>,
        /// Branch to push (default current branch)
        branch: Option<String>,
        /// Force push (allow non-fast-forward)
        #[arg(long)]
        force: bool,
    },
    /// Pull from remote (fetch + merge)
    Pull {
        /// Remote name (default origin)
        remote: Option<String>,
        /// Branch to pull (default current branch)
        branch: Option<String>,
    },
    /// Verify object integrity (fsck)
    Fsck,
    /// Garbage collect unreachable objects
    Gc {
        /// Prune unreachable objects (delete)
        #[arg(long)]
        prune: bool,
    },
    /// Create packfile from loose objects
    Pack,
    /// Count loose objects
    #[command(name = "count-objects")]
    CountObjects,
    /// Reset current HEAD to specified state
    Reset {
        /// Commit to reset to (default HEAD)
        commit: Option<String>,
        /// Soft: move HEAD only
        #[arg(long, group = "reset_mode")]
        soft: bool,
        /// Mixed: move HEAD + reset index (default)
        #[arg(long, group = "reset_mode")]
        mixed: bool,
        /// Hard: move HEAD + index + working tree
        #[arg(long, group = "reset_mode")]
        hard: bool,
        /// Paths to reset (file-level unstaging)
        #[arg(last = true)]
        paths: Vec<PathBuf>,
    },
    /// Restore working tree / index files
    Restore {
        /// Restore index (staged)
        #[arg(long)]
        staged: bool,
        /// Restore both staged and worktree (when neither --staged nor --worktree, worktree default)
        #[arg(long)]
        worktree: bool,
        /// Source commit (default HEAD for --staged, index for worktree)
        #[arg(long)]
        source: Option<String>,
        /// Paths to restore
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Remove files from index and working tree
    Rm {
        /// Files to remove
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Only remove from index (keep working tree)
        #[arg(long)]
        cached: bool,
        /// Force removal even with staged changes
        #[arg(short = 'f', long)]
        force: bool,
    },
    /// Move/rename file
    Mv {
        /// Source path
        source: PathBuf,
        /// Destination path
        dest: PathBuf,
        /// Force overwrite
        #[arg(short = 'f', long)]
        force: bool,
    },
    /// Remove untracked files
    Clean {
        /// Dry run (show what would be deleted)
        #[arg(short = 'n', long)]
        dry_run: bool,
        /// Force deletion (required unless -n)
        #[arg(short = 'f', long)]
        force: bool,
        /// Also remove directories
        #[arg(short = 'd', long)]
        dirs: bool,
    },
    /// Stash changes
    Stash {
        #[command(subcommand)]
        command: Option<StashCommands>,
        /// Message for push (when no subcommand)
        #[arg(short = 'm', long)]
        message: Option<String>,
        /// Include untracked files
        #[arg(short = 'u', long)]
        include_untracked: bool,
    },
    /// Create/list/delete tags
    Tag {
        /// Tag name (omit with -l to list)
        name: Option<String>,
        /// Annotated tag
        #[arg(short = 'a', long)]
        annotated: bool,
        /// Delete tag
        #[arg(short = 'd', long)]
        delete: bool,
        /// List tags
        #[arg(short = 'l', long)]
        list: bool,
        /// Tag message (for -a)
        #[arg(short = 'm', long)]
        message: Option<String>,
    },
    /// Show reflog
    Reflog {
        /// Ref name (default HEAD)
        #[arg(default_value = "HEAD")]
        ref_name: String,
    },
}

#[derive(Subcommand)]
enum RemoteCommands {
    /// Add a remote
    Add {
        name: String,
        url: String,
    },
    /// Remove a remote
    Remove {
        name: String,
    },
    /// Remove a remote (alias)
    Rm {
        name: String,
    },
}

#[derive(Subcommand)]
enum StashCommands {
    /// Save working changes to stash
    Push {
        /// Message
        #[arg(short = 'm', long)]
        message: Option<String>,
        /// Include untracked
        #[arg(short = 'u', long)]
        include_untracked: bool,
    },
    /// List stashes
    List,
    /// Show stash diff
    Show {
        /// Stash index (default 0)
        #[arg(default_value = "0")]
        index: usize,
    },
    /// Apply stash without dropping
    Apply {
        #[arg(default_value = "0")]
        index: usize,
    },
    /// Pop stash (apply + drop)
    Pop {
        #[arg(default_value = "0")]
        index: usize,
    },
    /// Drop stash
    Drop {
        #[arg(default_value = "0")]
        index: usize,
    },
    /// Clear all stashes
    Clear,
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
            all,
            remotes,
            move_branch,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_branch(&repo, name, start_point, delete, force_delete, all, remotes, move_branch)?;
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
        Commands::Diff {
            staged,
            cached,
            target,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_diff(&repo, staged || cached, target)?;
        }
        Commands::Merge { branch, message } => {
            let repo = find_repo_or_cwd()?;
            cmd_merge(&repo, branch, message)?;
        }
        Commands::Remote { command, verbose } => {
            let repo = find_repo_or_cwd()?;
            cmd_remote(&repo, command, verbose)?;
        }
        Commands::Clone { url, path } => {
            cmd_clone(&url, path)?;
        }
        Commands::Fetch { remote } => {
            let repo = find_repo_or_cwd()?;
            cmd_fetch(&repo, remote)?;
        }
        Commands::Push {
            remote,
            branch,
            force,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_push(&repo, remote, branch, force)?;
        }
        Commands::Pull { remote, branch } => {
            let repo = find_repo_or_cwd()?;
            cmd_pull(&repo, remote, branch)?;
        }
        Commands::Fsck => {
            let repo = find_repo_or_cwd()?;
            cmd_fsck(&repo)?;
        }
        Commands::Gc { prune } => {
            let repo = find_repo_or_cwd()?;
            cmd_gc(&repo, prune)?;
        }
        Commands::Pack => {
            let repo = find_repo_or_cwd()?;
            cmd_pack(&repo)?;
        }
        Commands::CountObjects => {
            let repo = find_repo_or_cwd()?;
            cmd_count_objects(&repo)?;
        }
        Commands::Reset {
            commit,
            soft,
            mixed,
            hard,
            paths,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_reset(&repo, commit, soft, mixed, hard, paths)?;
        }
        Commands::Restore {
            staged,
            worktree,
            source,
            paths,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_restore(&repo, staged, worktree, source, paths)?;
        }
        Commands::Rm {
            paths,
            cached,
            force,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_rm(&repo, paths, cached, force)?;
        }
        Commands::Mv { source, dest, force } => {
            let repo = find_repo_or_cwd()?;
            cmd_mv(&repo, source, dest, force)?;
        }
        Commands::Clean {
            dry_run,
            force,
            dirs,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_clean(&repo, dry_run, force, dirs)?;
        }
        Commands::Stash { command, message, include_untracked } => {
            let repo = find_repo_or_cwd()?;
            cmd_stash(&repo, command, message, include_untracked)?;
        }
        Commands::Tag {
            name,
            annotated,
            delete,
            list,
            message,
        } => {
            let repo = find_repo_or_cwd()?;
            cmd_tag(&repo, name, annotated, delete, list, message)?;
        }
        Commands::Reflog { ref_name } => {
            let repo = find_repo_or_cwd()?;
            cmd_reflog(&repo, &ref_name)?;
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
            !itehaas_lib::index::should_ignore(rel) && !itehaas_lib::ignore::is_ignored(repo, rel, e.path().is_dir())
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
                    !itehaas_lib::index::should_ignore(rel) && !itehaas_lib::ignore::is_ignored(repo, rel, e.path().is_dir())
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

    // Get parent(s) — handle merge (second parent from MERGE_HEAD)
    let merge_head_path = repo.join(".itehaas").join("MERGE_HEAD");
    let merge_parent = if merge_head_path.exists() {
        let content = fs::read_to_string(&merge_head_path)?.trim().to_string();
        if content.is_empty() {
            None
        } else {
            let algo2 = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let h = Hash::from_hex(algo2, &content).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            Some(h)
        }
    } else {
        None
    };
    let mut parents = if let Some(p) = parent_opt { vec![p] } else { vec![] };
    if let Some(mh) = merge_parent.clone() {
        // Avoid duplicate if merge_head is same as parent
        if !parents.iter().any(|p| p.hex() == mh.hex()) {
            parents.push(mh);
        }
    }

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

    // Update ref with reflog
    let head = itehaas_lib::refs::read_head(repo).map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
    match head {
        itehaas_lib::refs::Head::Ref(r) | itehaas_lib::refs::Head::Unborn(r) => {
            let msg = format!("commit: {}", message.lines().next().unwrap_or(""));
            itehaas_lib::refs::write_ref_with_log(repo, &r, &commit_hash, &msg)
                .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
            let branch = r.strip_prefix("refs/heads/").unwrap_or(&r);
            println!("[{} {}] {}", branch, &commit_hash.hex()[..7], message.lines().next().unwrap_or(""));
        }
        itehaas_lib::refs::Head::Detached(_) => {
            let msg = format!("commit: {}", message.lines().next().unwrap_or(""));
            itehaas_lib::refs::write_head_detached_with_log(repo, &commit_hash, &msg)
                .map_err(|e: itehaas_lib::error::ItehaasError| anyhow::anyhow!(e.to_string()))?;
            println!("[detached {}] {}", &commit_hash.hex()[..7], message.lines().next().unwrap_or(""));
        }
    }

    println!(" {} files staged, tree {}", index.len(), tree_hash.hex()[..7].to_string());
    // Cleanup merge state if present
    if merge_parent.is_some() {
        let _ = fs::remove_file(repo.join(".itehaas").join("MERGE_HEAD"));
        let _ = fs::remove_file(repo.join(".itehaas").join("MERGE_MSG"));
        let _ = fs::remove_file(repo.join(".itehaas").join("MERGE_BRANCH"));
        println!("Merge commit created with {} parents", parents.len());
    }
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
    all: bool,
    remotes: bool,
    move_branch: bool,
) -> Result<()> {
    if move_branch {
        let old = name.ok_or_else(|| anyhow::anyhow!("branch -m requires <old> <new>"))?;
        let new = start_point.ok_or_else(|| anyhow::anyhow!("branch -m requires <old> <new>"))?;
        itehaas_lib::refs::validate_branch_name(&new).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let old_ref = format!("refs/heads/{}", old);
        let new_ref = format!("refs/heads/{}", new);
        let hash = itehaas_lib::refs::read_ref(repo, &old_ref).map_err(|e| anyhow::anyhow!(e.to_string()))?.ok_or_else(|| anyhow::anyhow!("branch '{}' not found", old))?;
        if itehaas_lib::refs::read_ref(repo, &new_ref).map_err(|e| anyhow::anyhow!(e.to_string()))?.is_some() {
            anyhow::bail!("branch '{}' already exists", new);
        }
        itehaas_lib::refs::write_ref(repo, &new_ref, &hash).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Update HEAD if current
        let cur = itehaas_lib::refs::current_branch(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if cur.as_deref() == Some(&old) {
            itehaas_lib::refs::write_head_ref(repo, &new_ref).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
        // Delete old
        itehaas_lib::refs::delete_branch(repo, &old).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // reflog
        let _ = itehaas_lib::reflog::append_reflog(repo, &new_ref, None, Some(&hash), &format!("Branch: renamed {} to {}", old, new));
        println!("Renamed branch {} -> {}", old, new);
        return Ok(());
    }
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
        // Create new branch (when not move)
        if all || remotes {
            anyhow::bail!("branch -a/-r cannot be used with creation");
        }
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
        // log branch creation
        let _ = itehaas_lib::reflog::append_reflog(repo, &ref_name, None, Some(&hash), &format!("branch: Created from {}", start));
        println!("Created branch '{}' at {}", n, &hash.hex()[..7]);
    } else {
        // List
        let current = itehaas_lib::refs::current_branch(repo)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .unwrap_or_default();
        let head = itehaas_lib::refs::read_head(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let is_detached = matches!(head, itehaas_lib::refs::Head::Detached(_));
        let mut branches = Vec::new();
        let local = itehaas_lib::refs::list_branches(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if all || (!remotes) {
            for b in local { branches.push(if all { format!("{}", b) } else { b }); }
        }
        if all || remotes {
            // list remote tracking branches: refs/remotes/*/*
            let remotes_dir = repo.join(".itehaas").join("refs").join("remotes");
            if remotes_dir.exists() {
                for entry in walkdir::WalkDir::new(&remotes_dir).min_depth(1) {
                    let e = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
                    if e.path().is_file() {
                        let rel = e.path().strip_prefix(&remotes_dir).unwrap();
                        let name = format!("remotes/{}", rel.to_string_lossy().replace('\\', "/"));
                        branches.push(name);
                    }
                }
                branches.sort();
            }
        }
        if branches.is_empty() {
            println!("No branches");
            if is_detached {
                println!("HEAD detached");
            }
            return Ok(());
        }
        for b in branches {
            let is_current = if b.starts_with("remotes/") { false } else { b == current && !is_detached };
            if is_current {
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

fn cmd_diff(repo: &Path, staged: bool, target: Option<String>) -> Result<()> {
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if staged {
        let diffs = itehaas_lib::diff::diff_index_vs_head(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if diffs.is_empty() {
            return Ok(());
        }
        for d in diffs {
            println!("{} {}", d.status_str(), d.path);
            let old_content = if let Some(h) = d.old_hash {
                itehaas_lib::diff::get_blob_content(repo, &h, hasher.as_ref()).ok()
            } else {
                None
            };
            let new_content = if let Some(h) = d.new_hash {
                itehaas_lib::diff::get_blob_content(repo, &h, hasher.as_ref()).ok()
            } else {
                None
            };
            match (old_content, new_content) {
                (Some(old), Some(new)) => {
                    print!("{}", itehaas_lib::diff::unified_diff(&old, &new, &d.path));
                }
                (None, Some(new)) => {
                    print!("{}", itehaas_lib::diff::unified_diff(b"", &new, &d.path));
                }
                (Some(old), None) => {
                    print!("{}", itehaas_lib::diff::unified_diff(&old, b"", &d.path));
                }
                _ => {}
            }
        }
        return Ok(());
    }

    if let Some(tgt) = target {
        // Diff HEAD vs target
        let target_hash = itehaas_lib::refs::resolve_rev(repo, &tgt)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("target '{}' not found", tgt))?;
        let diffs = itehaas_lib::diff::diff_head_vs_commit(repo, &target_hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if diffs.is_empty() {
            return Ok(());
        }
        for d in diffs {
            println!("{} {}", d.status_str(), d.path);
            let old_content = if let Some(h) = d.old_hash {
                itehaas_lib::diff::get_blob_content(repo, &h, hasher.as_ref()).ok()
            } else {
                None
            };
            let new_content = if let Some(h) = d.new_hash {
                itehaas_lib::diff::get_blob_content(repo, &h, hasher.as_ref()).ok()
            } else {
                None
            };
            match (old_content, new_content) {
                (Some(old), Some(new)) => print!("{}", itehaas_lib::diff::unified_diff(&old, &new, &d.path)),
                (None, Some(new)) => print!("{}", itehaas_lib::diff::unified_diff(b"", &new, &d.path)),
                (Some(old), None) => print!("{}", itehaas_lib::diff::unified_diff(&old, b"", &d.path)),
                _ => {}
            }
        }
        return Ok(());
    }

    // Default: working tree vs index
    let diffs = itehaas_lib::diff::diff_working_vs_index(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if diffs.is_empty() {
        return Ok(());
    }
    for d in diffs {
        println!("{} {}", d.status_str(), d.path);
        // For working vs index, need to get working file content directly
        let old_content = if let Some(h) = d.old_hash {
            itehaas_lib::diff::get_blob_content(repo, &h, hasher.as_ref()).ok()
        } else {
            None
        };
        let new_content = if d.new_hash.is_some() {
            // Read from working tree file
            let p = repo.join(&d.path);
            fs::read(&p).ok()
        } else {
            None
        };
        match (old_content, new_content) {
            (Some(old), Some(new)) => print!("{}", itehaas_lib::diff::unified_diff(&old, &new, &d.path)),
            (None, Some(new)) => print!("{}", itehaas_lib::diff::unified_diff(b"", &new, &d.path)),
            (Some(old), None) => print!("{}", itehaas_lib::diff::unified_diff(&old, b"", &d.path)),
            _ => {}
        }
    }
    Ok(())
}

fn cmd_merge(repo: &Path, branch: String, message: Option<String>) -> Result<()> {
    // Check current branch
    let current_branch = itehaas_lib::refs::current_branch(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("cannot merge in detached HEAD state"))?;
    if current_branch == branch {
        anyhow::bail!("cannot merge branch '{}' into itself", branch);
    }
    // Check MERGE_HEAD exists (already merging)
    if repo.join(".itehaas").join("MERGE_HEAD").exists() {
        anyhow::bail!("already in a merge (MERGE_HEAD exists), commit or abort first");
    }
    let current_hash = itehaas_lib::refs::resolve_head(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("HEAD has no commit"))?;
    let feature_hash = itehaas_lib::refs::read_ref(repo, &format!("refs/heads/{}", branch))
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("branch '{}' not found", branch))?;

    let result = itehaas_lib::merge::merge(repo, &branch, &feature_hash, &current_branch, &current_hash)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if result.already_up_to_date {
        println!("Already up to date.");
        return Ok(());
    }
    if result.fast_forward {
        println!("Fast-forward merge: {} -> {}", current_branch, branch);
        println!("Updated {} to {}", current_branch, &feature_hash.hex()[..7]);
        return Ok(());
    }
    if !result.conflicts.is_empty() {
        println!("Auto-merging failed with conflicts:");
        for c in &result.conflicts {
            println!("  CONFLICT (content): Merge conflict in {}", c);
        }
        println!("Automatic merge failed; fix conflicts and then commit the result.");
        // Write merge message if provided, otherwise keep default
        if let Some(msg) = message {
            fs::write(repo.join(".itehaas").join("MERGE_MSG"), msg)?;
        }
        return Ok(());
    }
    // No conflicts, merge commit already created inside merge()
    let new_head = itehaas_lib::refs::resolve_head(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .unwrap();
    println!(
        "Merge made by the 'ort' strategy. {}",
        new_head.hex()[..7].to_string()
    );
    if let Some(msg) = message {
        println!("(custom message ignored for auto-merge, using default)");
        let _ = msg;
    }
    Ok(())
}

fn cmd_remote(repo: &Path, command: Option<RemoteCommands>, verbose: bool) -> Result<()> {
    match command {
        None => {
            let remotes = config::list_remotes(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            if remotes.is_empty() {
                println!("No remotes");
            } else {
                for (name, url) in remotes {
                    if verbose {
                        println!("{} {} (fetch)", name, url);
                        println!("{} {} (push)", name, url);
                    } else {
                        println!("{}", name);
                    }
                }
            }
        }
        Some(RemoteCommands::Add { name, url }) => {
            config::add_remote(repo, &name, &url).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Added remote '{}' -> {}", name, url);
        }
        Some(RemoteCommands::Remove { name }) | Some(RemoteCommands::Rm { name }) => {
            config::remove_remote(repo, &name).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Removed remote '{}'", name);
        }
    }
    Ok(())
}

fn redact_url(url: &str) -> String {
    // Redact query string for display (tokens must not leak)
    url.split('?').next().unwrap_or(url).to_string()
}

fn cmd_clone(url: &str, dest: Option<PathBuf>) -> Result<()> {
    if itehaas_lib::remote::is_http_url(url) {
        return cmd_clone_http(url, dest);
    }
    let cwd = std::env::current_dir()?;
    // Resolve remote path
    let remote_path = {
        let p = PathBuf::from(if url.starts_with("file://") { &url[7..] } else { url });
        let ap = if p.is_absolute() { p } else { cwd.join(&p) };
        // If ap is .itehaas dir, get parent
        let cand = if ap.ends_with(".itehaas") {
            ap.parent().unwrap().to_path_buf()
        } else {
            ap
        };
        cand.canonicalize().map_err(|_| anyhow::anyhow!("remote '{}' not found", redact_url(url)))?
    };
    if !remote_path.join(".itehaas").exists() {
        anyhow::bail!("remote '{}' is not a repository", redact_url(url));
    }
    let dest_path = if let Some(p) = dest {
        if p.is_absolute() {
            p
        } else {
            cwd.join(p)
        }
    } else {
        // Derive from url basename
        let base = remote_path.file_name().ok_or_else(|| anyhow::anyhow!("invalid remote url"))?;
        let name = base.to_string_lossy().trim_end_matches(".itehaas").to_string();
        let n = if name.is_empty() { "repo".to_string() } else { name };
        cwd.join(n)
    };
    if dest_path.exists() {
        anyhow::bail!("destination '{}' already exists", dest_path.display());
    }
    fs::create_dir_all(&dest_path)?;
    let algo = config::read_hasher(&remote_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Init new repo
    let new_repo = itehaas_lib::init(&dest_path, algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Copy config user? Not needed, but copy hasher already done via init
    // Add remote origin
    config::add_remote(&new_repo, "origin", url).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Copy objects and refs
    let mut transferred = 0;
    let remote_heads = itehaas_lib::remote::list_remote_refs(&remote_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if remote_heads.is_empty() {
        println!("Cloned empty repository from {} to {}", url, dest_path.display());
        return Ok(());
    }
    for (ref_name, hash) in &remote_heads {
        transferred += itehaas_lib::remote::transfer_objects(&remote_path, &new_repo, hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Write to refs/remotes/origin/*
        let remote_ref = ref_name.replace("refs/heads/", "refs/remotes/origin/");
        itehaas_lib::refs::write_ref(&new_repo, &remote_ref, hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    // Determine HEAD branch from remote
    let remote_head = fs::read_to_string(remote_path.join(".itehaas").join("HEAD"))
        .unwrap_or_else(|_| "ref: refs/heads/main".to_string());
    let head_branch = if remote_head.trim().starts_with("ref: ") {
        remote_head.trim()["ref: ".len()..].trim().to_string()
    } else {
        "refs/heads/main".to_string()
    };
    let head_branch_name = head_branch.strip_prefix("refs/heads/").unwrap_or("main");
    // Find hash for that branch
    let head_hash_opt = remote_heads
        .iter()
        .find(|(n, _)| n == &head_branch)
        .map(|(_, h)| h.clone())
        .or_else(|| remote_heads.first().map(|(_, h)| h.clone()));
    if let Some(h) = head_hash_opt {
        // Create local branch
        itehaas_lib::refs::write_ref(&new_repo, &head_branch, &h)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        itehaas_lib::refs::write_head_ref(&new_repo, &head_branch)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Checkout working tree (forced, since index is empty vs HEAD)
        itehaas_lib::checkout::checkout_branch_forced(&new_repo, head_branch_name)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!(
            "Cloned {} to {} ({} objects, branch {})",
            url,
            dest_path.display(),
            transferred,
            head_branch_name
        );
    } else {
        println!("Cloned {} to {} (empty, {} objects)", redact_url(url), dest_path.display(), transferred);
    }
    Ok(())
}

fn cmd_clone_http(url: &str, dest: Option<PathBuf>) -> Result<()> {
    use std::collections::HashSet;

    let cwd = std::env::current_dir()?;
    let base = itehaas_lib::remote::http::validate_http_base(url)?;
    // Derive dest path
    let dest_path = if let Some(p) = dest {
        if p.is_absolute() { p } else { cwd.join(p) }
    } else {
        // Derive from base: last segment after last '/' (owner/repo -> repo)
        let last = base.rsplit('/').next().ok_or_else(|| anyhow::anyhow!("invalid http url"))?;
        let name = last.trim_end_matches(".itehaas");
        let n = if name.is_empty() { "repo".to_string() } else { name.to_string() };
        // Validate derived name
        if n.contains('/') || n.contains('\0') || n.len() > 100 {
            cwd.join("repo")
        } else {
            cwd.join(n)
        }
    };
    if dest_path.exists() {
        anyhow::bail!("destination '{}' already exists", dest_path.display());
    }
    fs::create_dir_all(&dest_path)?;

    // Inner helper to ensure cleanup on failure (hack-proof: don't leave partial clone)
    let inner: Result<()> = (|| {
        // Fetch refs advertisement
        let http_refs = itehaas_lib::remote::http::fetch_refs_http(&base)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        // Parse hasher
        let algo = HashAlgo::from_str(&http_refs.hasher).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Init new repo with that algo
        let new_repo = itehaas_lib::init(&dest_path, algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Always add remote (redacted url for print)
        itehaas_lib::config::add_remote(&new_repo, "origin", url).map_err(|e| anyhow::anyhow!(e.to_string()))?;

        if http_refs.refs.is_empty() {
            println!("Cloned empty repository from {} to {}", redact_url(&base), dest_path.display());
            return Ok(());
        }

        let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let mut visited: HashSet<String> = HashSet::new();
        let mut transferred_est = 0usize;

        // Download each head's reachable DAG
        for (ref_name, hash_hex) in &http_refs.refs {
            let hash = Hash::from_hex(algo, hash_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            // Validate hash already, but double-check
            itehaas_lib::remote::http::download_recursive_http(&base, &new_repo, &hash, &mut visited, 0)
                .map_err(|e| anyhow::anyhow!("fetching {} ({}): {}", ref_name, &hash_hex[..7], e))?;
            // Write remote-tracking ref
            let remote_ref = ref_name.replace("refs/heads/", "refs/remotes/origin/");
            itehaas_lib::refs::write_ref(&new_repo, &remote_ref, &hash)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            transferred_est = visited.len();
        }

        // Determine HEAD branch
        let head_branch = if http_refs.head.starts_with("refs/heads/") {
            http_refs.head.clone()
        } else if http_refs.head.starts_with("ref: ") {
            http_refs.head["ref: ".len()..].trim().to_string()
        } else {
            "refs/heads/main".to_string()
        };
        let head_branch_name = head_branch
            .strip_prefix("refs/heads/")
            .unwrap_or("main")
            .to_string();

        // Find hash for HEAD (fallback to first ref)
        let head_hash_hex_opt = http_refs
            .refs
            .iter()
            .find(|(n, _)| n == &head_branch)
            .map(|(_, h)| h.clone())
            .or_else(|| http_refs.refs.first().map(|(_, h)| h.clone()));

        if let Some(h_hex) = head_hash_hex_opt {
            let h = Hash::from_hex(algo, &h_hex).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            // Ensure local branch exists
            itehaas_lib::refs::write_ref(&new_repo, &head_branch, &h)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            itehaas_lib::refs::write_head_ref(&new_repo, &head_branch)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            // Verify object present before checkout
            let _ = itehaas_lib::object::store::read_object(&new_repo, &h, hasher.as_ref())
                .map_err(|e| anyhow::anyhow!("head object missing after fetch: {}", e))?;
            itehaas_lib::checkout::checkout_branch_forced(&new_repo, &head_branch_name)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!(
                "Cloned {} to {} ({} objects, branch {})",
                redact_url(&base),
                dest_path.display(),
                transferred_est,
                head_branch_name
            );
        } else {
            println!(
                "Cloned {} to {} ({} objects, no HEAD)",
                redact_url(&base),
                dest_path.display(),
                transferred_est
            );
        }
        Ok(())
    })();

    if let Err(e) = inner {
        // Cleanup partial clone to avoid blocking retry and leaking incomplete state
        let _ = fs::remove_dir_all(&dest_path);
        return Err(e);
    }
    Ok(())
}

fn cmd_fetch(repo: &Path, remote_opt: Option<String>) -> Result<()> {
    let remote_name = remote_opt.unwrap_or_else(|| "origin".to_string());
    let url = config::get_remote_url(repo, &remote_name)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("remote '{}' not found", remote_name))?;
    let remote_path = itehaas_lib::remote::resolve_remote_path(repo, &url)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let remote_algo = config::read_hasher(&remote_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if algo != remote_algo {
        anyhow::bail!("hash algorithm mismatch: local {} vs remote {}", algo, remote_algo);
    }
    let remote_refs = itehaas_lib::remote::list_remote_refs(&remote_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if remote_refs.is_empty() {
        println!("No refs from remote '{}'", remote_name);
        return Ok(());
    }
    let mut fetched = 0;
    for (ref_name, hash) in remote_refs {
        // Transfer objects reachable from this ref that are missing locally
        let already = itehaas_lib::object::store::object_path(repo, &hash).exists();
        let transferred = itehaas_lib::remote::transfer_objects(&remote_path, repo, &hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        fetched += transferred;
        // Update remote ref: refs/remotes/<remote>/<branch>
        let branch = ref_name.strip_prefix("refs/heads/").unwrap();
        let remote_ref = format!("refs/remotes/{}/{}", remote_name, branch);
        itehaas_lib::refs::write_ref(repo, &remote_ref, &hash)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if already {
            println!(" * branch {} -> {}", branch, &hash.hex()[..7]);
        } else {
            println!(" * new branch {} -> {}", branch, &hash.hex()[..7]);
        }
    }
    println!("Fetched {} objects from {}", fetched, remote_name);
    Ok(())
}

fn cmd_push(repo: &Path, remote_opt: Option<String>, branch_opt: Option<String>, force: bool) -> Result<()> {
    let remote_name = remote_opt.unwrap_or_else(|| "origin".to_string());
    let url = config::get_remote_url(repo, &remote_name)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("remote '{}' not found", remote_name))?;
    let remote_path = itehaas_lib::remote::resolve_remote_path(repo, &url)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let remote_algo = config::read_hasher(&remote_path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if algo != remote_algo {
        anyhow::bail!("hash algorithm mismatch");
    }
    // Determine branch to push: current branch if not specified
    let branch = if let Some(b) = branch_opt {
        b
    } else {
        itehaas_lib::refs::current_branch(repo)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("cannot push detached HEAD, specify branch"))?
    };
    let local_ref = format!("refs/heads/{}", branch);
    let local_hash = itehaas_lib::refs::read_ref(repo, &local_ref)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("branch '{}' has no commits", branch))?;
    let remote_ref = format!("refs/heads/{}", branch);
    let remote_hash_opt = itehaas_lib::refs::read_ref(&remote_path, &remote_ref)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Check fast-forward
    if let Some(remote_hash) = &remote_hash_opt {
        if remote_hash.hex() == local_hash.hex() {
            println!("Already up to date.");
            return Ok(());
        }
        if !force {
            let is_ff = itehaas_lib::merge::is_ancestor(repo, remote_hash, &local_hash)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            if !is_ff {
                anyhow::bail!(
                    "non-fast-forward push rejected (remote {} is not ancestor of local); use --force",
                    &remote_hash.hex()[..7]
                );
            }
        }
    }

    let transferred = itehaas_lib::remote::transfer_objects(repo, &remote_path, &local_hash)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    itehaas_lib::refs::write_ref(&remote_path, &remote_ref, &local_hash)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Also update remote's HEAD? Not needed
    println!(
        "Pushed {} to {} ({} objects)",
        branch,
        remote_name,
        transferred
    );
    println!(" * {} -> {} {}", branch, remote_name, &local_hash.hex()[..7]);
    Ok(())
}

fn cmd_pull(repo: &Path, remote_opt: Option<String>, branch_opt: Option<String>) -> Result<()> {
    let remote_name = remote_opt.clone().unwrap_or_else(|| "origin".to_string());
    // First fetch
    cmd_fetch(repo, remote_opt.clone())?;
    // Determine branch to merge: if branch_opt given, use that, else current
    let target_branch = if let Some(b) = branch_opt {
        b
    } else {
        itehaas_lib::refs::current_branch(repo)
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("cannot pull detached HEAD without branch"))?
    };
    let remote_ref = format!("refs/remotes/{}/{}", remote_name, target_branch);
    let remote_hash = itehaas_lib::refs::read_ref(repo, &remote_ref)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("remote branch '{}' not found after fetch", remote_ref))?;
    let current_branch = itehaas_lib::refs::current_branch(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("cannot pull in detached HEAD"))?;
    let current_hash = itehaas_lib::refs::resolve_head(repo)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("HEAD has no commit"))?;

    // If already up to date or fast-forward, handle
    if remote_hash.hex() == current_hash.hex() {
        println!("Already up to date.");
        return Ok(());
    }
    // Use merge logic
    let res = itehaas_lib::merge::merge(repo, &remote_ref, &remote_hash, &current_branch, &current_hash)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if res.already_up_to_date {
        println!("Already up to date.");
    } else if res.fast_forward {
        println!("Fast-forward pull: {} -> {}", current_branch, target_branch);
    } else if !res.conflicts.is_empty() {
        println!("Pull resulted in conflicts:");
        for c in res.conflicts {
            println!("  CONFLICT in {}", c);
        }
        println!("Fix conflicts and commit.");
    } else {
        println!("Merge made: {} objects, {} staged", res.staged.len(), res.conflicts.len());
    }
    Ok(())
}

fn cmd_fsck(repo: &Path) -> Result<()> {
    let report = itehaas_lib::fsck::fsck(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    println!("fsck: checked {} objects", report.total);
    if report.corrupted.is_empty() && report.missing_refs.is_empty() {
        println!("ok: no corruption");
    } else {
        for c in &report.corrupted {
            println!("corrupt: {}", c);
        }
        for m in &report.missing_refs {
            println!("missing ref: {}", m);
        }
        anyhow::bail!("fsck found {} corrupted, {} missing refs", report.corrupted.len(), report.missing_refs.len());
    }
    if report.unreachable > 0 {
        println!("unreachable: {} objects (run `itehaas gc --prune`)", report.unreachable);
    }
    Ok(())
}

fn cmd_gc(repo: &Path, prune: bool) -> Result<()> {
    let unreachable = itehaas_lib::gc::gc(repo, prune).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if prune {
        println!("gc: pruned {} unreachable objects", unreachable);
    } else {
        println!("gc: found {} unreachable objects (use --prune to delete)", unreachable);
    }
    Ok(())
}

fn cmd_pack(repo: &Path) -> Result<()> {
    let (path, count, orig, packed) = itehaas_lib::pack::create_pack(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    println!("pack: created {} with {} objects ({} -> {} bytes, {:.1}% )", path.display(), count, orig, packed, (packed as f64 / orig as f64 * 100.0));
    let verified = itehaas_lib::pack::verify_pack(repo, &path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    println!("pack: verified {} entries", verified);
    Ok(())
}

fn cmd_count_objects(repo: &Path) -> Result<()> {
    let count = itehaas_lib::fsck::count_objects(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let packs = itehaas_lib::pack::list_packs(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    println!("count: {} loose objects, {} packs", count, packs.len());
    for p in packs {
        println!("  pack: {}", p.display());
    }
    Ok(())
}

fn cmd_reset(
    repo: &Path,
    commit: Option<String>,
    soft: bool,
    mixed: bool,
    hard: bool,
    paths: Vec<PathBuf>,
) -> Result<()> {
    // File-level reset: if paths non-empty (filter out -- separator)
    let filtered: Vec<PathBuf> = paths.into_iter().filter(|p| p.to_string_lossy() != "--").collect();
    if !filtered.is_empty() {
        let rev = commit.unwrap_or_else(|| "HEAD".to_string());
        let target = itehaas_lib::reset::resolve_commit(repo, &rev).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let strs: Vec<String> = filtered.iter().map(|p| p.to_string_lossy().replace('\\', "/")).collect();
        let affected = itehaas_lib::reset::reset_paths(repo, &target, &strs).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!("Unstaged {} files", affected.len());
        for a in affected { println!("  {}", a); }
        return Ok(());
    }
    // Commit-level reset
    let mode = if hard { "hard" } else if soft { "soft" } else { "mixed" };
    let rev = commit.unwrap_or_else(|| "HEAD".to_string());
    let target = itehaas_lib::reset::resolve_commit(repo, &rev).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let msg = format!("reset: moving to {} ({})", rev, mode);
    match mode {
        "soft" => itehaas_lib::reset::reset_soft(repo, &target, &msg).map_err(|e| anyhow::anyhow!(e.to_string()))?,
        "mixed" => itehaas_lib::reset::reset_mixed(repo, &target, &msg).map_err(|e| anyhow::anyhow!(e.to_string()))?,
        "hard" => itehaas_lib::reset::reset_hard(repo, &target, &msg).map_err(|e| anyhow::anyhow!(e.to_string()))?,
        _ => {}
    }
    println!("HEAD is now at {} {}", &target.hex()[..7], rev);
    Ok(())
}

fn cmd_restore(
    repo: &Path,
    staged: bool,
    worktree: bool,
    source: Option<String>,
    paths: Vec<PathBuf>,
) -> Result<()> {
    let filtered: Vec<PathBuf> = paths.into_iter().filter(|p| p.to_string_lossy() != "--").collect();
    let strs: Vec<String> = filtered.iter().map(|p| p.to_string_lossy().replace('\\', "/")).collect();
    // Determine source hash if provided
    let source_hash: Option<itehaas_lib::hash::Hash> = if let Some(s) = source {
        Some(itehaas_lib::reset::resolve_commit(repo, &s).map_err(|e| anyhow::anyhow!(e.to_string()))?)
    } else { None };
    // Determine worktree vs staged booleans: if neither set, default worktree true; if staged true and worktree not set, staged only; if both, both.
    // Our flag naming: staged flag means --staged, worktree flag means --worktree explicit, but we treat as per spec.
    let (do_staged, do_worktree) = if staged && worktree {
        (true, true)
    } else if staged {
        (true, false)
    } else if worktree {
        (false, true)
    } else {
        // Neither: if source provided and staged not set, default worktree
        (false, true)
    };
    // Special case: --source with staged implied? We'll follow do_* as above
    // If do_staged and source None -> source is HEAD (handled inside restore)
    // If do_worktree and source None -> source is index
    let affected = itehaas_lib::restore::restore(repo, &strs, do_staged, source_hash.as_ref(), do_worktree).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if affected.is_empty() {
        println!("No files restored");
    } else {
        println!("Restored {} files", affected.len());
        for a in affected { println!("  {}", a); }
    }
    Ok(())
}

fn cmd_rm(repo: &Path, paths: Vec<PathBuf>, cached: bool, force: bool) -> Result<()> {
    let filtered: Vec<PathBuf> = paths.into_iter().filter(|p| p.to_string_lossy() != "--").collect();
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut index = Index::load(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let st = itehaas_lib::status::status(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    for p in filtered {
        let rel = p.to_string_lossy().replace('\\', "/");
        let rel = rel.trim_start_matches("./").to_string();
        if !index.contains(&rel) {
            anyhow::bail!("pathspec '{}' did not match any indexed files", rel);
        }
        // Safety: if unstaged changes exist and not force, warn but still allow for new files; we relax check to allow rm without -f for educational prototype
        // Only require -f if file has unstaged modifications that would be lost
        let unstaged = st.not_staged.iter().any(|e| e.path == rel);
        if unstaged && !force {
            // For Phase 11, we allow but warn; no bail
            eprintln!("warning: file '{}' has unstaged changes", rel);
        }
        // Remove from index
        index.remove(&rel);
        if !cached {
            let abs = repo.join(&rel);
            if abs.exists() {
                fs::remove_file(&abs).with_context(|| format!("removing {}", rel))?;
                // remove empty parent dirs
                if let Some(parent) = abs.parent() {
                    let mut cur = parent.to_path_buf();
                    while cur != *repo && cur.starts_with(repo) {
                        match fs::remove_dir(&cur) {
                            Ok(_) => if let Some(pp) = cur.parent() { cur = pp.to_path_buf(); } else { break; },
                            Err(_) => break,
                        }
                    }
                }
            }
        }
        println!("rm '{}'", rel);
    }
    index.save(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(())
}

fn cmd_mv(repo: &Path, source: PathBuf, dest: PathBuf, force: bool) -> Result<()> {
    let src_rel = source.to_string_lossy().replace('\\', "/");
    let src_rel = src_rel.trim_start_matches("./").to_string();
    let dst_rel = dest.to_string_lossy().replace('\\', "/");
    let dst_rel = dst_rel.trim_start_matches("./").to_string();
    let mut index = Index::load(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if !index.contains(&src_rel) {
        anyhow::bail!("source '{}' not in index", src_rel);
    }
    if index.contains(&dst_rel) && !force {
        anyhow::bail!("destination '{}' already exists; use -f to force", dst_rel);
    }
    let src_abs = repo.join(&src_rel);
    let dst_abs = repo.join(&dst_rel);
    if dst_abs.exists() && !force {
        anyhow::bail!("destination '{}' exists in working tree; use -f", dst_rel);
    }
    if !src_abs.exists() {
        anyhow::bail!("source '{}' not found in working tree", src_rel);
    }
    if let Some(parent) = dst_abs.parent() { fs::create_dir_all(parent)?; }
    fs::rename(&src_abs, &dst_abs).with_context(|| format!("rename {} -> {}", src_rel, dst_rel))?;
    // Update index: remove src, add dst with same hash recomputed? Actually mode preserved but hash same if not modified; we re-hash dest file
    let entry = index.get(&src_rel).cloned().ok_or_else(|| anyhow::anyhow!("index inconsistency"))?;
    index.remove(&src_rel);
    // Re-hash dest file to be safe (could have been moved without modification)
    let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let data = fs::read(&dst_abs)?;
    let blob = Blob::new(data);
    let hash = itehaas_lib::object::store::write_object(repo, &Object::Blob(blob), hasher.as_ref()).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mode = file_mode(&fs::metadata(&dst_abs)?);
    // Preserve original mode if not force? Use computed
    let new_entry = IndexEntry::new(dst_rel.clone(), hash, mode);
    index.add_or_update(new_entry);
    index.save(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Remove empty src parent dirs
    if let Some(parent) = src_abs.parent() {
        let mut cur = parent.to_path_buf();
        while cur != *repo && cur.starts_with(repo) {
            match fs::remove_dir(&cur) {
                Ok(_) => if let Some(pp) = cur.parent() { cur = pp.to_path_buf(); } else { break; },
                Err(_) => break,
            }
        }
    }
    println!("mv {} -> {}", src_rel, dst_rel);
    Ok(())
}

fn cmd_clean(repo: &Path, dry_run: bool, force: bool, dirs: bool) -> Result<()> {
    if !dry_run && !force {
        anyhow::bail!("clean requires -f to force or -n to dry-run");
    }
    let st = itehaas_lib::status::status(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut to_remove: Vec<String> = Vec::new();
    // Untracked files are candidates
    to_remove.extend(st.untracked.clone());
    // If -d, also consider untracked directories? Our untracked list is files only, but we report per file
    // For directories, find untracked dirs that are empty except untracked files - walk working tree for untracked dirs
    let mut untracked_dirs: Vec<String> = Vec::new();
    if dirs {
        for entry in walkdir::WalkDir::new(repo).min_depth(1).into_iter().filter_entry(|e| {
            let rel = e.path().strip_prefix(repo).unwrap_or(e.path());
            !itehaas_lib::index::should_ignore(rel) && !itehaas_lib::ignore::is_ignored(repo, rel, e.path().is_dir())
        }) {
            let entry = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let p = entry.path();
            if p.is_dir() {
                let rel = p.strip_prefix(repo).unwrap();
                if itehaas_lib::index::should_ignore(rel) || itehaas_lib::ignore::is_ignored(repo, rel, true) { continue; }
                // Check if dir contains only untracked files (no tracked)
                let mut has_tracked = false;
                for inner in walkdir::WalkDir::new(p).min_depth(1) {
                    let inner = inner.map_err(|e| anyhow::anyhow!(e.to_string()))?;
                    if inner.path().is_file() {
                        let r = inner.path().strip_prefix(repo).unwrap();
                        let rs = path_to_string(r);
                        if !st.untracked.contains(&rs) {
                            has_tracked = true;
                            break;
                        }
                    }
                }
                if !has_tracked {
                    let rs = path_to_string(rel);
                    if !rs.is_empty() && !untracked_dirs.contains(&rs) {
                        untracked_dirs.push(rs);
                    }
                }
            }
        }
    }
    let all_to_delete: Vec<String> = if dirs { to_remove.iter().cloned().chain(untracked_dirs.iter().cloned()).collect() } else { to_remove.clone() };
    let mut uniq: Vec<String> = all_to_delete.clone();
    uniq.sort(); uniq.dedup();
    if dry_run {
        if uniq.is_empty() {
            println!("Would remove 0 files");
        } else {
            println!("Would remove {} files:", uniq.len());
            for f in &uniq { println!("  Would remove {}", f); }
        }
        return Ok(());
    }
    // Force deletion
    for f in uniq {
        let abs = repo.join(&f);
        if abs.is_file() {
            let _ = fs::remove_file(&abs);
            println!("Removing {}", f);
        } else if abs.is_dir() && dirs {
            let _ = fs::remove_dir_all(&abs);
            println!("Removing {} (dir)", f);
        }
    }
    // Clean empty dirs left
    if dirs {
        for entry in walkdir::WalkDir::new(repo).min_depth(1).contents_first(true) {
            let entry = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let p = entry.path();
            if p.is_dir() && p != repo {
                let rel = p.strip_prefix(repo).unwrap_or(p);
                if rel.components().any(|c| c.as_os_str()==".itehaas") { continue; }
                let _ = fs::remove_dir(p);
            }
        }
    }
    Ok(())
}

fn cmd_stash(repo: &Path, command: Option<StashCommands>, message: Option<String>, include_untracked: bool) -> Result<()> {
    match command {
        None => {
            // Default push with message from flag
            let msg = message.unwrap_or_default();
            let hash = itehaas_lib::stash::stash_push(repo, &msg, include_untracked).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Saved working directory and index state WIP on {}: {}", itehaas_lib::refs::current_branch(repo).unwrap_or(Some("HEAD".to_string())).unwrap_or("HEAD".to_string()), &hash.hex()[..7]);
        }
        Some(StashCommands::Push { message: m, include_untracked: inc }) => {
            let msg = m.unwrap_or_default();
            let hash = itehaas_lib::stash::stash_push(repo, &msg, inc).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Saved stash {}", &hash.hex()[..7]);
        }
        Some(StashCommands::List) => {
            let list = itehaas_lib::stash::stash_list(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            if list.is_empty() { println!("No stash entries found."); } else {
                for (i, (h, msg)) in list.iter().enumerate() {
                    println!("stash@{{{}}}: {} {}", i, &h.hex()[..7], msg.lines().next().unwrap_or(""));
                }
            }
        }
        Some(StashCommands::Show { index }) => {
            let out = itehaas_lib::stash::stash_show(repo, index).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            print!("{}", out);
        }
        Some(StashCommands::Apply { index }) => {
            itehaas_lib::stash::stash_apply(repo, index, false).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Applied stash@{{{}}}", index);
        }
        Some(StashCommands::Pop { index }) => {
            itehaas_lib::stash::stash_pop(repo, index).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Popped stash@{{{}}}", index);
        }
        Some(StashCommands::Drop { index }) => {
            itehaas_lib::stash::stash_drop(repo, index).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Dropped stash@{{{}}}", index);
        }
        Some(StashCommands::Clear) => {
            itehaas_lib::stash::stash_clear(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Cleared all stashes");
        }
    }
    Ok(())
}

fn cmd_tag(repo: &Path, name: Option<String>, annotated: bool, delete: bool, list: bool, message: Option<String>) -> Result<()> {
    if list || name.is_none() {
        // List tags
        let tags_dir = repo.join(".itehaas").join("refs").join("tags");
        let mut tags = Vec::new();
        if tags_dir.exists() {
            for entry in walkdir::WalkDir::new(&tags_dir).min_depth(1) {
                let entry = entry.map_err(|e| anyhow::anyhow!(e.to_string()))?;
                let p = entry.path();
                if p.is_file() {
                    let rel = p.strip_prefix(&tags_dir).unwrap();
                    tags.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        tags.sort();
        for t in tags { println!("{}", t); }
        return Ok(());
    }
    let tag_name = name.unwrap();
    // Validate tag name similar to branch but allow dots and allow v1.0 style
    validate_tag_name(&tag_name)?;
    let ref_name = format!("refs/tags/{}", tag_name);
    if delete {
        let p = repo.join(".itehaas").join(&ref_name);
        if !p.exists() { anyhow::bail!("tag '{}' not found", tag_name); }
        fs::remove_file(&p)?;
        // reflog? tags don't have reflog; remove log if exists
        let log = repo.join(".itehaas").join("logs").join(&ref_name);
        let _ = fs::remove_file(log);
        println!("Deleted tag '{}'", tag_name);
        return Ok(());
    }
    if repo.join(".itehaas").join(&ref_name).exists() {
        anyhow::bail!("tag '{}' already exists", tag_name);
    }
    let head = itehaas_lib::refs::resolve_head(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?.ok_or_else(|| anyhow::anyhow!("no commits yet"))?;
    if annotated {
        let algo = config::read_hasher(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let (cfg_name, cfg_email) = config::read_user(repo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let name = cfg_name.unwrap_or_else(|| "Author".to_string());
        let email = cfg_email.unwrap_or_else(|| "author@example.com".to_string());
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let tz = "+0000".to_string();
        let sig = itehaas_lib::object::Signature::new(name, email, ts, tz).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let msg = message.unwrap_or_else(|| format!("tag {}", tag_name));
        let tag_obj = itehaas_lib::object::Tag {
            object: head.clone(),
            object_type: "commit".to_string(),
            name: tag_name.clone(),
            tagger: sig,
            message: msg,
        };
        let hasher = itehaas_lib::hash::new_hasher(algo).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let hash = itehaas_lib::object::store::write_object(repo, &itehaas_lib::object::Object::Tag(tag_obj), hasher.as_ref()).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        // Write tag ref pointing to tag object? In Git annotated tag ref points to tag object. For simplicity, point to commit for lightweight-like but also store tag object.
        // We'll write ref to tag object hash for annotated
        itehaas_lib::refs::write_ref(repo, &ref_name, &hash).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!("Created annotated tag '{}' at {}", tag_name, &hash.hex()[..7]);
    } else {
        // lightweight tag points to commit
        itehaas_lib::refs::write_ref(repo, &ref_name, &head).map_err(|e| anyhow::anyhow!(e.to_string()))?;
        println!("Created tag '{}' at {}", tag_name, &head.hex()[..7]);
    }
    Ok(())
}

fn validate_tag_name(name: &str) -> Result<()> {
    if name.is_empty() { anyhow::bail!("tag name cannot be empty"); }
    if name == "HEAD" { anyhow::bail!("tag name cannot be HEAD"); }
    if name.starts_with('/') || name.ends_with('/') || name.contains("//") { anyhow::bail!("invalid tag name: {}", name); }
    if name.contains(' ') || name.contains("..") || name.contains('~') || name.contains('^') || name.contains(':') || name.contains('?') || name.contains('*') || name.contains('[') || name.contains('\\') { anyhow::bail!("invalid tag name: {}", name); }
    if name.ends_with(".lock") || name.contains("@{") { anyhow::bail!("invalid tag name: {}", name); }
    for part in name.split('/') {
        if part.is_empty() || part.starts_with('.') { anyhow::bail!("invalid tag name: {}", name); }
    }
    Ok(())
}

fn cmd_reflog(repo: &Path, ref_name: &str) -> Result<()> {
    let entries = itehaas_lib::reflog::read_reflog(repo, ref_name).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if entries.is_empty() {
        println!("No reflog for {}", ref_name);
        return Ok(());
    }
    for (i, e) in entries.iter().rev().enumerate() {
        // Show newest last? git shows newest first with HEAD@{0} newest. We'll reverse to newest first
        // Actually entries are oldest first; we need index from top: size -1 - rev_idx
        let idx = entries.len() - 1 - i;
        let short_old = &e.old_hash[..7.min(e.old_hash.len())];
        let short_new = &e.new_hash[..7.min(e.new_hash.len())];
        println!("{} {} {{{}}}: {} : {} <{}> {} {}", short_new, ref_name, idx, e.message, e.name, e.email, e.timestamp, e.tz);
        let _ = short_old;
    }
    Ok(())
}

