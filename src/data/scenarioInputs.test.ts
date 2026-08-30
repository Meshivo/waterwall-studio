import { describe, expect, it } from "vitest";
import { emptyProject } from "../domain/importer";
import { schema } from "../domain/schema";
import { validateGraph } from "../domain/validator";
import { SCENARIOS, projectFromScenario } from "./scenarios";

const vless = SCENARIOS.find((scenario) => scenario.id === "vless_tls")!;

const settingsText = (project: ReturnType<typeof projectFromScenario>) =>
  JSON.stringify([
    project.servers.iran.nodes.map((node) => node.data.settings),
    project.servers.kharej.nodes.map((node) => node.data.settings),
  ]);

describe("scenario inputs reach the graph", () => {
  /**
   * The wizard's step-2 form fed only the install command and the client link.
   * The user typed their server IP and it went nowhere — the graph was always
   * built from placeholders.
   */
  it("substitutes the addresses the user supplied", () => {
    const project = projectFromScenario(vless, emptyProject(schema), {
      iranIp: "185.190.1.100",
      kharejIp: "194.165.1.200",
    });

    const text = settingsText(project);
    expect(text).toContain("194.165.1.200");
    expect(text).not.toContain("KHAREJ_SERVER_IP");
    expect(text).not.toContain("IRAN_SERVER_IP");
  });

  it("uses the uuid the user supplied on both servers", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const project = projectFromScenario(vless, emptyProject(schema), { uuid });

    expect(settingsText(project)).toContain(uuid);
  });

  /**
   * validateGraph warns while a scenario placeholder is still in place. Once
   * the user has given real addresses that warning must go, or it trains them
   * to ignore it.
   */
  it("drops the placeholder warning once addresses are given", () => {
    const withInputs = projectFromScenario(vless, emptyProject(schema), {
      iranIp: "185.190.1.100",
      kharejIp: "194.165.1.200",
    });

    for (const server of ["iran", "kharej"] as const) {
      const graph = withInputs.servers[server];
      const codes = validateGraph(graph.nodes, graph.edges).map(
        (issue) => issue.code,
      );
      expect(codes).not.toContain("scenario-placeholder");
    }
  });

  it("keeps the placeholder warning when nothing is supplied", () => {
    const bare = projectFromScenario(vless, emptyProject(schema));
    const graph = bare.servers.iran;
    const codes = validateGraph(graph.nodes, graph.edges).map(
      (issue) => issue.code,
    );

    expect(codes).toContain("scenario-placeholder");
  });

  it("ignores blank and whitespace-only input", () => {
    const project = projectFromScenario(vless, emptyProject(schema), {
      iranIp: "   ",
      kharejIp: "",
    });

    expect(settingsText(project)).toContain("KHAREJ_SERVER_IP");
  });

  it("trims what the user pasted", () => {
    const project = projectFromScenario(vless, emptyProject(schema), {
      kharejIp: "  194.165.1.200  ",
    });

    const text = settingsText(project);
    expect(text).toContain('"194.165.1.200"');
    expect(text).not.toContain("  194.165.1.200");
  });

  it("says so in the migration note when real addresses were used", () => {
    const project = projectFromScenario(vless, emptyProject(schema), {
      iranIp: "185.190.1.100",
      kharejIp: "194.165.1.200",
    });

    expect(project.migrationNotes[0]).toContain("آدرس‌های واردشده");
  });

  /** One generated secret, applied to both sides — that is what prevents drift. */
  it("still generates a single uuid shared by both servers", () => {
    const project = projectFromScenario(vless, emptyProject(schema));
    const uuids = new Set(
      [...project.servers.iran.nodes, ...project.servers.kharej.nodes]
        .map((node) => node.data.settings.uuid)
        .filter(Boolean),
    );

    expect(uuids.size).toBe(1);
  });
});
