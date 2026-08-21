import { invoke } from "@tauri-apps/api/core";

export interface ClickUpTask {
  id: string;
  name: string;
  status: string;
  status_color: string;
  url: string;
  date_created: string;
  date_updated: string;
  list: string;
  tags: string[];
}

// P0: config passed from the frontend. P2 onboarding will persist this
// (OS keychain for the token) and load it here instead of env reads.
export interface ClickUpConfig {
  token: string;
  team_id: string;
  owner_field_id: string;
  owner_value: number;
}

export function loadConfig(): ClickUpConfig | null {
  const raw = localStorage.getItem("aierbaer.clickup");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClickUpConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: ClickUpConfig) {
  localStorage.setItem("aierbaer.clickup", JSON.stringify(cfg));
}

export function fetchTasks(cfg: ClickUpConfig): Promise<ClickUpTask[]> {
  return invoke("fetch_tasks", { cfg });
}

export function solveTask(
  token: string,
  taskId: string,
  model?: string,
  repo?: string,
  reportsDir?: string,
): Promise<string> {
  return invoke("solve_task", { token, taskId, model, repo, reportsDir });
}

/** Newest report markdown for a task, or null if none yet. */
export function readReportFor(taskId: string, reportsDir?: string): Promise<string | null> {
  return invoke("read_report_for", { taskId, reportsDir });
}

/** Task ids that already have a report on disk. */
export function listReportIds(reportsDir?: string): Promise<string[]> {
  return invoke("list_report_ids", { reportsDir });
}

export interface ReportMeta {
  id: string;
  resolved: boolean;
  choice: string | null;
}

/** Per-task report metadata (resolved + chosen option) for the inbox. */
export function listReportsMeta(reportsDir?: string): Promise<ReportMeta[]> {
  return invoke("list_reports_meta", { reportsDir });
}

/** Record the actual solution as a `## Resolution` section on the report. */
export function saveResolution(
  taskId: string,
  choice: string,
  text: string,
  reportsDir?: string,
): Promise<void> {
  return invoke("save_resolution", { taskId, choice, text, reportsDir });
}

/** Remove the `## Resolution` section from a task's report. */
export function deleteResolution(taskId: string, reportsDir?: string): Promise<void> {
  return invoke("delete_resolution", { taskId, reportsDir });
}

export function loadReportsDir(): string {
  return localStorage.getItem("aierbaer.reportsDir") || "";
}

export function saveReportsDir(path: string) {
  localStorage.setItem("aierbaer.reportsDir", path);
}

export function loadHideResolved(): boolean {
  return localStorage.getItem("aierbaer.hideResolved") === "1";
}

export function saveHideResolved(v: boolean) {
  localStorage.setItem("aierbaer.hideResolved", v ? "1" : "0");
}

export interface RuntimeConfig {
  token: string;
  team_id: string;
  owner_field_id: string;
  owner_value: number;
  model: string;
  repo: string | null;
  reports_dir: string | null;
}

/** Push the current config into the Rust HTTP API so external dashboards work. */
export function setRuntimeConfig(config: RuntimeConfig): Promise<void> {
  return invoke("set_runtime_config", { config });
}

export interface ApiSettings {
  port: number;
  token: string;
}

export function getApiSettings(): Promise<ApiSettings> {
  return invoke("get_api_settings");
}

export function setApiPort(port: number): Promise<ApiSettings> {
  return invoke("set_api_port", { port });
}

export function regenerateApiToken(): Promise<ApiSettings> {
  return invoke("regenerate_api_token");
}

/** Ping the local API health endpoint (no token required). */
export async function apiHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Build a RuntimeConfig from local storage + clickup config. */
export function currentRuntimeConfig(): RuntimeConfig | null {
  const cfg = loadConfig();
  if (!cfg) return null;
  return {
    token: cfg.token,
    team_id: cfg.team_id,
    owner_field_id: cfg.owner_field_id,
    owner_value: cfg.owner_value,
    model: loadModel(),
    repo: loadRepo() || null,
    reports_dir: loadReportsDir() || null,
  };
}

