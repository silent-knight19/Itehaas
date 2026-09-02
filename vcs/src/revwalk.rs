use std::collections::{BTreeMap, HashSet, VecDeque};
use std::path::Path;

use crate::error::{ItehaasError, Result};
use crate::hash::{Hash, Hasher};
use crate::object::Object;
use crate::tree_builder;

#[derive(Debug, Clone, Default)]
pub struct LogOptions {
    pub oneline: bool,
    pub max_count: Option<usize>,
    pub all: bool,
    pub graph: bool,
    pub patch: bool,
    pub stat: bool,
    pub name_only: bool,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub author: Option<String>,
    pub grep: Option<String>,
    pub follow: Option<String>,
    pub paths: Vec<String>,
}

pub struct LogEntry {
    pub hash: Hash,
    pub commit: crate::object::Commit,
}

/// Parse date string to timestamp: supports YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, or integer seconds
pub fn parse_date(s: &str) -> Option<i64> {
    // Try integer
    if let Ok(ts) = s.parse::<i64>() {
        return Some(ts);
    }
    // Try YYYY-MM-DD via chrono
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Some(dt.and_utc().timestamp());
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp());
    }
    None
}

fn commit_matches_filter(entry: &LogEntry, opts: &LogOptions) -> bool {
    if let Some(since) = opts.since {
        if entry.commit.author.timestamp < since {
            return false;
        }
    }
    if let Some(until) = opts.until {
        if entry.commit.author.timestamp > until {
            return false;
        }
    }
    if let Some(author) = &opts.author {
        let a = author.to_lowercase();
        let name = entry.commit.author.name.to_lowercase();
        let email = entry.commit.author.email.to_lowercase();
        if !name.contains(&a) && !email.contains(&a) {
            return false;
        }
    }
    if let Some(grep) = &opts.grep {
        if !entry.commit.message.to_lowercase().contains(&grep.to_lowercase()) {
            return false;
        }
    }
    true
}

