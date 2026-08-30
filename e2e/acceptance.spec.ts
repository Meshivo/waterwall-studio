import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const paste = async (page: import("@playwright/test").Page, text: string) => {
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  await page.getByPlaceholder("JSON را اینجا بچسبانید…").fill(text);
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await page.waitForTimeout(400);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
});

/** Acceptance 1: a real field config imports as two independent chains. */
test("BITSWAP_MUX imports clean", async ({ page }) => {
  const config = await readFile(
    "src/domain/__fixtures__/configs/BITSWAP_MUX_IRAN3__config_iran.json",
    "utf8",
  );
  await paste(page, config);
  await expect(page.locator(".ww-node")).toHaveCount(12);
  const layerErrors = await page.evaluate(() =>
    [...document.querySelectorAll(".ww-node.status-error")].length,
  );
  expect(layerErrors).toBe(0);
});

/** Acceptance 2: the chain the old validator wrongly accepted is rejected. */
test("TunDevice to ObfuscatorClient to TlsClient is rejected", async ({
  page,
}) => {
  await paste(
    page,
    JSON.stringify({
      name: "bad-layers",
      nodes: [
        { name: "tun", type: "TunDevice", settings: {}, next: "obf" },
        { name: "obf", type: "ObfuscatorClient", settings: {}, next: "tls" },
        { name: "tls", type: "TlsClient", settings: {}, next: "out" },
        { name: "out", type: "TcpConnector", settings: { address: "1.2.3.4", port: 443 } },
      ],
    }),
  );
  await page.locator(".graph-health").click();
  const panel = page.locator(".issues-list").first();
  await expect(panel.getByText("تعارض لایه")).toBeVisible();
  await expect(page.locator(".ww-node.status-error")).toHaveCount(1);
});

/** Acceptance 3: a secret typo across the two servers is caught and clickable. */
test("a key typo across servers is reported in the pair section", async ({
  page,
}) => {
  const iran = await readFile(
    "src/domain/__fixtures__/configs/BITSWAP_MUX_IRAN3__config_iran.json",
    "utf8",
  );
  const kharej = (
    await readFile(
      "src/domain/__fixtures__/configs/BITSWAP_MUX_KHAREJ__config_kharej.json",
      "utf8",
    )
  ).replace(/"xor_key"\s*:\s*90/, '"xor_key": 91');

  await paste(page, iran);
  await page.getByRole("button", { name: /خارج/ }).click();
  await paste(page, kharej);
  await page.waitForTimeout(400);

  await page.locator(".graph-health").click();
  const pair = page.locator(".pair-issues");
  await expect(pair).toBeVisible();
  await expect(pair.getByText(/محرمانه/)).toBeVisible();
});

/** Acceptance 4: the exported bundle names only files it contains. */
test("the deployment bundle is self-consistent", async ({ page }) => {
  await page.getByRole("button", { name: /شروع با سناریوی آماده/ }).click();
  await page
    .locator(".scenario-library:visible .scenario-card")
    .first()
    .getByRole("button", { name: /بارگذاری دوطرفه/ })
    .click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /ZIP کامل پروژه/ }).click(),
  ]).then(([event]) => event);

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  for (const server of ["iran", "kharej"]) {
    const core = JSON.parse(await zip.files[`${server}/core.json`].async("string"));
    expect(names).toContain(`${server}/${core.configs[0]}`);
  }
});
