import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = new URL("..", import.meta.url).pathname,
  sourceRoot = join(root, "WaterWall-main"),
  tunnelRoot = join(sourceRoot, "tunnels");
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
/**
 * Read `enum node_layer_group` out of the C header so the numbers have exactly
 * one home. This file is .mjs and tsconfig.app.json has no allowJs, so a shared
 * constants module cannot be imported from both sides — the header is the only
 * source of truth both can agree on, and it survives an upstream renumbering.
 */
async function readLayerGroupConstants() {
  const header = await readFile(
    join(sourceRoot, "ww", "objects", "node.h"),
    "utf8",
  );
  const body = header.match(/enum\s+node_layer_group\s*\{([\s\S]*?)\}/)?.[1];
  if (!body) throw new Error("node.h: enum node_layer_group not found");
  const values = new Map();
  for (const [, name, expression] of body.matchAll(
    /(kNodeLayer\w+)\s*=\s*([^,\n]+)/g,
  )) {
    const shift = expression.match(/\(?\s*1\s*<<\s*(\d+)\s*\)?/);
    values.set(
      name,
      shift
        ? 1 << Number(shift[1])
        : expression
            .split("|")
            .map((part) => part.trim())
            .reduce((mask, part) => {
              const value = values.get(part);
              if (value === undefined)
                throw new Error(`node.h: cannot resolve ${part} in ${name}`);
              return mask | value;
            }, 0),
    );
  }
  const constant = (suffix) => {
    const value = values.get(`kNodeLayer${suffix}`);
    if (value === undefined)
      throw new Error(`node.h: kNodeLayer${suffix} missing`);
    return value;
  };
  return {
    None: constant("None"),
    L3: constant("3"),
    L4: constant("4"),
    Anything: constant("Anything"),
    SameAsNext: constant("SameAsNext"),
    SameAsPrev: constant("SameAsPrev"),
    OppositeNext: constant("OppositeNext"),
    OppositePrev: constant("OppositePrev"),
  };
}
const LG = await readLayerGroupConstants();

/**
 * Which node types have a reference page in the docs site. The docs tree is not
 * part of this repo (see README), so record coverage at generate time and build
 * the URL from the type name — a DOCS button must never 404.
 */
const DOCS_BASE = "https://radkesvat.github.io/WaterWall-Docs/docs/noderefs";
const documentedTypes = await (async () => {
  try {
    const entries = await readdir(join(root, "WaterWall-Docs-main", "docs", "02-noderefs"));
    return new Set(
      entries
        .filter((name) => name.endsWith(".mdx"))
        .map((name) => name.replace(/\.mdx$/, "")),
    );
  } catch {
    return new Set();
  }
})();
const LG_BY_NAME = new Map([
  ["kNodeLayerNone", LG.None],
  ["kNodeLayer3", LG.L3],
  ["kNodeLayer4", LG.L4],
  ["kNodeLayerAnything", LG.Anything],
  ["kNodeLayerSameAsNext", LG.SameAsNext],
  ["kNodeLayerSameAsPrev", LG.SameAsPrev],
  ["kNodeLayerOppositeNext", LG.OppositeNext],
  ["kNodeLayerOppositePrev", LG.OppositePrev],
]);

/** `kNodeLayerAnything | kNodeLayerOppositePrev` -> the ORed number. */
const parseMask = (text, where) =>
  text
    .split("|")
    .map((part) => part.trim())
    .reduce((mask, name) => {
      const value = LG_BY_NAME.get(name);
      if (value === undefined)
        throw new Error(`${where}: unknown layer group "${name}"`);
      return mask | value;
    }, 0);

/**
 * The legacy UI string. Ports are coloured by `layer-${port.layer}` in the CSS,
 * so the five-value vocabulary stays — but it is derived from the mask now
 * instead of being pattern-matched out of the C identifier, which used to read
 * `kNodeLayer3 | kNodeLayer4` as "packet".
 *
 * Mirrored in src/domain/layerGroups.ts; layerGroups.test.ts pins the two
 * together across all nodes.
 */
