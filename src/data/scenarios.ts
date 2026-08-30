import type { GraphDocument, StudioProject } from "../types";
import { graphFromConfig } from "../domain/importer";

type Config = Record<string, unknown>;
export type Scenario = {
  id: string;
  title: string;
  summary: string;
  difficulty: "شروع سریع" | "متوسط" | "حرفه‌ای";
  tags: string[];
  cautions: string[];
  iran: Config;
  kharej: Config;
};

const node = (
  name: string,
  type: string,
  settings: Record<string, unknown> = {},
  next?: string,
) => ({
  name,
  type,
  settings,
  ...(next ? { next } : {}),
});

export const SCENARIOS: Scenario[] = [
  {
    id: "vless_tls",
    title: "VLESS + TLS با خروجی TCP",
    summary: "مسیر ساده و قابل‌فهم برای شروع: SOCKS → VLESS → TLS → TCP.",
    difficulty: "شروع سریع",
    tags: ["استریم", "VLESS", "TLS"],
    cautions: [
      "UUID دو سمت باید یکسان باشد.",
      "مسیر cert/key را روی سرور خارج تنظیم کنید.",
    ],
    iran: {
      name: "vless-tls-iran",
      nodes: [
        node(
          "users-in",
          "TcpListener",
          { address: "127.0.0.1", port: 1080 },
          "socks-in",
        ),
        node("socks-in", "Socks5Server", { udp: true }, "vless-c"),
        node(
          "vless-c",
          "VlessClient",
          { uuid: "$UUID$", address: "kharej.example.com", port: 443 },
          "tls-c",
        ),
        node("tls-c", "TlsClient", { sni: "kharej.example.com" }, "outbound"),
        node("outbound", "TcpConnector", { address: "$KHAREJ_IP$", port: 443 }),
      ],
    },
    kharej: {
      name: "vless-tls-kharej",
      nodes: [
        node(
          "inbound",
          "TcpListener",
          { address: "0.0.0.0", port: 443 },
          "tls-s",
        ),
        node(
          "tls-s",
          "TlsServer",
          {
            "cert-file": "/etc/waterwall/cert.pem",
            "key-file": "/etc/waterwall/key.pem",
          },
          "vless-s",
        ),
        node("vless-s", "VlessServer", { uuid: "$UUID$" }, "outbound"),
        node("outbound", "TcpConnector", { address: "127.0.0.1", port: 80 }),
      ],
    },
  },
  {
    id: "protoswap_esp",
    title: "IP Spoof + Protoswap ESP",
    summary: "تونل پکت دوطرفه با تفکیک up/down و تبدیل پروتکل به ESP.",
    difficulty: "حرفه‌ای",
    tags: ["پکت", "Spoof", "ESP"],
    cautions: [
      "فقط IPv4.",
      "capture-ip و IPهای بازنویسی‌شده را پیش از استقرار تغییر دهید.",
    ],
    iran: packetSpoof("protoswap-esp-iran", "10.1.0.1", "$KHAREJ_IP$", "up"),
    kharej: packetSpoof(
      "protoswap-esp-kharej",
      "10.1.0.2",
      "$IRAN_IP$",
      "down",
    ),
  },
  {
    id: "bitswap_mux",
    title: "BitSwap + Mux دوطرفه",
    summary: "مسیر پیشرفته پکت همراه Obfuscator و یک مسیر مستقل Mux/TCP.",
    difficulty: "حرفه‌ای",
    tags: ["پکت", "Bit transport", "Mux"],
    cautions: [
      "دو شاخه PacketSplit باید کامل شوند.",
      "کلید XOR دو سمت باید یکسان بماند.",
    ],
    iran: bitSwap("bitswap-mux-iran", "10.0.0.1", "$KHAREJ_IP$", true),
    kharej: bitSwap("bitswap-mux-kharej", "10.0.0.2", "$IRAN_IP$", false),
  },
  {
    id: "protoswap_tcp",
    title: "Protoswap TCP روی ESP",
    summary:
      "شماره پروتکل بسته به ۵۰ (ESP) عوض می‌شود تا DPI آن را IPsec ببیند.",
    difficulty: "حرفه‌ای",
    tags: ["پکت", "Protoswap", "ESP"],
    cautions: [
      "برخی شبکه‌ها ESP را کامل مسدود می‌کنند؛ اول تست کنید.",
      "capture-ip باید IP عمومی سرور مقابل باشد.",
    ],
    iran: protoswap("protoswap-tcp-iran", "10.10.0.1", "$KHAREJ_IP$", "tcp", 443),
    kharej: protoswap(
      "protoswap-tcp-kharej",
      "10.10.0.2",
      "$IRAN_IP$",
      "tcp",
      443,
    ),
  },
  {
    id: "protoswap_udp",
    title: "Protoswap UDP روی ESP",
    summary: "همان الگو برای ترافیک UDP؛ مناسب تونل‌های WireGuard و QUIC.",
    difficulty: "حرفه‌ای",
    tags: ["پکت", "Protoswap", "UDP"],
    cautions: [
      "MTU را پایین‌تر بگذارید؛ سربار spoof به بسته اضافه می‌شود.",
      "برای UDP کش‌نشدن مسیر برگشت را بررسی کنید.",
    ],
    iran: protoswap("protoswap-udp-iran", "10.11.0.1", "$KHAREJ_IP$", "udp", 443),
    kharej: protoswap(
      "protoswap-udp-kharej",
      "10.11.0.2",
      "$IRAN_IP$",
      "udp",
      443,
    ),
  },
  {
    id: "spoof_flag_scrub",
    title: "TCP spoof ساده با پاک‌سازی پرچم‌ها",
    summary:
      "بدون Obfuscator؛ فقط IpManipulator همه پرچم‌های TCP جز ACK را خاموش می‌کند.",
    difficulty: "متوسط",
    tags: ["پکت", "Bit transport"],
    cautions: [
      "ساده‌ترین عضو خانواده؛ در برابر DPI پیشرفته دوام کمتری دارد.",
    ],
    iran: simpleSpoof("spoof-flags-iran", "10.13.0.1", "$KHAREJ_IP$", "flags", 443),
    kharej: simpleSpoof(
      "spoof-flags-kharej",
      "10.13.0.2",
      "$IRAN_IP$",
      "flags",
      443,
    ),
  },
  {
    id: "spoof_sni_blender",
    title: "TCP spoof با SNI blender",
    summary:
      "به‌جای دستکاری پرچم‌ها، چند بسته اول SNI جعلی می‌گیرند تا شبیه ترافیک عادی شوند.",
    difficulty: "متوسط",
    tags: ["پکت", "SNI"],
    cautions: [
      "تعداد بسته‌های blend را با شبکه خودتان تنظیم کنید.",
    ],
    iran: simpleSpoof("spoof-sni-iran", "10.14.0.1", "$KHAREJ_IP$", "sni", 443),
    kharej: simpleSpoof("spoof-sni-kharej", "10.14.0.2", "$IRAN_IP$", "sni", 443),
  },
  {
    id: "packet_tunnel_legacy",
    title: "PacketTunnel با نحو قدیمی",
    summary:
      "همان الگو با نحو قدیمی IpOverrider (یک نود به‌ازای هر فیلد) و protoswap بدون پسوند.",
    difficulty: "متوسط",
    tags: ["پکت", "نحو قدیمی"],
    cautions: [
      "این نحو هنوز کار می‌کند ولی نسخه جدید خواناتر است.",
      "شماره ۱۳۶ یعنی UDPLite؛ در بعضی شبکه‌ها فیلتر است.",
    ],
    iran: protoswapLegacy(
      "packet-tunnel-iran",
      "10.15.0.1",
      "$KHAREJ_IP$",
      "$IRAN_IP$",
    ),
    kharej: protoswapLegacy(
      "packet-tunnel-kharej",
      "10.15.0.2",
      "$IRAN_IP$",
      "$KHAREJ_IP$",
    ),
  },
];

