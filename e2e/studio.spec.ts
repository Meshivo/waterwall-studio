import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
});
test("guided start adds a compatible entry node and removes the empty state", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "مسیر واتروال‌تان را بصری بسازید" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "شروع دستی" }).click();
  const picker = page.locator(".node-picker:visible");
  await expect(picker.getByText("پیشنهاد برتر و هوشمند")).toBeVisible();
  await picker.locator(".suggestion").first().getByRole("button").first().click();
  await expect(page.locator(".ww-node")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "مسیر واتروال‌تان را بصری بسازید" }),
  ).toHaveCount(0);
});
test("ready scenario builds both Iran and foreign canvases", async ({
  page,
}) => {
  await page.getByRole("button", { name: /شروع با سناریوی آماده/ }).click();
  const library = page.locator(".scenario-library:visible");
  await expect(library.getByText("VLESS + TLS با خروجی TCP")).toBeVisible();
  await library
    .locator(".scenario-card")
    .first()
    .getByRole("button", { name: /بارگذاری دوطرفه/ })
    .click();
  // Iran: TcpListener -> Socks5Server -> VlessClient -> TlsClient -> TcpConnector.
  // The listener is required: Socks5Server is not a chain head.
  await expect(page.locator(".ww-node")).toHaveCount(5);
  await expect(page.locator(".graph-health")).toBeVisible();
  await page.getByRole("button", { name: /خارج/ }).click();
  await expect(page.locator(".ww-node")).toHaveCount(4);
});
test("import transfers nodes to the active canvas and survives reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  const config = {
    name: "e2e",
    nodes: [
      {
        name: "listener",
        type: "TcpListener",
        settings: { port: 8443 },
        next: "out",
      },
      {
        name: "out",
        type: "TcpConnector",
        settings: { address: "127.0.0.1", port: 80 },
      },
    ],
  };
  await page
    .getByPlaceholder("JSON را اینجا بچسبانید…")
    .fill(JSON.stringify(config));
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await expect(page.locator(".ww-node")).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator(".ww-node")).toHaveCount(2);
});
test("versioned project import restores both server canvases", async ({
  page,
}) => {
  const node = (id: string, type: string) => ({
    id,
    type: "waterwall",
    position: { x: 100, y: 100 },
    data: { type, name: id, settings: {} },
  });
  const project = {
    schemaVersion: 1,
    sourceCommit: "e2e",
    name: "round-trip",
    updatedAt: new Date().toISOString(),
    activeServer: "iran",
    migrationNotes: [],
    servers: {
      iran: {
        nodes: [node("iran-listener", "TcpListener")],
        edges: [],
        variables: {},
      },
      kharej: {
        nodes: [node("foreign-out", "TcpConnector")],
        edges: [],
        variables: {},
      },
    },
  };
  await page.getByRole("button", { name: /ورود\/خروجی/ }).click();
  await page
    .getByPlaceholder("JSON را اینجا بچسبانید…")
    .fill(JSON.stringify(project));
  await page.getByRole("button", { name: /تحلیل و انتقال به بوم/ }).click();
  await expect(page.locator(".ww-node")).toContainText("TcpListener");
  await page.getByRole("button", { name: /خارج/ }).click();
  await expect(page.locator(".ww-node")).toContainText("TcpConnector");
});