const legacyLayerString = (mask) => {
  const base = mask & LG.Anything;
  if (base === LG.Anything) return "any";
  if (base === LG.L3) return "packet";
  if (base === LG.L4) return "stream";
  if (mask & (LG.SameAsNext | LG.SameAsPrev)) return "same";
  return "none";
};
const categories = [
  [
    /Listener|Receiver|RawSocket|TunDevice|WireGuardDevice|StatelessSocket/,
    "ورودی",
  ],
  [/Connector|Sender|BlackHole/, "خروجی"],
  [/Tls|Reality|Vless|Trojan|Encryption|Obfuscator|Authentication/, "امنیت"],
  [
    /Router|Split|Mux|Bridge|PacketsTo|StreamTo|ConnectionTo|HalfDuplex|Reverse/,
    "مسیر و تبدیل",
  ],
  [/Limit|Disturber|KeepAlive|Ping|Speed|Fisher|Header|Ip/, "پردازش"],
];
const fa = {
  TcpListener: "دریافت اتصال‌های TCP و تحویل آن‌ها به زنجیره",
  TcpConnector: "برقراری اتصال TCP به مقصد",
  UdpListener: "شنود ترافیک UDP ورودی و ایجاد خط حالت‌دار per-peer",
  UdpConnector: "ارسال ترافیک UDP خروجی به آدرس مقصد",
  TcpUdpListener: "دریافت همزمان ترافیک TCP و UDP در ورودی",
  TcpUdpConnector: "اتصال به مقصد TCP یا UDP",
  TunDevice: "ورودی و خروجی بسته‌های IP لایه ۳ از رابط TUN سیستم‌عامل",
  RawSocket: "دریافت و ارسال مستقیم بسته‌های خام IP روی کارت شبکه",
  IpOverrider: "بازنویسی قطعی آدرس‌های IP و پورت‌های مبدأ و مقصد در بسته‌ها",
  IpManipulator: "دستکاری و تغییر پروتکل بسته‌ها (Protoswap ESP، Bit-transport و تغییر MSS)",
  PacketSplitStream: "تقسیم مسیر بسته به دو شاخه مجزای رفت (up) و برگشت (down)",
  PacketsToStream: "تبدیل بسته‌های خام لایه ۳ به استریم لایه ۴ بر اساس طول IPv4",
  StreamToPackets: "بازسازی بسته‌های خام لایه ۳ از استریم لایه ۴",
  PacketsToConnection: "بازسازی جریان‌های TCP/UDP در پشته lwIP و تبدیل به کانکشن استریم",
  ConnectionToPackets: "تبدیل کانکشن‌های استریم به بسته‌های خام IPv4 با آدرس مبدأ مشخص",
  TlsClient: "افزودن رمزنگاری و هدر TLS سمت کلاینت",
  TlsServer: "پذیرش و رمزگشایی TLS سمت سرور با گواهی",
  RealityClient: "لایه کلاینت Reality جهت شبیه‌سازی ترافیک عادی و عبور از فیلترینگ",
  RealityServer: "لایه سرور Reality جهت جداسازی ترافیک احرازشده از بازدیدکننده معمولی",
  VlessClient: "افزودن هدر فریم‌بندی VLESS سمت کلاینت",
  VlessServer: "احرازهویت و پردازش فریم‌های VLESS سمت سرور",
  TrojanClient: "فریم‌بندی و احرازهویت Trojan سمت کلاینت",
  TrojanServer: "بررسی احرازهویت و رمزگشایی Trojan سمت سرور",
  Socks5Server: "پذیرش درخواست‌های پروکسی SOCKS5 در ورودی زنجیره",
  Socks5Client: "اتصال به سرور پروکسی SOCKS5 بالادست",
  MuxClient: "مالتی‌پلس‌کردن چندین خط منطقی روی اتصال‌های مشترک TCP",
  MuxServer: "دی‌مالتی‌پلس‌کردن خطوط منطقی دریافت شده از MuxClient",
  ObfuscatorClient: "مخفی‌سازی و هش‌کردن بایت‌های داده سمت کلاینت",
  ObfuscatorServer: "رمزگشایی و آشکارسازی بایت‌های مخفی‌شده سمت سرور",
  HeaderClient: "درج هدر پورت واتروال یا هدر PROXY نسخه ۱ در ابتدای خط",
  HeaderServer: "استخراج و حذف هدر پورت واتروال یا هدر PROXY در سرور",
  HttpClient: "کپسوله‌سازی داده‌ها در فریم‌های HTTP/1.1 یا HTTP/2 یا WebSocket",
  HttpServer: "استخراج داده‌های کاربر از فریم‌های HTTP و WebSocket سرور",
  ReverseClient: "ایجاد تونل معکوس سمت کلاینت برای عبور از NAT و فایروال",
  ReverseServer: "مدیریت تونل معکوس سمت سرور و برقراری ارتباط با کلاینت پشت NAT",
  Bridge: "اتصال دو شاخه مستقل زنجیره از طریق نام pair یکسان",
  WireGuardDevice: "رمزنگاری و روتینگ مستقل بسته‌ها با پروتکل WireGuard",
  BlackHole: "مسدودکننده و مسدودسازی ترافیک (سیاه‌چاله)",
  SpeedLimit: "محدودکننده سرعت و پهنای باند ترافیک",
  KeepAliveClient: "ارسال سیگنال‌های پینگ دوره‌ای جهت زنده نگه داشتن مسیر کلاینت",
  KeepAliveServer: "پاسخ‌دهی به پینگ‌های زنده نگه‌دارنده در سرور",
};
const fields = {
  TcpListener: [
    ["address", "string", false, "آدرس شنود"],
    ["port", "number", true, "پورت شنود"],
  ],
  UdpListener: [
    ["address", "string", false, "آدرس شنود"],
    ["port", "number", true, "پورت شنود"],
  ],
  TcpUdpListener: [
    ["address", "string", false, "آدرس شنود"],
    ["port", "number", true, "پورت شنود"],
  ],
  TcpConnector: [
    ["address", "string", true, "آدرس مقصد"],
    ["port", "number", true, "پورت مقصد"],
  ],
  UdpConnector: [
    ["address", "string", true, "آدرس مقصد"],
    ["port", "number", true, "پورت مقصد"],
  ],
  TcpUdpConnector: [
    ["address", "string", true, "آدرس مقصد"],
    ["port", "number", true, "پورت مقصد"],
  ],
  TlsClient: [
    ["sni", "string", false, "دامنه SNI"],
    ["insecure-skip-verify", "boolean", false, "نادیده گرفتن گواهی ناپایدار"],
  ],
  TlsServer: [
    ["cert-file", "string", true, "مسیر فایل گواهی (cert)"],
    ["key-file", "string", true, "مسیر فایل کلید (key)"],
  ],
  RealityClient: [
    ["sni", "string", true, "دامنه SNI هدف"],
    ["password", "string", true, "کلید امنیتی Reality"],
    ["short-id", "string", false, "شناسه کوتاه (Short ID)"],
    ["public-key", "string", false, "کلید عمومی (Public Key)"],
  ],
  RealityServer: [
    ["destination", "string", true, "مقصد ترافیک معمولی (آدرس:پورت)"],
    ["password", "string", true, "کلید امنیتی Reality"],
    ["private-key", "string", false, "کلید خصوصی (Private Key)"],
  ],
  VlessClient: [
    ["uuid", "string", true, "شناسه UUID کاربر"],
    ["address", "string", false, "آدرس سرور VLESS"],
    ["port", "number", false, "پورت VLESS"],
  ],
  VlessServer: [["uuid", "string", true, "شناسه UUID کاربر"]],
  TrojanClient: [["password", "string", true, "رمز عبور Trojan"]],
  TrojanServer: [["password", "string", true, "رمز عبور Trojan"]],
  TunDevice: [
    ["device-name", "string", false, "نام کارت شبکه مجازی (مانند tun0)"],
    ["device-ip", "string", false, "آدرس IP کارت شبکه"],
    ["mtu", "number", false, "سایز MTU (پیش‌فرض ۱۵۰۰)"],
  ],
  RawSocket: [
    ["capture-ip", "string", false, "آدرس IP جهت شنود و ارسال"],
    ["interface", "string", false, "نام کارت شبکه اصلی"],
  ],
  IpOverrider: [
    ["up", "json", false, "قواعد تغییر آدرس در مسیر رفت"],
    ["down", "json", false, "قواعد تغییر آدرس در مسیر برگشت"],
  ],
  IpManipulator: [
    ["protoswap-tcp", "number", false, "شماره پروتکل جایگزین TCP (مثلاً 50 برای ESP)"],
    ["protoswap-udp", "number", false, "شماره پروتکل جایگزین UDP (مثلاً 50 برای ESP)"],
    ["bit-transport", "boolean", false, "فعال‌سازی انتقال بیتی"],
  ],
  PacketSplitStream: [
    ["up", "string", false, "نام نود هدف در مسیر رفت"],
    ["down", "string", false, "نام نود هدف در مسیر برگشت"],
  ],
  PacketsToStream: [
    ["sensitive-mode", "boolean", false, "فعال‌سازی حالت ضربان قلب (Heartbeat)"],
    ["interval-ms", "number", false, "فاصله زمانی ارسال پینگ (میلی‌ثانیه)"],
    ["tolerance-ms", "number", false, "حداکثر زمان انتظار پاسخ (میلی‌ثانیه)"],
    ["packet-validation-level", "string", false, "سطح اعتبارسنجی (none/loose/hard)"],
  ],
  StreamToPackets: [
    ["sensitive-mode", "boolean", false, "فعال‌سازی حالت ضربان قلب (Heartbeat)"],
    ["interval-ms", "number", false, "فاصله زمانی ارسال پینگ (میلی‌ثانیه)"],
    ["tolerance-ms", "number", false, "حداکثر زمان انتظار پاسخ (میلی‌ثانیه)"],
  ],
  ConnectionToPackets: [
    ["source-ipv4", "string", false, "آدرس IP مبدأ برای بسته‌های خروجی"],
    ["subnet", "string", false, "ساب‌نت شبکه مجازی lwIP"],
  ],
  Socks5Server: [
    ["udp", "boolean", false, "پشتیبانی از ترافیک UDP"],
    ["auth", "boolean", false, "نیازمند نام‌کاربری و رمز عبور"],
  ],
  Socks5Client: [
    ["address", "string", true, "آدرس پروکسی SOCKS5"],
    ["port", "number", true, "پورت پروکسی SOCKS5"],
  ],
  MuxClient: [
    ["mode", "string", false, "حالت همزمانی (timer/counter/fixed-connections-count)"],
    ["per-worker-connections-count", "number", false, "تعداد اتصال ثابت به‌ازای هر worker (حالت fixed)"],
    ["connection-capacity", "number", false, "ظرفیت اتصال (حالت counter)"],
    ["connection-duration-ms", "number", false, "عمر اتصال به میلی‌ثانیه (حالت timer)"],
  ],
  MuxServer: [["max-children", "number", false, "حداکثر تعداد فرزندان مجاز"]],
  ObfuscatorClient: [
    ["xor_key", "string", false, "کلید کلیدپذیر XOR"],
    ["method", "string", false, "روش مخفی‌سازی (xor)"],
  ],
  ObfuscatorServer: [
    ["xor_key", "string", false, "کلید کلیدپذیر XOR"],
    ["method", "string", false, "روش آشکارسازی (xor)"],
  ],
  HeaderClient: [
    ["data", "string", false, "عبارت داده هدر (مثلاً src_context->port)"],
    ["proxy-protocol", "boolean", false, "فعال‌سازی PROXY protocol"],
    ["frontend-ipv4", "string", false, "IPv4 نمای جلویی (اجباری در حالت PROXY protocol)"],
  ],
  HeaderServer: [["override", "string", false, "عبارت بازنویسی هدر (مثلاً dest_context->port)"]],
  HttpClient: [
    ["host", "string", false, "دامنه Host در هدر HTTP"],
    ["http-version", "string", false, "نسخه HTTP (1.1 یا 2.0)"],
    ["path", "string", false, "مسیر درخخواست HTTP"],
  ],
  HttpServer: [["http-version", "string", false, "نسخه HTTP مورد انتظار"]],
  ReverseClient: [["reverse-secret", "string", true, "کلید رمز تونل معکوس"]],
  ReverseServer: [["reverse-secret", "string", true, "کلید رمز تونل معکوس"]],
  Bridge: [["pair", "string", true, "نام جفت برای اتصال به پل دیگر"]],
  WireGuardDevice: [
    ["private-key", "string", true, "کلید خصوصی WireGuard"],
    ["peer-endpoint", "string", false, "آدرس و پورت peer مقابل"],
    ["allowed-ips", "string", false, "آی‌پی‌های مجاز ( AllowedIPs )"],
  ],
  SpeedLimit: [
    ["kilo-bytes-per-sec", "number", true, "حداکثر نرخ انتقال (کیلوبایت بر ثانیه)"],
    ["limit-mode", "string", true, "دامنه محدودیت (per-connection/per-line/all-connections/all-lines)"],
    ["work-mode", "string", true, "رفتار هنگام تجاوز (drop یا pause)"],
    ["token-recharge-rate", "number", false, "فاصله شارژ توکن به میلی‌ثانیه"],
  ],
};
const adjacency = {},
  observedFields = {};