function packetSpoof(
  name: string,
  tunIp: string,
  peerIp: string,
  upMode: "up" | "down",
): Config {
  const up = upMode === "up" ? "ipman-up" : "ipman-down";
  const down = upMode === "up" ? "ipman-down" : "ipman-up";
  return {
    name,
    nodes: [
      node(
        "my-tun",
        "TunDevice",
        { "device-name": "tun1", "device-ip": tunIp },
        "ipov",
      ),
      node(
        "ipov",
        "IpOverrider",
        { up: { "dest-ip": peerIp }, down: { "source-ip": peerIp } },
        "splitter",
      ),
      { name: "splitter", type: "PacketSplitStream", settings: { up, down } },
      node(
        "ipman-up",
        "IpManipulator",
        { "protoswap-tcp": 50 },
        "raw-up",
      ),
      node("raw-up", "RawSocket", { "capture-ip": peerIp }),
      node(
        "ipman-down",
        "IpManipulator",
        { "protoswap-udp": 50 },
        "raw-down",
      ),
      node("raw-down", "RawSocket", { "capture-ip": peerIp }),
    ],
  };
}

function bitSwap(
  name: string,
  tunIp: string,
  peerIp: string,
  client: boolean,
): Config {
  return {
    name,
    nodes: [
      node(
        "my-tun",
        "TunDevice",
        { "device-name": "tun0", "device-ip": tunIp },
        "ipov",
      ),
      node(
        "ipov",
        "IpOverrider",
        { up: { "dest-ip": peerIp }, down: { "source-ip": peerIp } },
        "splitter",
      ),
      {
        name: "splitter",
        type: "PacketSplitStream",
        settings: { up: "obf-up", down: "obf-down" },
      },
      node(
        "obf-up",
        client ? "ObfuscatorClient" : "ObfuscatorServer",
        { xor_key: "0xaa", method: "xor" },
        "ipman-up",
      ),
      node(
        "ipman-up",
        "IpManipulator",
        { "protoswap-tcp": 50, "bit-transport": true },
        "raw-up",
      ),
      node("raw-up", "RawSocket", { "capture-ip": peerIp }),
      node(
        "obf-down",
        client ? "ObfuscatorServer" : "ObfuscatorClient",
        { xor_key: "0xaa", method: "xor" },
        "ipman-down",
      ),
      node("ipman-down", "IpManipulator", {}, "raw-down"),
      node("raw-down", "RawSocket", { "capture-ip": peerIp }),
      node(
        "inbound",
        "TcpListener",
        { address: "0.0.0.0", port: 443 },
        client ? "mux-c" : "mux-s",
      ),
      node(
        client ? "mux-c" : "mux-s",
        client ? "MuxClient" : "MuxServer",
        client
          ? { mode: "fixed-connections-count", "per-worker-connections-count": 4 }
          : { "max-children": 1024 },
        "outbound",
      ),
      node("outbound", "TcpConnector", {
        address: client ? peerIp : "127.0.0.1",
        port: client ? 443 : 1080,
      }),
    ],
  };
}