export function readReport(path: string): Promise<string> {
  return invoke("read_report", { path });
}

export interface PiStatus {
  installed: boolean;
  version: string | null;
}

export interface SkillStatus {
  installed: boolean;
  version: string | null;
  bundled: string | null;
  up_to_date: boolean;
  path: string;
}

export interface CopilotStatus {
  ready: boolean;
  auth_type: string | null;
}

export interface Team {
  id: string;
  name: string;
}

export interface OwnerOption {
  name: string;
  value: number;
}

// Team-wide defaults (Eversports "Owner" custom field). Baked in so onboarding
// only asks for the token + team. Override later in Settings if needed.
export const DEFAULT_OWNER_FIELD_ID = "f2d4bd7b-f57e-4f56-a091-32cfc049d1ce";
export const DEFAULT_OWNER_VALUE = 5;
export const DEFAULT_TEAM_ID = "2539569";

/** ClickUp API-settings page where the personal token lives. */
export function clickupTokenUrl(teamId?: string): string {
  const id = teamId || DEFAULT_TEAM_ID;
  return `https://app.clickup.com/${id}/settings/team/${id}/clickup-api`;
}

export function checkPi(): Promise<PiStatus> {
  return invoke("check_pi");
}

export function checkSkill(): Promise<SkillStatus> {
  return invoke("check_skill");
}

export function checkCopilot(): Promise<CopilotStatus> {
  return invoke("check_copilot");
}

/** Runs the full Copilot device-code flow in the background; resolves when ready.
 *  Listen for the `copilot-device` event to show the user code + URL. */
export function copilotLogin(): Promise<void> {
  return invoke("copilot_login");
}

/** Bare Copilot model ids allowed for this account, e.g. "claude-opus-4.8". */
export function copilotModels(): Promise<string[]> {
  return invoke("copilot_models");
}

/** Smoke-test pi with a trivial prompt; resolves with pi's stdout. */
export function testPi(model: string): Promise<string> {
  return invoke("test_pi", { model });
}

export const DEFAULT_MODEL = "github-copilot/claude-opus-4.8";

export function loadModel(): string {
  return localStorage.getItem("aierbaer.model") || DEFAULT_MODEL;
}

export function saveModel(model: string) {
  localStorage.setItem("aierbaer.model", model);
}

export function loadRepo(): string {
  return localStorage.getItem("aierbaer.repo") || "";
}

export function saveRepo(path: string) {
  localStorage.setItem("aierbaer.repo", path);
}

/** Pick a sensible default from bare ids: newest Opus, else first. Returns a
 *  full pi id (github-copilot/<id>). */
export function pickDefaultModel(ids: string[]): string {
  if (ids.includes("claude-opus-4.8")) return "github-copilot/claude-opus-4.8";
  const opus = ids.filter((i) => /opus/i.test(i)).sort().reverse()[0];
  const chosen = opus || ids[0];
  return chosen ? `github-copilot/${chosen}` : DEFAULT_MODEL;
}

export function openTerminal(command: string): Promise<void> {
  return invoke("open_terminal", { command });
}

export function installPi(): Promise<void> {
  return invoke("install_pi");
}

export function installSkill(): Promise<void> {
  return invoke("install_skill");
}

export function fetchTeams(token: string): Promise<Team[]> {
  return invoke("fetch_teams", { token });
}

/** Selectable values of the ClickUp "Owner" custom field (name + orderindex). */
export function fetchOwnerOptions(
  token: string,
  teamId: string,
  fieldId: string,
): Promise<OwnerOption[]> {
  return invoke("fetch_owner_options", { token, teamId, fieldId });
}

export function onboardingDone(): boolean {
  return localStorage.getItem("aierbaer.onboarded") === "1";
}

export function markOnboarded() {
  localStorage.setItem("aierbaer.onboarded", "1");
}

export type Theme = "dark" | "light";

export function loadTheme(): Theme {
  return localStorage.getItem("aierbaer.theme") === "light" ? "light" : "dark";
}

/** Apply the theme to <html> and persist it. */
export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("aierbaer.theme", t);
}