const corpora = [
  { source: "repo", root: join(sourceRoot, "tests") },
];
const corpusFiles = [];
for (const corpus of corpora) {
  try {
    for (const file of await walk(corpus.root))
      if (file.endsWith(".json")) corpusFiles.push({ ...corpus, path: file });
  } catch {
    // An optional upstream checkout may not be present in every environment.
  }
}
for (const { path, source } of corpusFiles) {
  try {
    const raw = await readFile(path, "utf8");
    const normalized = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/\$([\w-]+)\$/g, '"variable-$1"')
      .replace(/,\s*([}\]])/g, "$1");
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch {}
    const parsedNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    for (const node of parsedNodes) {
      if (!node?.type) continue;
      observedFields[node.type] ??= {};
      for (const [key, value] of Object.entries(node.settings ?? {}))
        observedFields[node.type][key] ??=
          Array.isArray(value) || (value && typeof value === "object")
            ? "json"
            : typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "boolean"
                : "string";
    }
    const pairs = parsedNodes.length
      ? parsedNodes.map((n) => [n.name, n.type])
      : [
          ...raw.matchAll(
            /"name"\s*:\s*"([^"]+)"[\s\S]*?"type"\s*:\s*"([^"]+)"/g,
          ),
        ].map((m) => [m[1], m[2]]);
    const map = new Map(pairs);
    for (const node of parsedNodes) {
      const target = node.next && map.get(node.next);
      if (target) {
        adjacency[node.type] ??= {};
        adjacency[node.type][target] ??= { repo: 0, field: 0 };
        adjacency[node.type][target][source] += 1;
      }
    }
  } catch {}
}
const port = (id, d, l, s, labelFa) => ({
  id,
  direction: d,
  layer: l,
  minConnections: 1,
  maxConnections: 1,
  required: true,
  semantic: s,
  labelFa,
});
const nodes = [],
  sourceHash = createHash("sha256");
