import { test, expect, type Page } from "@playwright/test";

// Runs against a throwaway database with no API key (offline scaffold engine), exercising the real UI.
test.describe.configure({ mode: "serial" });

async function waitRun(page: Page) {
  const run = page.getByTestId("run-progress").last();
  await expect(run.getByText(/succeeded|awaiting approval|failed/).first()).toBeVisible({ timeout: 30_000 });
  return run;
}

test("onboarding creates a brand and the command center uses its data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Throughline" })).toBeVisible();
  await page.getByLabel("Brand / creator name *").fill("E2E Studio");
  await page.getByLabel("Niche").fill("budget travel for students");
  await page.getByLabel("Main objective").fill("Grow email list");
  await page.getByLabel("Topics of expertise").fill("cheap flights\nhostels\nrail passes");
  await page.getByRole("button", { name: "2. Audience" }).click();
  await page.getByRole("button", { name: "+ Add audience segment" }).click();
  await page.getByLabel("Name", { exact: true }).fill("First-time backpackers");
  await page.getByLabel("Problems (their words)").fill("flights are too expensive\ndon't know where to start");
  await page.getByRole("button", { name: "3. Platforms & capacity" }).click();
  await page.getByLabel("YouTube Shorts").check();
  await page.getByLabel("Pieces per week you can sustain").fill("3");
  await page.getByRole("button", { name: "Create now" }).click();
  await expect(page.getByRole("heading", { name: "E2E Studio" })).toBeVisible();
  await expect(page.getByText("Goal: Grow email list")).toBeVisible();
  await expect(page.getByText(/offline scaffolds/i)).toBeVisible();
});

test("strategy → ideas → brief → drafts → QA → edit → approve, all through the UI", async ({ page }) => {
  await page.goto("/strategy");
  await page.getByRole("button", { name: "Build strategy" }).click();
  const run = await waitRun(page);
  await expect(run.getByTestId("approval-gate")).toBeVisible();
  await run.getByRole("button", { name: "Approve & apply" }).click();
  await expect(page.getByText("Approved and applied")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active pillars (topic map)" })).toBeVisible();
  await expect(page.getByText("Cheap flights").first()).toBeVisible();

  await page.goto("/ideas");
  await page.getByRole("button", { name: "Generate ideas" }).click();
  await waitRun(page);
  const firstIdea = page.locator("tr.clickable").first();
  await expect(firstIdea).toBeVisible();
  await firstIdea.click();
  await expect(page.getByText(/not a prediction/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Promote to brief (agent)" }).click();
  await page.waitForURL(/\/briefs\/brief_/, { timeout: 30_000 });

  await page.getByRole("button", { name: /Draft for 1 platform/ }).click();
  await page.waitForURL(/\/studio\/ci_/, { timeout: 30_000 });
  await expect(page.getByText(/hard blocker\(s\) — approval is disabled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve current variant" })).toBeDisabled();

  // Human edit: replace the scaffold with finished copy (new variant), then QA and approve.
  await page.getByRole("button", { name: "All fields" }).click();
  await page.getByLabel("Opening hooks").fill("Cheap flights hide in the shoulder season.");
  await page.getByLabel("Script / body").fill("Cheap flights hide in the shoulder season.\nHere's the rule I use for every trip:\n1. Search the two weeks either side of peak.\n2. Book mid-week departures.\n3. Set one fare alert, not ten.\nThat's how I flew to Lisbon for the price of a train ticket.");
  await page.getByLabel("Call to action").fill("Get my fare-alert checklist by email");
  await page.getByLabel("Claims to verify (clear each once checked)").fill("");
  await page.getByLabel("Production / edit notes").fill("Film at the airport.");
  // Replace every remaining scaffold marker, as a creator would before approval.
  for (const field of await page.locator("textarea, input").all()) {
    if ((await field.inputValue().catch(() => "")).includes("[insert:")) await field.fill("Mid-week departures beat weekend ones on price.");
  }
  await page.getByRole("button", { name: "Save as new variant" }).click();
  await expect(page.getByText(/Saved as a new variant/)).toBeVisible();
  await page.getByRole("button", { name: /Run QA on v\d/ }).click();
  await expect(page.getByText(/No hard blockers/)).toBeVisible();
  await page.getByRole("button", { name: "Approve current variant" }).click();
  await expect(page.getByText(/Current variant approved/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare hand-off package" }).click();
  await expect(page.locator("pre").filter({ hasText: "Cheap flights hide in the shoulder season." })).toBeVisible();
});

test("analytics CSV import maps headers and compares with own baseline", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByRole("tab", { name: "Import data" }).click();
  await page.getByLabel("…or paste CSV").fill("Video title,Views,Video publish time\nA,100,2026-10-01\nB,300,2026-10-02\nC,90,2026-10-03\nD,110,2026-10-04\nE,bad,2026-10-05\n");
  await page.getByRole("button", { name: "Preview & map columns" }).click();
  await expect(page.getByLabel("Mapping for Views")).toHaveValue("views");
  await page.getByRole("button", { name: /Import \d row/ }).click();
  await expect(page.getByText(/Imported with warnings/)).toBeVisible();
  await page.getByRole("button", { name: "View results" }).click();
  await expect(page.getByText("Posts vs own baseline")).toBeVisible();
  await expect(page.getByText("outperformed")).toBeVisible();
});

test("settings shows honest integration statuses and the publishing kill switch is off", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Claude (Anthropic API)" })).toBeVisible();
  await expect(page.getByText("needs credentials").first()).toBeVisible();
  await expect(page.getByText("needs provider approval").first()).toBeVisible();
  await page.getByRole("tab", { name: "Publishing safety" }).click();
  await expect(page.getByText(/Publishing is OFF/)).toBeVisible();
  const csv = await page.request.get("/api/analytics/template.csv");
  expect(await csv.text()).toContain("post_id,platform,title");
});
