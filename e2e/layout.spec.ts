import { test, expect } from "@playwright/test";

/**
 * The topbar packs a history pair, the primary action, two buttons and the
 * overflow menu next to the brand and the server switch. It overflowed at 768px
 * and pushed the overflow menu — the entry to five commands — off the edge.
 * Nothing here is allowed to scroll sideways at any supported width.
 */
test("nothing overflows horizontally", async ({ page }) => {
  await page.goto("/");
  const layout = await page.evaluate(() => {
    const bar = document.querySelector(".topbar") as HTMLElement;
    return {
      topbarWidth: Math.round(bar.getBoundingClientRect().width),
      topbarScroll: bar.scrollWidth,
      bodyClient: document.body.clientWidth,
      bodyScroll: document.body.scrollWidth,
      overflowLeft: Math.round(
        document
          .querySelector(".command-overflow")!
          .getBoundingClientRect().left,
      ),
    };
  });

  expect(layout.topbarScroll).toBeLessThanOrEqual(layout.topbarWidth + 1);
  expect(layout.bodyScroll).toBeLessThanOrEqual(layout.bodyClient + 1);
  expect(layout.overflowLeft).toBeGreaterThanOrEqual(0);
});

test("overflow menu reaches the commands it hides", async ({ page }) => {
  await page.goto("/");
  await page.locator(".command-overflow > button").click();
  const menu = page.locator(".overflow-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /سناریوها/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /JSON زنده/ })).toBeVisible();
  await menu.getByRole("button", { name: /سناریوها/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".scenario-library:visible")).toBeVisible();
});
