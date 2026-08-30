import { test, expect } from "@playwright/test";

/**
 * The exported bundle used to be unrunnable: docker-compose.yml mounted
 * ./config.json, the systemd unit ran --config /etc/waterwall/config.json and
 * install.sh copied config.json — none of which were in the archive.
 *
 * This downloads the real ZIP, reads it back, and asserts that every path the
 * bundle's own scripts name is a file the bundle contains.
 */
test("every file the bundle references is in the bundle", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();

  await page.getByRole("button", { name: /شروع با سناریوی آماده/ }).click();
  await page
    .locator(".scenario-library:visible .scenario-card")
    .first()
    .getByRole("button", { name: /بارگذاری دوطرفه/ })
    .click();
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /ZIP کامل پروژه/ }).click(),
  ]).then(([event]) => event);

  // Unzip in Node with the project's own jszip rather than in the page: the
  // published bundle is what has to be correct, not a browser round trip.
  const { readFile } = await import("node:fs/promises");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const entries: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files))
    if (!entry.dir) entries[name] = await entry.async("string");

  const names = Object.keys(entries);
  expect(names).toEqual(
    expect.arrayContaining([
      "iran/core.json",
      "iran/config_iran.json",
      "kharej/core.json",
      "kharej/config_kharej.json",
      "docker-compose.yml",
      "waterwall.service",
      "install.sh",
    ]),
  );

  // core.json names a file that is actually beside it.
  for (const server of ["iran", "kharej"]) {
    const core = JSON.parse(entries[`${server}/core.json`]);
    expect(core.configs).toHaveLength(1);
    expect(names).toContain(`${server}/${core.configs[0]}`);
    expect(core.misc["libs-path"]).toBe("libs/");
  }

  // Nothing still points at the config.json that was never shipped.
  for (const script of ["docker-compose.yml", "waterwall.service", "install.sh"])
    expect(entries[script]).not.toContain("config.json");

  // The compose mount and the install source are real directories.
  expect(entries["docker-compose.yml"]).toContain("./iran:/etc/waterwall");
  expect(entries["install.sh"]).toContain('"$ROLE/core.json"');

  // And the topology name survived instead of being replaced.
  const iranConfig = JSON.parse(entries["iran/config_iran.json"]);
  expect(iranConfig.name).toBe("vless-tls-iran");
});