/** What the wizard can supply. Anything omitted keeps its placeholder. */
export interface ScenarioInputs {
  iranIp?: string;
  kharejIp?: string;
  uuid?: string;
}

const filled = (value?: string) => Boolean(value && value.trim());

/**
 * The 1.2 Protoswap family: the whole topology hinges on IpManipulator
 * rewriting the IP protocol number so DPI classifies the tunnel as something
 * else. `protocol` picks which suffix is used; the pre-suffix syntax
 * (`protoswap`) appears in older field configs and is covered by
 * protoswapLegacy below.
 */
function protoswap(
  name: string,
  tunIp: string,
  peerIp: string,
  protocol: "tcp" | "udp",
  listenPort: number,
): Config {
  return {
    name,
    nodes: [
      node(
        "users-in",
        "TcpListener",
        { address: "0.0.0.0", port: listenPort },
        "tcp-out",
      ),
      node("tcp-out", "TcpConnector", { address: tunIp, port: listenPort }),
      node(
        "my-tun",
        "TunDevice",
        { "device-name": "wtun1", "device-ip": tunIp },
        "ipov",
      ),
      node(
        "ipov",
        "IpOverrider",
        { up: { "dest-ip": peerIp }, down: { "source-ip": peerIp } },
        "ip-manipulator",
      ),
      node(
        "ip-manipulator",
        "IpManipulator",
        { [`protoswap-${protocol}`]: 50 },
        "raw-out",
      ),
      node("raw-out", "RawSocket", { "capture-ip": peerIp }),
    ],
  };
}


/**
 * The 1.6 family: a spoofed TCP path with no Obfuscator at all, where
 * IpManipulator alone does the work. `blend` picks between the two observed
 * variants — scrubbing every TCP flag except ACK, or SNI blending.
 */
function simpleSpoof(
  name: string,
  tunIp: string,
  peerIp: string,
  blend: "flags" | "sni",
  listenPort: number,
): Config {
  const manipulator =
    blend === "flags"
      ? { "bit-transport": true, ack: true, psh: false, rst: false, fin: false }
      : { "sni-blender": true, "sni-blender-packets": 4 };
  return {
    name,
    nodes: [
      node(
        "users-in",
        "TcpListener",
        { address: "0.0.0.0", port: listenPort },
        "tcp-out",
      ),
      node("tcp-out", "TcpConnector", { address: tunIp, port: listenPort }),
      node(
        "my-tun",
        "TunDevice",
        { "device-name": "wtun3", "device-ip": tunIp },
        "ipov",
      ),
      node(
        "ipov",
        "IpOverrider",
        { up: { "dest-ip": peerIp }, down: { "source-ip": peerIp } },
        "ip-manipulator",
      ),
      node("ip-manipulator", "IpManipulator", manipulator, "raw-out"),
      node("raw-out", "RawSocket", { "capture-ip": peerIp }),
    ],
  };
}

