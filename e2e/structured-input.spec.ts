import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
});

/**
 * PacketSplitStream's up/down and Bridge's pair name another node. They used to
 * fall through to a plain text input, which is exactly how a reference to a
 * node that does not exist gets typed. A picker makes that unconstructible.
 */
test("branch references are chosen, not typed", async ({ page }) => {
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  await page
    .getByPlaceholder("JSON را اینجا بچسبانید…")
    .fill(
      JSON.stringify({
        name: "split-demo",
        nodes: [
          { name: "tun", type: "TunDevice", settings: {}, next: "splitter" },
          {
            name: "splitter",
            type: "PacketSplitStream",
            settings: { up: "up-branch", down: "down-branch" },
          },
          { name: "up-branch", type: "IpOverrider", settings: {} },
          { name: "down-branch", type: "IpOverrider", settings: {} },
        ],
      }),
    );
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await page.waitForTimeout(400);

  await page.locator(".ww-node", { hasText: "splitter" }).first().click();
  // Clicking a node selects the inspector panel at every width; which container
  // renders it is a layout detail, so match whichever one is visible.
  const inspector = page
    .locator(".inspector-panel:visible, .mobile-sheet-host.open:visible")
    .first();
  await expect(inspector).toBeVisible();

  // Both branch fields are selects listing the other nodes on the canvas.
  const upField = inspector.locator("label", { hasText: "نام نود هدف در مسیر رفت" }).first();
  await expect(upField.locator("select")).toBeVisible();
  await expect(upField.locator("input[type=text]")).toHaveCount(0);
  await expect(upField.locator("select option")).toContainText([
    "—",
    "tun",
    "up-branch",
    "down-branch",
  ]);
});

/**
 * The wizard's step-2 form was decorative: the IP the user typed reached the
 * install command and the client link, never the graph.
 */
test("the address typed into the wizard reaches the canvas", async ({
  page,
}) => {
  await page.getByRole("button", { name: /ساخت سریع|ویزارد/ }).click();
  const modal = page.locator(".modal-overlay");
  await expect(modal).toBeVisible();

  await modal.locator(".scenario-card").first().click();
  await modal.getByRole("button", { name: /ادامه به گام بعدی/ }).click();

  await modal.getByLabel(/IP عمومی سرور خارج/).fill("203.0.113.77");
  await modal.getByRole("button", { name: /تولید کانفیگ و دستور نصب/ }).click();
  await modal.getByRole("button", { name: /انتقال خودکار به بوم/ }).click();

  await expect(modal).toBeHidden();
  await page.waitForTimeout(700); // debounced autosave

  // Read the persisted project straight out of idb-keyval's store: it is the
  // graph the user would export, which is what the address has to reach.
  const settings = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("waterwall-studio-project-v1");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(JSON.stringify(request.result));
        };
      }),
  );
  expect(settings).toContain("203.0.113.77");
  expect(settings).not.toContain("KHAREJ_SERVER_IP");
});
