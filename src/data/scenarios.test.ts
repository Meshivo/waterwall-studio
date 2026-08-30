import { describe, expect, it } from "vitest";
import { emptyProject } from "../domain/importer";
import { solveGraph } from "../domain/layerSolver";
import { validatePair } from "../domain/pairValidator";
import { schema } from "../domain/schema";
import { validateGraph } from "../domain/validator";
import { projectFromScenario, SCENARIOS } from "./scenarios";

describe("ready scenarios", () => {
  it("covers the Radkesvat topology catalogue", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      SCENARIOS.length,
    );
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id} has no error on either server`, () => {
      const project = projectFromScenario(scenario, emptyProject(schema));
      for (const graph of Object.values(project.servers)) {
        const errors = validateGraph(graph.nodes, graph.edges).filter(
          (issue) => issue.severity === "error",
        );
        expect(errors).toEqual([]);
      }
    });

    /**
     * validateGraph runs the solver too, but assert it directly: a scenario
     * that the core would reject is worse than useless as a starting point,
     * and this is the check that says so in the solver's own terms.
     */
    it(`${scenario.id} solves under the ported layer solver`, () => {
      const project = projectFromScenario(scenario, emptyProject(schema));
      for (const [server, graph] of Object.entries(project.servers)) {
        const solution = solveGraph(graph.nodes, graph.edges);
        expect({
          server,
          failures: solution.chains
            .filter((chain) => !chain.ok)
            .map((chain) => chain.status.message),
        }).toEqual({ server, failures: [] });
      }
    });

    it(`${scenario.id} is a consistent two-server pair`, () => {
      const project = projectFromScenario(scenario, emptyProject(schema));
      expect(
        validatePair(project).map((finding) => finding.technical),
      ).toEqual([]);
    });
  }
});