/**
 * 1.7 PacketTunnelFile, kept in its legacy syntax on purpose: one IpOverrider
 * node per field (`direction`/`mode`/`ipv4`) and an IpManipulator `protoswap`
 * with no protocol suffix. Studio has to keep reading configs written this way.
 */
function protoswapLegacy(
  name: string,
  tunIp: string,
  peerIp: string,
  selfIp: string,
): Config {
  return {
    name,
    nodes: [
      node(
        "input1",
        "TcpListener",
        { address: "0.0.0.0", port: 443 },
        "output1",
      ),
      node("output1", "TcpConnector", { address: tunIp, port: 443 }),
      node(
        "my-tun",
        "TunDevice",
        { "device-name": "wtun4", "device-ip": tunIp },
        "ipovsrc",
      ),
      node(
        "ipovsrc",
        "IpOverrider",
        { direction: "up", mode: "source-ip", ipv4: selfIp },
        "ipovdest",
      ),
      node(
        "ipovdest",
        "IpOverrider",
        { direction: "up", mode: "dest-ip", ipv4: peerIp },
        "manip",
      ),
      node("manip", "IpManipulator", { protoswap: 136 }, "raw-out"),
      node("raw-out", "RawSocket", { "capture-ip": peerIp }),
    ],
  };
}

export function projectFromScenario(
  scenario: Scenario,
  current: StudioProject,
  inputs: ScenarioInputs = {},
): StudioProject {
  // Generate once, apply to both servers. That is what keeps the two sides of a
  // tunnel from drifting apart, and it is why the wizard's values have to enter
  // through the same map rather than being pasted in afterwards.
  const secrets: Record<string, string> = {
    $UUID$: filled(inputs.uuid) ? inputs.uuid!.trim() : crypto.randomUUID(),
    $IRAN_IP$: filled(inputs.iranIp) ? inputs.iranIp!.trim() : "IRAN_SERVER_IP",
    $KHAREJ_IP$: filled(inputs.kharejIp)
      ? inputs.kharejIp!.trim()
      : "KHAREJ_SERVER_IP",
    $REVERSE_SECRET$: crypto.randomUUID().replaceAll("-", ""),
    $REALITY_SECRET$: crypto.randomUUID().replaceAll("-", ""),
  };
  const hydrate = (config: Config): GraphDocument =>
    autoLayout(graphFromConfig(replaceTokens(config, secrets)));
  const stillPlaceholder = !filled(inputs.iranIp) || !filled(inputs.kharejIp);
  return {
    ...current,
    name: scenario.title,
    updatedAt: new Date().toISOString(),
    servers: { iran: hydrate(scenario.iran), kharej: hydrate(scenario.kharej) },
    migrationNotes: [
      stillPlaceholder
        ? `سناریوی «${scenario.title}» بارگذاری شد؛ مقادیر placeholder را پیش از خروجی بررسی کنید.`
        : `سناریوی «${scenario.title}» با آدرس‌های واردشده‌ی شما ساخته شد.`,
    ],
  };
}

function replaceTokens(value: unknown, tokens: Record<string, string>): Config {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "string" && tokens[item] ? tokens[item] : item,
    ),
  ) as Config;
}

export function autoLayout(graph: GraphDocument): GraphDocument {
  const incoming = new Map(graph.nodes.map((item) => [item.id, 0]));
  graph.edges.forEach((edge) =>
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1),
  );
  const rank = new Map<string, number>();
  const queue = graph.nodes
    .filter((item) => !incoming.get(item.id))
    .map((item) => item.id);
  queue.forEach((id) => rank.set(id, 0));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    graph.edges
      .filter((edge) => edge.source === id)
      .forEach((edge) => {
        const nextRank = Math.max(
          rank.get(edge.target) ?? 0,
          (rank.get(id) ?? 0) + 1,
        );
        rank.set(edge.target, nextRank);
        if (!queue.includes(edge.target)) queue.push(edge.target);
      });
  }
  const rows = new Map<number, number>();
  return {
    ...graph,
    nodes: graph.nodes.map((item) => {
      const column = rank.get(item.id) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return {
        ...item,
        position: { x: 100 + column * 320, y: 90 + row * 180 },
      };
    }),
  };
}
