use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use itehaas_lib::config;
use itehaas_lib::hash::{Hash, HashAlgo};
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
}

fn find_repo_or_cwd() -> Result<PathBuf> {
    let cwd = std::env::current_dir()?;
    if let Some(repo) = itehaas_lib::find_repo(&cwd) {
        Ok(repo)
    } else {
        // Try cwd itself if it contains .itehaas
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
    }
    Ok(())
}
