use std::fs;
use std::path::{Path, PathBuf};

/// Represents a single ignore rule derived from .itehaasignore/.gitignore line
#[derive(Debug, Clone)]
struct Rule {
    pattern: String,
    negated: bool,
    dir_only: bool,
    // anchored: true if pattern contains '/' or starts with '/'
    has_slash: bool,
}

fn parse_line(line: &str) -> Option<Rule> {
    let mut s = line.trim();
    if s.is_empty() || s.starts_with('#') {
        return None;
    }
    // Handle escaped # and ! => not needed for minimal
    let mut negated = false;
    if s.starts_with('!') {
        negated = true;
        s = s[1..].trim();
        if s.is_empty() {
            return None;
        }
    }
    // Remove leading '/' (anchored to repo root) but keep has_slash true
    let mut has_slash = s.contains('/');
    if s.starts_with('/') {
        s = &s[1..];
        has_slash = true;
    }
    let mut dir_only = false;
    if s.ends_with('/') {
        dir_only = true;
        s = s.trim_end_matches('/');
        if s.is_empty() {
            return None;
        }
        has_slash = true; // directory patterns are effectively with slash
    }
    // Unescape later? Keep simple
    Some(Rule {
        pattern: s.to_string(),
        negated,
        dir_only,
        has_slash,
    })
}

/// Wildcard match with support for *, ?, **
/// pattern may contain * ? and ** tokens
/// text is a path with '/' separators, no leading slash
fn glob_match(pattern: &str, text: &str) -> bool {
    // Convert to chars vec for easier indexing
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = text.chars().collect();
    fn helper(p: &[char], s: &[char], pi: usize, si: usize) -> bool {
        let mut pi = pi;
        let mut si = si;
        while pi < p.len() {
            // Check for **
            if pi + 1 < p.len() && p[pi] == '*' && p[pi + 1] == '*' {
                // Check if ** followed by '/'
                let after = if pi + 2 < p.len() && p[pi + 2] == '/' {
                    pi + 3 // skip **/
                } else {
                    pi + 2
                };
                // ** matches empty
                if helper(p, s, after, si) {
                    return true;
                }
                // Consume one char (including /) and stay at **
                if si < s.len() && helper(p, s, pi, si + 1) {
                    return true;
                }
                // If **/ case, also try consuming up to next slash?
                // Already covered via recursion consuming any char
                return false;
            } else if p[pi] == '*' {
                // single * matches any chars except '/'
                // Try matching zero chars
                if helper(p, s, pi + 1, si) {
                    return true;
                }
                // consume one non-/ char
                if si < s.len() && s[si] != '/' && helper(p, s, pi, si + 1) {
                    return true;
                }
                return false;
            } else if p[pi] == '?' {
                if si >= s.len() || s[si] == '/' {
                    return false;
                }
                pi += 1;
                si += 1;
            } else {
                if si >= s.len() || p[pi] != s[si] {
                    return false;
                }
                pi += 1;
                si += 1;
            }
        }
        si == s.len()
    }
    helper(&p, &s, 0, 0)
}

fn rule_matches(rule: &Rule, path: &str, is_dir: bool) -> bool {
    // Directory-only patterns match the dir itself and any file under it
    if rule.dir_only {
        if path == rule.pattern {
            return true;
        }
        if path.starts_with(&format!("{}/", rule.pattern)) {
            return true;
        }
        // Also support glob in dir pattern like "build*/" ???
        let prefix_pat = format!("{}/**", rule.pattern);
        if glob_match(&prefix_pat, path) {
            return true;
        }
        if glob_match(&rule.pattern, path) {
            return true;
        }
        // If is_dir false but pattern is dir-only, we still want to match files under
        // Continue to has_slash check for generic
        if !is_dir {
            // For files, if dir pattern didn't match, not matched
            // But we still allow fallback to has_slash matching
        }
    }
    if rule.has_slash {
        // Match against full path
        if glob_match(&rule.pattern, path) {
            return true;
        }
        // For dir-only, we already handled prefix above, so no match
        return false;
    } else {
        // Pattern without slash matches against basename or any component
        let basename = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path);
        if glob_match(&rule.pattern, basename) {
            return true;
        }
        let pat_with_prefix = format!("**/{}", rule.pattern);
        if glob_match(&pat_with_prefix, path) {
            return true;
        }
        if glob_match(&rule.pattern, path) {
            return true;
        }
        false
    }
}

