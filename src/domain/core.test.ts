import { describe, expect, it } from "vitest";
import type { CoreConfig } from "../types";
import { realConfig } from "./__fixtures__/configs";
import {
  configFromGraph,
  coreFromJson,
  defaultCore,
  graphFromConfig,
  parseWaterWall,
} from "./importer";

/** Representative core configuration used to verify lossless round trips. */
const REAL_CORE = {
  log: {
    path: "log/",
    internal: { loglevel: "DEBUG", console: true },
    core: { loglevel: "DEBUG", console: true },
    network: { loglevel: "DEBUG", console: true },
    dns: { loglevel: "DEBUG", console: false },
  },
  dns: {},
  misc: { workers: 0, "ram-profile": "server", mtu: 1400, "libs-path": "libs/" },
  configs: ["config_iran.json"],
};

describe("core.json", () => {
  it("defaults to the values every real sample uses", () => {
    const core = defaultCore("config_iran.json");

    expect(core.misc).toMatchObject({
      workers: 0,
      "ram-profile": "server",
      mtu: 1400,
      "libs-path": "libs/",
    });
    expect(core.log.path).toBe("log/");
    expect(core.dns).toEqual({});
    expect(core.configs).toEqual(["config_iran.json"]);
  });

  it("names exactly the four fixed log sinks", () => {
    expect(Object.keys(defaultCore("c.json").log).sort()).toEqual([
      "core",
      "dns",
      "internal",
      "network",
      "path",
    ]);
  });

  it("round-trips a real core.json", () => {
    const core = coreFromJson(REAL_CORE, "config_iran.json");

    expect(core.misc.workers).toBe(0);
    expect(core.misc.mtu).toBe(1400);
    expect(core.log.dns.console).toBe(false);
    expect(core.log.core.loglevel).toBe("DEBUG");
    expect(core.configs).toEqual(["config_iran.json"]);
  });

  /** The PacketTunnelFile sample has per-sink files and no mtu. */
  it("keeps optional keys optional", () => {
    const core = coreFromJson(
      {
        log: {
          path: "log/",
          internal: { loglevel: "DEBUG", file: "internal.log", console: true },
          dns: { loglevel: "SILENT", file: "dns.log", console: false },
        },
        dns: {},
        misc: { workers: 1, "ram-profile": "client", "libs-path": "libs/" },
        configs: ["config_ir.json"],
      },
      "fallback.json",
    );

    expect(core.log.internal.file).toBe("internal.log");
    expect(core.misc.mtu).toBeUndefined();
    expect(core.misc["ram-profile"]).toBe("client");
    expect(core.configs).toEqual(["config_ir.json"]);
  });

  it("falls back to the given filename when configs is missing or malformed", () => {
    expect(coreFromJson({}, "config_kharej.json").configs).toEqual([
      "config_kharej.json",
    ]);
    expect(
      coreFromJson({ configs: [1, 2] }, "config_kharej.json").configs,
    ).toEqual(["config_kharej.json"]);
  });

  it("does not carry unknown keys through", () => {
    const core = coreFromJson(
      { ...REAL_CORE, somethingElse: true } as Record<string, unknown>,
      "config_iran.json",
    );
    expect("somethingElse" in (core as unknown as Record<string, unknown>)).toBe(
      false,
    );
  });
});

describe("topology name", () => {
  /**
   * configFromGraph hard-coded "waterwall-studio-project", so importing a real
   * config and exporting it renamed the topology every time.
   */
  it("survives a round trip", () => {
    const source = realConfig("BITSWAP_MUX_IRAN3__config_iran");
    expect(source.name).toBe("iran-tcp-bitswap-mux");

    const exported = configFromGraph(graphFromConfig(source));

    expect(exported.name).toBe("iran-tcp-bitswap-mux");
  });

  it("falls back for a graph that was never imported", () => {
    const exported = configFromGraph({ nodes: [], edges: [], variables: {} });
    expect(exported.name).toBe("waterwall-studio-project");
  });

  it("keeps the name stable across repeated round trips", () => {
    let config = parseWaterWall(
      JSON.stringify({ name: "my-topology", nodes: [] }),
    );
    for (let round = 0; round < 3; round += 1)
      config = configFromGraph(graphFromConfig(config));

    expect(config.name).toBe("my-topology");
  });
});

describe("bundle layout", () => {
  /**
   * The bundle's own scripts name the files it must contain. The previous
   * version shipped iran.json/kharej.json while compose, systemd and install.sh
   * all pointed at a config.json that was never in the archive.
   */
  it("pairs every config file with a core.json that names it", () => {
    for (const [server, file] of [
      ["iran", "config_iran.json"],
      ["kharej", "config_kharej.json"],
    ] as const) {
      const core: CoreConfig = { ...defaultCore(file), configs: [file] };
      expect(core.configs).toEqual([`config_${server}.json`]);
    }
  });
});
