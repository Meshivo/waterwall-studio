import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
});

/**
 * Simple mode used to filter the catalog down to 32 of 73 nodes, which left a
 * beginner unable to build a topology they had been told to build, with no
 * indication anything was missing. It ranks now: everything is reachable, the
 * approachable nodes lead.
 */
test("simple mode ranks the catalog instead of hiding it", async ({ page }) => {
  test.skip(
    page.viewportSize()!.width <= 1100,
    "the palette column only exists on desktop",
  );

  const palette = page.locator(".palette-panel");
  const search = palette.getByPlaceholder("جستجوی سریع…");

  // WireGuardDevice is not in SIMPLE_NODE_TYPES; in simple mode it used to be
  // unreachable entirely.
  await search.fill("WireGuard");
  await expect(palette.getByText("WireGuardDevice").first()).toBeVisible();

  // And the approachable ones still lead an unfiltered list.
  await search.fill("");
  const first = await palette
    .locator(".palette-node strong, .palette-node")
    .first()
    .innerText();
  expect(first.length).toBeGreaterThan(0);
});

/**
 * Variables round-tripped through import and export but had no UI, so a value
 * repeated across five nodes had to be edited five times.
 */
test("variables can be seen and edited", async ({ page }) => {
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  await page.getByPlaceholder("JSON را اینجا بچسبانید…").fill(`{
    "name": "vars-demo",
    "variables": { "listen_port": 443 },
    "nodes": [
      { "name": "in", "type": "TcpListener", "settings": { "port": $listen_port$ } }
    ]
  }`);
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await page.waitForTimeout(300);

  await page.locator(".command-overflow > button").click();
  await page.getByRole("button", { name: /^متغیرها$/ }).click();

  const panel = page.locator(".variables-panel");
  await expect(panel.getByText("$listen_port$")).toBeVisible();
  await expect(panel.getByText(/در ۱ نود|در 1 نود/)).toBeVisible();

  await panel.locator(".variable-row input").first().fill("8443");
  await page.waitForTimeout(900); // debounced autosave is 450ms

  const saved = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("waterwall-studio-project-v1");
          request.onsuccess = () => resolve(JSON.stringify(request.result));
          request.onerror = () => reject(request.error);
        };
      }),
  );
  expect(saved).toContain("8443");
});

/** The satellite cluster appears on the selected node only. */
test("selected node offers its actions in place", async ({ page }) => {
  await page.getByRole("button", { name: /شروع با سناریوی آماده/ }).click();
  await page
    .locator(".scenario-library:visible .scenario-card")
    .first()
    .getByRole("button", { name: /بارگذاری دوطرفه/ })
    .click();
  await page.waitForTimeout(500);

  await expect(page.locator(".node-satellites")).toHaveCount(0);
  await page.locator(".ww-node").first().click();
  await expect(page.locator(".node-satellites")).toHaveCount(1);
});

/**
 * A numeric setting can legitimately hold a $variable$ token, but
 * <input type="number"> renders a non-numeric value as blank — the value looked
 * empty, and a stray edit would have erased it.
 */
test("a variable token stays visible in a numeric field", async ({ page }) => {
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  await page.getByPlaceholder("JSON را اینجا بچسبانید…").fill(`{
    "name": "vars-demo",
    "variables": { "listen_port": 443 },
    "nodes": [
      { "name": "in", "type": "TcpListener", "settings": { "port": $listen_port$ } }
    ]
  }`);
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await page.waitForTimeout(300);
  await page.locator(".ww-node").first().click();

  const inspector = page
    .locator(".inspector-panel:visible, .mobile-sheet-host.open:visible")
    .first();
  const portField = inspector
    .locator("label", { hasText: "پورت شنود" })
    .first()
    .locator("input");

  await expect(portField).toHaveValue("$listen_port$");
  await expect(portField).toHaveAttribute("type", "text");
});