/// Load rules from a single ignore file path, return Vec<Rule> in order
fn load_rules(file: &Path) -> Vec<Rule> {
    if !file.exists() {
        return vec![];
    }
    let content = match fs::read_to_string(file) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut out = Vec::new();
    for line in content.lines() {
        // Trim trailing whitespace, keep leading? Already trimmed in parse
        if let Some(rule) = parse_line(line) {
            out.push(rule);
        }
    }
    out
}

/// Collect all ignore rules applicable to `rel_path` from repo root down to its parent dir.
/// Order: root .itehaasignore, root .gitignore, then each subdir's files in descending path order.
/// Later rules override earlier (last match wins).
fn collect_rules(repo: &Path, rel_path: &Path) -> Vec<Rule> {
    let mut rules = Vec::new();
    // Get dir components for rel_path
    let rel_dir = rel_path.parent().unwrap_or_else(|| Path::new(""));
    // Build list of directories from root to file's dir inclusive
    let mut dirs: Vec<PathBuf> = Vec::new();
    dirs.push(PathBuf::new()); // root
    let mut cur = PathBuf::new();
    for comp in rel_dir.components() {
        cur.push(comp.as_os_str());
        dirs.push(cur.clone());
    }
    for d in dirs {
        let base = repo.join(&d);
        // precedence: .itehaasignore first, then .gitignore (gitignore overrides? we do in order)
        for fname in [".itehaasignore", ".gitignore"] {
            let p = base.join(fname);
            let mut r = load_rules(&p);
            rules.append(&mut r);
        }
    }
    rules
}

/// Public API: check if a repo-relative path should be ignored.
/// `rel` is Path relative to repo root (no prefix), `is_dir` indicates if path is dir.
/// Always ignores .itehaas and .git paths regardless of rules.
pub fn is_ignored(repo: &Path, rel: &Path, is_dir: bool) -> bool {
    // Always ignore .itehaas and .git
    if rel.components().any(|c| c.as_os_str() == ".itehaas" || c.as_os_str() == ".git") {
        return true;
    }
    let rel_str = crate::index::path_to_string(rel);
    if rel_str.is_empty() {
        return false;
    }
    let rules = collect_rules(repo, rel);
    let mut ignored = false;
    for rule in rules {
        if rule_matches(&rule, &rel_str, is_dir) {
            if rule.negated {
                ignored = false;
            } else {
                ignored = true;
            }
        }
    }
    ignored
}

/// Helper for WalkDir filter: check path (absolute) inside repo
pub fn should_ignore(repo: &Path, abs_path: &Path) -> bool {
    let rel = match abs_path.strip_prefix(repo) {
        Ok(r) => r,
        Err(_) => return false,
    };
    if rel.as_os_str().is_empty() {
        return false;
    }
    let is_dir = abs_path.is_dir();
    is_ignored(repo, rel, is_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn glob_simple() {
        assert!(glob_match("*.log", "a.log"));
        assert!(!glob_match("*.log", "a/b.log")); // * doesn't cross /
        assert!(glob_match("**/*.log", "a/b.log"));
        assert!(glob_match("**", "a/b/c"));
        assert!(glob_match("foo", "foo"));
        assert!(!glob_match("foo", "bar"));
        assert!(glob_match("foo/**/bar", "foo/bar"));
        assert!(glob_match("foo/**/bar", "foo/x/y/bar"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "ac"));
    }
    #[test]
    fn rule_simple() {
        let r = parse_line("*.log").unwrap();
        assert!(rule_matches(&r, "foo.log", false));
        assert!(rule_matches(&r, "a/b.log", false));
        // has_slash false so basename
    }
}