for (const path of (await walk(tunnelRoot)).filter((p) =>
  p.endsWith("/instance/node.c"),
)) {
  const source = await readFile(path, "utf8"),
    type = source.match(/type_name\s*=\s*"([^"]+)"/)?.[1];
  if (!type) continue;
  // Each field is an ORed bitfield, so match up to the comma — the same shape
  // .flags uses below. A `(\w+)` capture silently dropped everything after the
  // first `|`, which is how WireGuardDevice's Opposite flags went missing.
  const readMask = (field) => {
    const raw = source.match(new RegExp(`\\.${field}\\s*=\\s*([^,\\n]+)`))?.[1];
    if (raw === undefined)
      throw new Error(`${type}: missing .${field} in ${relative(root, path)}`);
    return parseMask(raw, type);
  };
  const layerGroups = {
    own: readMask("layer_group"),
    prev: readMask("layer_group_prev_node"),
    next: readMask("layer_group_next_node"),
  };
  const own = legacyLayerString(layerGroups.own),
    prev = legacyLayerString(layerGroups.prev),
    next = legacyLayerString(layerGroups.next);
  const canPrev =
      source.match(/\.can_have_prev\s*=\s*(true|false)/)?.[1] === "true",
    canNext =
      source.match(/\.can_have_next\s*=\s*(true|false)/)?.[1] === "true";
  // .flags is an ORed bitfield (e.g. kNodeFlagChainHead | kNodeFlagChainEnd),
  // so match up to the comma rather than a single identifier.
  const flagSource = source.match(/\.flags\s*=\s*([^,\n]+)/)?.[1] ?? "";
  const flags = {
    chainHead: flagSource.includes("kNodeFlagChainHead"),
    chainEnd: flagSource.includes("kNodeFlagChainEnd"),
    noChain: flagSource.includes("kNodeFlagNoChain"),
    singleton: flagSource.includes("kNodeFlagSingleton"),
  };
  let description = `${type} WaterWall node`;
  try {
    const md = await readFile(
      join(dirname(dirname(path)), "description.md"),
      "utf8",
    );
    description =
      md.match(new RegExp("`" + type + "`\\s+([^\\n]+)"))?.[1]?.trim() ??
      md.match(/^#.+\n\n([^\n]+)/m)?.[1] ??
      description;
  } catch {}
  // A Bridge's real second connection is to the Bridge sharing its `pair` name.
  // The C source expresses that in settings, not in the chain, so the port has
  // to be added here or the canvas cannot draw the link at all.
  // Optional on both sides: a Bridge is legal on its own while the user is
  // still building, and the link is only drawn once both halves exist.
  const pairPort = (direction) => ({
    ...port("pair", direction, "any", "route", "جفت"),
    minConnections: 0,
    required: false,
  });
  const bridgePorts = type === "Bridge" ? [pairPort("output")] : [];
  const bridgeInputs = type === "Bridge" ? [pairPort("input")] : [];
  const outputs = [
    ...(type === "PacketSplitStream"
      ? [
          port("up", "output", next, "up", "رفت"),
          port("down", "output", next, "down", "برگشت"),
        ]
      : canNext
        ? [port("next", "output", next === "same" ? own : next, "next", "بعدی")]
        : []),
    ...bridgePorts,
  ];
  const known = (fields[type] ?? []).map(
    ([id, fieldType, required, labelFa]) => ({
      id,
      type: fieldType,
      required,
      labelFa,
    }),
  );
  const settings = [
    ...known,
    ...Object.entries(observedFields[type] ?? {})
      .filter(([id]) => !known.some((f) => f.id === id))
      .map(([id, fieldType]) => ({
        id,
        type: fieldType,
        required: false,
        labelFa: id,
      })),
  ];
  nodes.push({
    type,
    version:
      Number.parseInt(
        source.match(/\.version\s*=\s*([0-9]+)/)?.[1] ?? "1",
        10,
      ) || 1,
    category: categories.find(([r]) => r.test(type))?.[1] ?? "پیشرفته",
    description,
    descriptionFa: fa[type] ?? `نود ${type} در زنجیره WaterWall`,
    inputs: [
      ...bridgeInputs,
      ...(canPrev
      ? [
          port(
            "previous",
            "input",
            prev === "same" ? own : prev,
            "previous",
            "ورودی",
          ),
        ]
      : []),
    ],
    outputs,
    settings,
    flags,
    docsUrl: documentedTypes.has(type) ? `${DOCS_BASE}/${type}` : undefined,
    layerGroups,
    // Not inferrable from port presence: PacketSplitStream has two outputs and
    // BlackHole has none. The layer solver checks the capability itself.
    capabilities: { prev: canPrev, next: canNext },
    lifecycle: ["Init", "Est", "Payload", "Pause", "Resume", "Finish"],
    // Field sightings weigh double: a pattern someone deployed is stronger
    // evidence than one that only appears in a repo test.
    recommendations: Object.entries(adjacency[type] ?? {})
      .sort((a, b) => b[1].field * 2 + b[1].repo - (a[1].field * 2 + a[1].repo))
      .map(([name]) => name),
    sourcePath: relative(root, path),
  });
}
for (const node of nodes)
  sourceHash.update(node.sourcePath).update(JSON.stringify(node));
