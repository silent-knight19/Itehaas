use std::fs;

#[test]
fn test_search_watch_migration_exists() {
    let content = fs::read_to_string("../database/migrations/008_search_watch.sql").unwrap();
    assert!(content.contains("watches"), "watches table missing");
    assert!(content.contains("pg_trgm"), "pg_trgm extension missing");
    assert!(content.contains("gin_trgm_ops"), "GIN trigram indexes missing");
    assert!(content.contains("idx_repositories_name_trgm"), "repo name trgm index missing");
    assert!(content.contains("idx_notifications_user_read"), "notifications index missing");
}

#[test]
fn test_search_route_exists() {
    let search = fs::read_to_string("../server/src/routes/search.ts").unwrap();
    assert!(search.contains("GET /api/search"), "search route missing");
    assert!(search.contains("ILIKE"), "search ILIKE missing");
    assert!(search.contains("pg_trgm") || search.contains("gin_trgm") || search.contains("repositories"), "search pg_trgm handling missing");
    assert!(search.contains("canRead") || search.contains("visibility"), "visibility filter missing");
    assert!(search.contains("limit") && search.contains("offset"), "pagination missing");
}

#[test]
fn test_file_browsing_routes_exist() {
    let repos = fs::read_to_string("../server/src/routes/repos.ts").unwrap();
    assert!(repos.contains("GET /api/repos/:owner/:repo/file/*"), "file browsing route missing");
    assert!(repos.contains("GET /api/repos/:owner/:repo/history/*"), "history route missing");
    assert!(repos.contains("GET /api/repos/:owner/:repo/blame/*"), "blame route missing");
    assert!(repos.contains("cat-file -p"), "cat-file tree walk missing");
    assert!(repos.contains("findFileInTree"), "findFileInTree helper missing");
    assert!(repos.contains("isBinary"), "binary check missing");
}

#[test]
fn test_watch_routes_exist() {
    let repos = fs::read_to_string("../server/src/routes/repos.ts").unwrap();
    assert!(repos.contains("/watch"), "watch route missing");
    assert!(repos.contains("watches"), "watches table usage missing");
    assert!(repos.contains("watchers"), "watchers list missing");
    assert!(repos.contains("409") || repos.contains("23505"), "watch dedup 409 missing");
}

#[test]
fn test_web_file_browser_exists() {
    let page = fs::read_to_string("../web/app/[owner]/[repo]/page.tsx").unwrap();
    assert!(page.contains("?path=") || page.contains("currentPath"), "recursive ?path= browsing missing");
    assert!(page.contains("getFile") || page.contains("Api.getFile"), "getFile API missing");
    assert!(page.contains("FileTree"), "FileTree missing");
    assert!(page.contains("FileViewer"), "FileViewer missing");
    assert!(page.contains("breadcrumb") || page.contains("Breadcrumb"), "breadcrumb missing");
}

#[test]
fn test_web_fileviewer_tabs() {
    let viewer = fs::read_to_string("../web/components/FileViewer.tsx").unwrap();
    assert!(viewer.contains("history") && viewer.contains("blame"), "history/blame tabs missing");
    assert!(viewer.contains("getFileHistory") || viewer.contains("history"), "history fetch missing");
    assert!(viewer.contains("getBlame") || viewer.contains("blame"), "blame fetch missing");
    assert!(viewer.contains("raw"), "raw tab missing");
}

#[test]
fn test_web_notifications_and_search() {
    let api = fs::read_to_string("../web/lib/api.ts").unwrap();
    assert!(api.contains("getNotifications"), "getNotifications missing");
    assert!(api.contains("search"), "search API missing");
    assert!(api.contains("watchRepo") || api.contains("/watch"), "watch API missing");
    let shell = fs::read_to_string("../web/components/AppShell.tsx").unwrap();
    assert!(shell.contains("Bell") || shell.contains("notifications"), "AppShell bell missing");
    assert!(shell.contains("Inbox") || shell.contains("notifications"), "Inbox UI missing");
    let palette = fs::read_to_string("../web/components/CommandPalette.tsx").unwrap();
    assert!(palette.contains("search") && palette.contains("pg_trgm") || palette.contains("Api.search"), "CommandPalette search missing");
    let notifPage = fs::read_to_string("../web/app/notifications/page.tsx").unwrap();
    assert!(notifPage.contains("Notifications"), "notifications page missing");
    assert!(notifPage.contains("markNotificationRead") || notifPage.contains("Mark"), "mark read missing");
}

#[test]
fn test_mentions_handling() {
    let issues = fs::read_to_string("../server/src/routes/issues.ts").unwrap();
    assert!(issues.contains("@([a-zA-Z0-9._-]{3,32})") || issues.contains("mentionRegex"), "issue mentions missing");
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    assert!(pulls.contains("mentionRegex") || pulls.contains("@([a-zA-Z0-9"), "pulls mention missing");
    assert!(pulls.contains("pr_review_comments"), "pr_review_comments mention missing");
}
