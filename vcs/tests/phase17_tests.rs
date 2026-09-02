use std::fs;

#[test]
fn test_ci_workflow_migration_exists() {
    let content = fs::read_to_string("../database/migrations/009_ci_workflow.sql").unwrap();
    assert!(content.contains("ci_artifacts"), "ci_artifacts table missing");
    assert!(content.contains("workflow_file"), "workflow_file column missing");
    assert!(content.contains("workflow_json"), "workflow_json column missing");
    assert!(content.contains("ci_status_checks"), "ci_status_checks table missing");
    assert!(content.contains("duration_ms"), "duration_ms missing");
    assert!(content.contains("runner"), "runner column missing");
    assert!(content.contains("exit_code"), "exit_code missing");
}

#[test]
fn test_ci_yaml_parser_exists() {
    let ci = fs::read_to_string("../server/src/routes/ci.ts").unwrap();
    assert!(ci.contains("yaml") || ci.contains("yaml.parse"), "yaml parsing missing");
    assert!(ci.contains("parseWorkflow"), "parseWorkflow missing");
    assert!(ci.contains(".itehaas/workflows") || ci.contains(".github/workflows"), "workflow file discovery missing");
    assert!(ci.contains("jobs") && ci.contains("steps"), "jobs/steps parsing missing");
    assert!(ci.contains("workflow_file") && ci.contains("workflow_json"), "workflow storage missing");
}

#[test]
fn test_ci_docker_runner_exists() {
    let ci = fs::read_to_string("../server/src/routes/ci.ts").unwrap();
    assert!(ci.contains("isDockerAvailable") || ci.contains("docker"), "docker check missing");
    assert!(ci.contains("--network none") || ci.contains("--network"), "docker network none missing");
    assert!(ci.contains("--memory 512m") || ci.contains("--memory"), "docker memory limit missing");
    assert!(ci.contains("--pids-limit 128") || ci.contains("pids-limit"), "docker pids limit missing");
    assert!(ci.contains("executeInRunner") || ci.contains("runPipeline"), "runner execution missing");
    assert!(ci.contains("Secrets injected") || ci.contains("ci_secrets"), "secrets injection missing");
}

#[test]
fn test_ci_artifacts_and_logs() {
    let ci = fs::read_to_string("../server/src/routes/ci.ts").unwrap();
    assert!(ci.contains("ci_artifacts"), "artifacts table usage missing");
    assert!(ci.contains("collectArtifacts") || ci.contains("artifacts"), "collectArtifacts missing");
    assert!(ci.contains("/artifacts"), "artifacts endpoint missing");
    assert!(ci.contains("logs") && ci.contains("exit_code"), "logs/exit_code handling missing");
    assert!(ci.contains("duration_ms"), "duration tracking missing");
}

#[test]
fn test_ci_status_checks_and_gating() {
    let ci = fs::read_to_string("../server/src/routes/ci.ts").unwrap();
    assert!(ci.contains("ci_status_checks"), "status_checks table missing");
    assert!(ci.contains("/status_checks"), "status_checks endpoint missing");
    assert!(ci.contains("/pr/") && ci.contains("checks"), "PR gating endpoint missing");
    let pulls = fs::read_to_string("../server/src/routes/pulls.ts").unwrap();
    assert!(pulls.contains("ci_status_checks") || pulls.contains("CI checks required"), "PR gating in pulls missing");
    assert!(pulls.contains("pipeline not successful") || pulls.contains("required"), "PR block on CI missing");
}

#[test]
fn test_web_ci_workflow_ui() {
    let page = fs::read_to_string("../web/app/[owner]/[repo]/ci/page.tsx").unwrap();
    assert!(page.contains("Workflow") || page.contains("workflow"), "Workflow UI missing");
    assert!(page.contains("Artifacts") || page.contains("artifacts"), "Artifacts UI missing");
    assert!(page.contains("Status checks") || page.contains("status"), "Status checks UI missing");
    assert!(page.contains("docker") || page.contains("Docker"), "docker runner UI missing");
    assert!(page.contains("getWorkflows") || page.contains("getArtifacts") || page.contains("Api."), "API workflow/artifacts missing");
}

#[test]
fn test_ci_package_yaml() {
    let pkg = fs::read_to_string("../server/package.json").unwrap();
    assert!(pkg.contains("yaml"), "yaml dependency missing");
}

#[test]
fn test_ci_workflow_file_discovery() {
    // Ensure default workflow fallback exists
    let ci = fs::read_to_string("../server/src/routes/ci.ts").unwrap();
    assert!(ci.contains("install") && ci.contains("test") && ci.contains("build"), "default jobs fallback missing");
    assert!(ci.contains("itehaas log") || ci.contains("echo"), "default script missing");
}