fn commit_touches_paths(
    repo: &Path,
    hasher: &dyn Hasher,
    commit: &crate::object::Commit,
    parent: Option<&crate::object::Commit>,
    paths: &[String],
) -> Result<bool> {
    if paths.is_empty() {
        return Ok(true);
    }
    // For each path, check if diff between parent and commit touches it
    let cur_map = tree_builder::flatten_tree_root(repo, &commit.tree, hasher)?;
    let parent_map: BTreeMap<String, (Hash, u32)> = if let Some(p) = parent {
        tree_builder::flatten_tree_root(repo, &p.tree, hasher)?
    } else {
        BTreeMap::new()
    };
    let diffs = crate::diff::diff_maps(&parent_map, &cur_map);
    for d in diffs {
        for pat in paths {
            // Support simple prefix match and glob?
            if d.path == *pat || d.path.starts_with(&format!("{}/", pat)) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Walk log according to options, returns entries sorted by timestamp descending (like git log date-order)
pub fn walk_log(repo: &Path, opts: &LogOptions) -> Result<Vec<LogEntry>> {
    let algo = crate::config::read_hasher(repo)?;
    let hasher = crate::hash::new_hasher(algo)?;
    // Collect starting points
    let mut starts: Vec<Hash> = Vec::new();
    if opts.all {
        // All refs/heads + tags + HEAD
        for b in crate::refs::list_branches(repo).unwrap_or_default() {
            if let Ok(Some(h)) = crate::refs::read_ref(repo, &format!("refs/heads/{}", b)) {
                starts.push(h);
            }
        }
        // tags
        let tags_dir = repo.join(".itehaas").join("refs").join("tags");
        if tags_dir.exists() {
            for entry in walkdir::WalkDir::new(&tags_dir).min_depth(1) {
                if let Ok(e) = entry {
                    if e.path().is_file() {
                        if let Ok(content) = std::fs::read_to_string(e.path()) {
                            if let Ok(h) = crate::hash::Hash::from_hex(algo, content.trim()) {
                                // tags may point to tag object or commit; if tag object, resolve to commit?
                                // For now push tag hash directly; revwalk will handle if not commit (skip)
                                starts.push(h);
                            }
                        }
                    }
                }
            }
        }
        if let Ok(Some(h)) = crate::refs::resolve_head(repo) {
            if !starts.iter().any(|x| x.hex() == h.hex()) {
                starts.push(h);
            }
        }
    } else {
        if let Some(h) = crate::refs::resolve_head(repo)? {
            starts.push(h);
        } else {
            return Ok(vec![]);
        }
    }
    if starts.is_empty() {
        return Ok(vec![]);
    }

    // BFS/DFS walk: we need to traverse parents, visited set, collect commits
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<Hash> = VecDeque::new();
    for h in starts {
        queue.push_back(h);
    }
    let mut all_entries: Vec<LogEntry> = Vec::new();

    while let Some(cur) = queue.pop_front() {
        // S7: bound visited and queue to prevent DoS via huge history
        if visited.len() > 10000 || all_entries.len() > 10000 {
            break;
        }
        if visited.contains(&cur.hex()) {
            continue;
        }
        visited.insert(cur.hex());
        let obj = match crate::object::store::read_object(repo, &cur, hasher.as_ref()) {
            Ok(o) => o,
            Err(_) => continue,
        };
        let commit = match obj {
            Object::Commit(c) => c,
            Object::Tag(t) => {
                // Tag points to commit or other; try to resolve tag object to commit
                // For log --all, we should dereference tag to its object
                let target = &t.object;
                // push target to queue and continue (don't add tag itself to log)
                if !visited.contains(&target.hex()) {
                    queue.push_back(target.clone());
                }
                continue;
            }
            _ => continue,
        };
        // Check path filtering: need parent commit for diff; we can defer path filtering after collecting all, but we need parent for follow
        // For now, we add entry and later filter paths if needed
        // For follow, we need to track rename? Just filter after
        let entry = LogEntry {
            hash: cur.clone(),
            commit: commit.clone(),
        };
        // Apply filters that don't need parent (since, until, author, grep)
        if !commit_matches_filter(&entry, opts) {
            // still need to walk parents even if filtered out
        } else {
            // For paths filtering, defer to second pass where we check if commit touches paths
            // If paths non-empty, we will filter after collecting parent diff
            // Actually we can check now if commit touches paths (needs parent)
            // For first collect, we push entry if matches or if paths empty; else we will filter later
            // To avoid needing parent now, we just push and filter later
            all_entries.push(entry);
        }
        // Even if filtered, we still need to walk parents to find more commits that may match
        for p in commit.parents.iter() {
            if !visited.contains(&p.hex()) {
                queue.push_back(p.clone());
            }
        }
    }

    // For path filtering, we need to filter all_entries to only those that touch paths
    let mut filtered: Vec<LogEntry> = Vec::new();
    if !opts.paths.is_empty() || opts.follow.is_some() {
        let follow_path = opts.follow.clone();
        let paths = if let Some(f) = follow_path {
            vec![f]
        } else {
            opts.paths.clone()
        };
        for entry in &all_entries {
            // Need parent for diff; get first parent commit if exists
            let parent_commit: Option<crate::object::Commit> = if !entry.commit.parents.is_empty() {
                let ph = &entry.commit.parents[0];
                match crate::object::store::read_object(repo, ph, hasher.as_ref()) {
                    Ok(Object::Commit(c)) => Some(c),
                    _ => None,
                }
            } else {
                None
            };
            let touches = commit_touches_paths(
                repo,
                hasher.as_ref(),
                &entry.commit,
                parent_commit.as_ref(),
                &paths,
            )
            .unwrap_or(false);
            if touches {
                filtered.push(LogEntry {
                    hash: entry.hash.clone(),
                    commit: entry.commit.clone(),
                });
            }
        }
        all_entries = filtered;
    }

    // Sort by timestamp descending (git log default is reverse chronological). For --graph we need topological care, but sort suffices for educational.
    all_entries.sort_by(|a, b| b.commit.author.timestamp.cmp(&a.commit.author.timestamp));

    // Apply max_count after sorting and filtering
    if let Some(max) = opts.max_count {
        all_entries.truncate(max);
    }

    Ok(all_entries)
}

pub fn format_stat(
    repo: &Path,
    hasher: &dyn Hasher,
    commit: &crate::object::Commit,
    parent: Option<&crate::object::Commit>,
) -> Result<String> {
    let cur_map = tree_builder::flatten_tree_root(repo, &commit.tree, hasher)?;
    let parent_map: BTreeMap<String, (Hash, u32)> = if let Some(p) = parent {
        tree_builder::flatten_tree_root(repo, &p.tree, hasher)?
    } else {
        BTreeMap::new()
    };
    let diffs = crate::diff::diff_maps(&parent_map, &cur_map);
    if diffs.is_empty() {
        return Ok(String::new());
    }
    let mut out = String::new();
    for d in &diffs {
        let status = d.status_str();
        // For stat, count added/deleted lines via diff content
        let old = d.old_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher).ok());
        let new = d.new_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher).ok());
        let (additions, deletions) = if let (Some(o), Some(n)) = (old, new) {
            if crate::diff::is_binary(&o) || crate::diff::is_binary(&n) {
                (0, 0)
            } else {
                let o_str = String::from_utf8_lossy(&o);
                let n_str = String::from_utf8_lossy(&n);
                let diff = similar::TextDiff::from_lines(&o_str, &n_str);
                let mut a = 0;
                let mut d = 0;
                for op in diff.ops() {
                    for change in diff.iter_changes(op) {
                        match change.tag() {
                            similar::ChangeTag::Insert => a += 1,
                            similar::ChangeTag::Delete => d += 1,
                            _ => {}
                        }
                    }
                }
                (a, d)
            }
        } else if d.new_hash.is_some() {
            // Added file: count lines in new
            let content = d.new_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher).ok()).unwrap_or_default();
            (String::from_utf8_lossy(&content).lines().count(), 0)
        } else {
            let content = d.old_hash.as_ref().and_then(|h| crate::diff::get_blob_content(repo, h, hasher).ok()).unwrap_or_default();
            (0, String::from_utf8_lossy(&content).lines().count())
        };
        out.push_str(&format!(
            " {} | {} {} {}\n",
            d.path,
            if status == "added" { "new file" } else if status == "deleted" { "deleted" } else { status },
            if additions > 0 { format!("+{}", additions) } else { "".to_string() },
            if deletions > 0 { format!("-{}", deletions) } else { "".to_string() }
        ));
    }
    out.push_str(&format!(" {} files changed\n", diffs.len()));
    Ok(out)
}