// If WaterWall-main is a checkout of its own, its commit is the provenance we
// want. It usually is not — and then `git -C` walks *up* to whatever repo
// contains it and cheerfully returns that HEAD, which since this project became
// a git repo meant the schema claimed our own commit as its source. Confirm the
// repository actually starts at WaterWall-main before believing it; otherwise
// hash the source we read.
let sourceCommit = `sha256:${sourceHash.digest("hex")}`;
try {
  const git = (...args) =>
    execFileSync("git", ["-C", sourceRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  if (git("rev-parse", "--show-toplevel") === sourceRoot.replace(/\/$/, ""))
    sourceCommit = git("rev-parse", "HEAD");
} catch {}
const bundle = {
  schemaVersion: 2,
  sourceCommit,
  layerGroupConstants: LG,
  generatedAt: new Date().toISOString(),
  nodes: nodes.sort((a, b) => a.type.localeCompare(b.type)),
  adjacency,
};

const target = join(root, "src/data/generated-node-schema.json");

// The generator runs on every `dev` and `build`. Keep the previous timestamp
// when nothing else changed, so a plain rebuild does not leave the working tree
// dirty for no reason.
try {
  const previous = JSON.parse(await readFile(target, "utf8"));
  const same = (value) => JSON.stringify({ ...value, generatedAt: null });
  if (same(previous) === same(bundle)) bundle.generatedAt = previous.generatedAt;
} catch {}
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(bundle, null, 2) + "\n");
console.log(
  `Generated ${nodes.length} WaterWall node definitions from ${sourceCommit.slice(0, 12)}.`,
);
