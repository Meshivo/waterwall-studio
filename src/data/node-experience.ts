import type { NodeDefinition } from "../types";

export const NODE_CATEGORIES = [
  { id: "all", label: "همه نودها", short: "همه" },
  { id: "transport", label: "اتصال و شبکه", short: "ورودی/خروجی" },
  { id: "protocol", label: "پروتکل پروکسی", short: "پروکسی" },
  { id: "security", label: "امنیت و مبهم‌سازی", short: "امنیت" },
  { id: "routing", label: "روتینگ و مالتی‌پلکس", short: "روتینگ" },
  { id: "adapter", label: "تبدیل پکت و استریم", short: "مبدل لایه" },
  { id: "utility", label: "تست و ابزار", short: "ابزار" },
] as const;

export type NodeCategory = Exclude<
  (typeof NODE_CATEGORIES)[number]["id"],
  "all"
>;

export const SIMPLE_NODE_TYPES = new Set([
  "TcpListener",
  "TcpConnector",
  "UdpListener",
  "UdpConnector",
  "TcpUdpListener",
  "TcpUdpConnector",
  "TunDevice",
  "RawSocket",
  "VlessClient",
  "VlessServer",
  "Socks5Client",
  "Socks5Server",
  "TlsClient",
  "TlsServer",
  "RealityClient",
  "RealityServer",
  "IpManipulator",
  "IpOverrider",
  "MuxClient",
  "MuxServer",
  "ReverseClient",
  "ReverseServer",
  "Bridge",
  "Router",
  "SniffRouter",
  "ConnectionToPackets",
  "PacketsToConnection",
  "PacketsToStream",
  "StreamToPackets",
  "PacketSplitStream",
  "SpeedLimit",
  "LoggerTunnel",
]);

const transport = new Set([
  "TcpListener",
  "TcpConnector",
  "UdpListener",
  "UdpConnector",
  "TcpUdpListener",
  "TcpUdpConnector",
  "UdpStatelessSocket",
  "RawSocket",
  "TunDevice",
  "WireGuardDevice",
  "PacketReceiver",
  "PacketSender",
]);
const protocol = new Set([
  "VlessClient",
  "VlessServer",
  "TrojanClient",
  "TrojanServer",
  "Socks5Client",
  "Socks5Server",
  "HttpClient",
  "HttpServer",
  "TcpOverUdpClient",
  "TcpOverUdpServer",
  "UdpOverTcpClient",
  "UdpOverTcpServer",
]);
const security = new Set([
  "TlsClient",
  "TlsServer",
  "RealityClient",
  "RealityServer",
  "EncryptionClient",
  "EncryptionServer",
  "ObfuscatorClient",
  "ObfuscatorServer",
  "AuthenticationClient",
  "AuthenticationServer",
  "IpManipulator",
  "IpOverrider",
  "Disturber",
  "JunkDatagramSender",
]);
const routing = new Set([
  "MuxClient",
  "MuxServer",
  "Bridge",
  "ReverseClient",
  "ReverseServer",
  "HeaderClient",
  "HeaderServer",
  "Router",
  "SniffRouter",
  "KeepAliveClient",
  "KeepAliveServer",
  "ConnectionFisherClient",
  "ConnectionFisherServer",
  "HalfDuplexClient",
  "HalfDuplexServer",
  "Bgp4Client",
  "Bgp4Server",
]);
const adapter = new Set([
  "ConnectionToPackets",
  "PacketsToConnection",
  "PacketsToStream",
  "StreamToPackets",
  "PacketSplitStream",
]);

export function nodeCategory(type: string): NodeCategory {
  if (transport.has(type)) return "transport";
  if (protocol.has(type)) return "protocol";
  if (security.has(type)) return "security";
  if (routing.has(type)) return "routing";
  if (adapter.has(type)) return "adapter";
  return "utility";
}

export function categoryLabel(typeOrCategory: string): string {
  const id = NODE_CATEGORIES.some((item) => item.id === typeOrCategory)
    ? typeOrCategory
    : nodeCategory(typeOrCategory);
  return NODE_CATEGORIES.find((item) => item.id === id)?.label ?? "سایر";
}

export type Experience = {
  role: string;
  purpose: string;
  pair?: string;
  /**
   * The counterpart node type on the other server, or "self" when a node pairs
   * with another instance of itself. Machine-readable sibling of `pair`, which
   * is prose shown in the Inspector and cannot be parsed.
   */
  counterpart?: string;
  note?: string;
};

/**
 * Hand-written guidance per node type. Exported so the pair validator can read
 * `counterpart` — one table, not two.
 */
export const EXPERIENCE: Record<string, Experience> = {
  Socks5Server: {
    role: "پذیرندهٔ پروکسی SOCKS5",
    purpose: "درخواست‌های SOCKS5 کاربران محلی را می‌گیرد و وارد زنجیره می‌کند.",
    note: "معمولاً پشت یک TcpListener محلی می‌نشیند، نه مستقیم روی اینترنت.",
  },
  Socks5Client: {
    role: "اتصال به پروکسی SOCKS5 بالادست",
    purpose: "ترافیک را به یک سرور SOCKS5 دیگر تحویل می‌دهد.",
  },
  TrojanClient: {
    role: "فریم‌بندی Trojan سمت کلاینت",
    purpose: "داده را با احرازهویت Trojan بسته‌بندی می‌کند.",
    note: "رمز عبور باید با سمت سرور بایت‌به‌بایت یکی باشد.",
  },
  TrojanServer: {
    role: "بررسی Trojan سمت سرور",
    purpose: "احرازهویت را چک و داده را باز می‌کند.",
  },
  ObfuscatorClient: {
    role: "مخفی‌ساز بایت‌ها سمت فرستنده",
    purpose: "بایت‌ها را با XOR درهم می‌کند تا الگوی ترافیک ناشناس شود.",
    note: "کلید XOR باید در هر دو سرور یکسان باشد.",
  },
  ObfuscatorServer: {
    role: "آشکارساز بایت‌ها سمت گیرنده",
    purpose: "همان XOR را برعکس اعمال می‌کند.",
  },
  EncryptionClient: {
    role: "رمزنگاری سمت فرستنده",
    purpose: "محتوای خط را رمز می‌کند.",
    note: "بدون EncryptionServer متناظر، سمت مقابل چیزی نمی‌فهمد.",
  },
  EncryptionServer: {
    role: "رمزگشایی سمت گیرنده",
    purpose: "محتوای رمزشده را باز می‌کند.",
  },
  AuthenticationClient: {
    role: "ارائهٔ هویت به زنجیره",
    purpose: "نود کنترلی است؛ خط کنترل داخلی روی worker صفر دارد و در مسیر داده نیست.",
  },
  AuthenticationServer: {
    role: "بررسی هویت ورودی",
    purpose: "خط‌های بدون کلید معتبر را رد می‌کند.",
    note: "این نود می‌تواند خارج از زنجیره باشد (kNodeFlagNoChain).",
  },
  KeepAliveClient: {
    role: "زنده‌نگه‌دارندهٔ مسیر سمت کلاینت",
    purpose: "پینگ دوره‌ای می‌فرستد تا NAT مسیر را نبندد.",
    note: "فقط کلاینت ping-interval دارد؛ سرور تنظیم و تایمری ندارد.",
  },
  KeepAliveServer: {
    role: "پاسخ‌دهندهٔ پینگ زنده‌نگه‌داری",
    purpose: "به پینگ‌های کلاینت جواب می‌دهد.",
  },
  HalfDuplexClient: {
    role: "نیمه‌دوطرفه سمت کلاینت",
    purpose: "رفت و برگشت را روی دو اتصال جدا می‌برد.",
    note: "برای شبکه‌هایی که ترافیک متقارن را مشکوک می‌دانند.",
  },
  HalfDuplexServer: {
    role: "نیمه‌دوطرفه سمت سرور",
    purpose: "دو اتصال جدا را دوباره به یک خط می‌چسباند.",
  },
  TcpOverUdpClient: {
    role: "تونل TCP روی UDP سمت کلاینت",
    purpose: "جریان TCP را در بسته‌های UDP می‌برد.",
  },
  TcpOverUdpServer: {
    role: "تونل TCP روی UDP سمت سرور",
    purpose: "جریان TCP را از بسته‌های UDP بیرون می‌کشد.",
  },
  UdpOverTcpClient: {
    role: "تونل UDP روی TCP سمت کلاینت",
    purpose: "دیتاگرام‌ها را روی یک اتصال TCP می‌برد.",
    note: "برای عبور از شبکه‌هایی که UDP را می‌بندند.",
  },
  UdpOverTcpServer: {
    role: "تونل UDP روی TCP سمت سرور",
    purpose: "دیتاگرام‌ها را از اتصال TCP بازمی‌سازد.",
  },
  TcpUdpListener: {
    role: "شنوندهٔ همزمان TCP و UDP",
    purpose: "هر دو پروتکل را روی یک پورت می‌گیرد.",
  },
  TcpUdpConnector: {
    role: "اتصال‌دهندهٔ TCP یا UDP",
    purpose: "بسته به مبدأ، اتصال مناسب را باز می‌کند.",
  },
  UdpStatelessSocket: {
    role: "سوکت UDP بدون حالت",
    purpose: "برای هر جریان peer یک line معمولی با عمر idle می‌سازد.",
  },
  PacketSender: {
    role: "فرستندهٔ بستهٔ خام",
    purpose: "بسته‌ها را مستقیم روی شبکه می‌فرستد.",
    note: "در کل کانفیگ فقط یک نمونه مجاز است.",
  },
  PacketReceiver: {
    role: "گیرندهٔ بستهٔ خام",
    purpose: "بسته‌های خام را از شبکه می‌گیرد.",
  },
  Router: {
    role: "مسیریاب شرطی",
    purpose: "بر اساس قاعده، خط را به یکی از مسیرها می‌فرستد.",
  },
  BlackHole: {
    role: "سیاه‌چاله",
    purpose: "هر چه بگیرد دور می‌ریزد.",
    note: "برای مسدودسازی عمدی؛ خروجی ندارد.",
  },
  SpeedLimit: {
    role: "محدودکنندهٔ پهنای باند",
    purpose: "نرخ عبور را سقف می‌زند.",
  },
  Disturber: {
    role: "مختل‌کنندهٔ الگوی ترافیک",
    purpose: "نود تست است (بالادست صریحاً test-only علامتش زده)، نه forwarding تولیدی.",
  },
  JunkDatagramSender: {
    role: "فرستندهٔ دیتاگرام بی‌مصرف",
    purpose: "بستهٔ زائد می‌فرستد تا حجم ترافیک طبیعی‌تر دیده شود.",
  },
  DomainResolver: {
    role: "حل‌کنندهٔ نام دامنه",
    purpose: "نام را به IP تبدیل می‌کند.",
  },
  UserController: {
    role: "مدیریت کاربران",
    purpose: "دسترسی کاربران را کنترل می‌کند.",
  },
  LoggerTunnel: {
    role: "ثبت‌کنندهٔ عبور",
    purpose: "بدون تغییر داده، عبور خط را لاگ می‌کند.",
    note: "برای اشکال‌زدایی؛ در تولید حذفش کنید.",
  },
  PingClient: {
    role: "پینگ‌زن",
    purpose: "تانل کامل پکت L3 داخل ICMP Echo است، نه پروب دسترس‌پذیری.",
  },
  PingServer: {
    role: "پاسخ‌دهندهٔ پینگ",
    purpose: "سمت سرور تانل پکت L3 داخل ICMP Echo است، نه پاسخ‌دهندهٔ پینگ.",
  },
  SpeedTestClient: {
    role: "سنجش سرعت سمت کلاینت",
    purpose: "پهنای باند مسیر را اندازه می‌گیرد.",
  },
  SpeedTestServer: {
    role: "سنجش سرعت سمت سرور",
    purpose: "طرف مقابل تست سرعت است.",
  },
  TesterClient: {
    role: "تست‌کنندهٔ زنجیره",
    purpose: "برای آزمودن مسیر داده مصنوعی می‌سازد.",
    note: "فقط برای تست؛ در کانفیگ واقعی نگذارید.",
  },
  TesterServer: {
    role: "گیرندهٔ تست زنجیره",
    purpose: "داده‌های تست را می‌پذیرد و بررسی می‌کند.",
  },
  ConnectionFisherClient: {
    role: "ماهیگیر اتصال سمت کلاینت",
    purpose: "برای هر خط ورودی چند خط فرزند را مسابقه می‌دهد و اولی که FISH! جواب دهد را نگه می‌دارد.",
  },
  ConnectionFisherServer: {
    role: "ماهیگیر اتصال سمت سرور",
    purpose: "اتصال‌های از پیش بازشده را می‌پذیرد.",
  },
  Bgp4Client: {
    role: "کلاینت BGP4",
    purpose: "فقط با Bgp4Server حرف می‌زند؛ هیچ مسیریابی/peering واقعی BGP ندارد.",
  },
  Bgp4Server: {
    role: "سرور BGP4",
    purpose: "نشست BGP را می‌پذیرد.",
  },
  TcpListener: {
    role: "شنونده TCP سمت سرور",
    purpose: "یک پورت TCP باز می‌کند و نقطه شروع زنجیره است.",
    pair: "TcpConnector",
      counterpart: "TcpConnector",
    note: "بدون خروجی next، اتصال وارد هیچ مسیری نمی‌شود.",
  },
  TcpConnector: {
    role: "اتصال‌دهنده TCP خروجی",
    purpose:
      "یک اتصال TCP واقعی به مقصد باز می‌کند و معمولاً پایان زنجیره است.",
    pair: "TcpListener",
      counterpart: "TcpListener",
    note: "این نود خروجی ندارد.",
  },
  UdpListener: {
    role: "شنونده UDP سمت سرور",
    purpose: "هر peer را به‌صورت یک جریان جدا دریافت می‌کند.",
    pair: "UdpConnector",
      counterpart: "UdpConnector",
  },
  UdpConnector: {
    role: "اتصال‌دهنده UDP خروجی",
    purpose: "یک سوکت UDP خروجی به مقصد می‌سازد.",
    pair: "UdpListener",
      counterpart: "UdpListener",
  },
  TunDevice: {
    role: "رابط شبکه مجازی TUN",
    purpose: "پکت IP را از سیستم‌عامل می‌گیرد یا به آن بازمی‌گرداند.",
    note: "این نود در لایه پکت کار می‌کند.",
  },
  RawSocket: {
    role: "دریافت و ارسال پکت خام IPv4",
    purpose: "پکت خام را مستقیم با کرنل مبادله می‌کند.",
    note: "فقط IPv4؛ تنظیم capture اشتباه می‌تواند مسیر را بی‌اثر کند.",
  },
  IpOverrider: {
    role: "بازنویسی آدرس IP",
    purpose: "آدرس مبدأ یا مقصد پکت را در مسیر رفت و برگشت تغییر می‌دهد.",
    note: "فقط در زنجیره پکت معنا دارد.",
  },
  IpManipulator: {
    role: "دستکاری هدر IP/TCP",
    purpose: "تبدیل‌های Protoswap و Bit transport را روی پکت اعمال می‌کند.",
    note: "فقط در زنجیره پکت استفاده شود.",
  },
  PacketSplitStream: {
    role: "تفکیک مسیر رفت و برگشت پکت",
    purpose: "یک ورودی پکت را به شاخه‌های up و down تقسیم می‌کند.",
    note: "هر شاخه فقط یک اتصال می‌پذیرد.",
  },
  ConnectionToPackets: {
    role: "تبدیل استریم به پکت",
    purpose: "کانکشن معمولی را با شبکه داخلی به پکت تبدیل می‌کند.",
    pair: "PacketsToConnection",
      counterpart: "PacketsToConnection",
  },
  PacketsToConnection: {
    role: "تبدیل پکت به کانکشن",
    purpose:
      "پکت را به اتصال TCP/UDP قابل استفاده در لایه استریم تبدیل می‌کند.",
    pair: "ConnectionToPackets",
      counterpart: "ConnectionToPackets",
  },
  PacketsToStream: {
    role: "بسته‌بندی پکت در استریم",
    purpose: "پکت IPv4 را بدون هدر اضافی داخل استریم عبور می‌دهد.",
    pair: "StreamToPackets",
      counterpart: "StreamToPackets",
  },
  StreamToPackets: {
    role: "استخراج پکت از استریم",
    purpose: "مرز پکت‌های IPv4 را از استریم بازسازی می‌کند.",
    pair: "PacketsToStream",
      counterpart: "PacketsToStream",
  },
  VlessClient: {
    role: "کلاینت VLESS",
    purpose: "هدر VLESS و مقصد را تولید می‌کند.",
    pair: "VlessServer",
      counterpart: "VlessServer",
    note: "TLS را جداگانه با TlsClient اضافه کنید.",
  },
  VlessServer: {
    role: "سرور VLESS",
    purpose: "UUID را بررسی و مقصد را استخراج می‌کند.",
    pair: "VlessClient",
      counterpart: "VlessClient",
  },
  TlsClient: {
    role: "کلاینت TLS",
    purpose: "TLS را در سمت خروجی برقرار می‌کند.",
    pair: "TlsServer",
      counterpart: "TlsServer",
  },
  TlsServer: {
    role: "سرور TLS",
    purpose: "TLS ورودی را با گواهی و کلید خاتمه می‌دهد.",
    pair: "TlsClient",
      counterpart: "TlsClient",
  },
  RealityClient: {
    role: "کلاینت Reality",
    purpose: "هندشیک امن Reality را در سمت خروجی می‌سازد.",
    pair: "RealityServer",
      counterpart: "RealityServer",
  },
  RealityServer: {
    role: "سرور Reality",
    purpose: "ترافیک Reality را دریافت و fallback را مدیریت می‌کند.",
    pair: "RealityClient",
      counterpart: "RealityClient",
  },
  MuxClient: {
    role: "مالتی‌پلکسر کلاینت",
    purpose: "چند اتصال را روی یک اتصال مشترک فریم‌بندی می‌کند.",
    pair: "MuxServer",
      counterpart: "MuxServer",
  },
  MuxServer: {
    role: "دی‌مالتی‌پلکسر سرور",
    purpose: "جریان‌های MuxClient را از هم جدا می‌کند.",
    pair: "MuxClient",
      counterpart: "MuxClient",
  },
  ReverseClient: {
    role: "کلاینت تانل معکوس",
    purpose: "روی سرور خارج می‌نشیند و به داخل ایران شماره می‌گیرد؛ محرک جهت سانسور است نه NAT.",
    pair: "ReverseServer",
      counterpart: "ReverseServer",
  },
  ReverseServer: {
    role: "سرور تانل معکوس",
    purpose: "اتصال‌های reverse را با ترافیک ورودی جفت می‌کند.",
    pair: "ReverseClient",
      counterpart: "ReverseClient",
  },
  Bridge: {
    role: "پل بین دو شاخه",
    purpose: "دو شاخه جدا را با مقدار pair مشترک به هم مرتبط می‌کند.",
    pair: "Bridge با pair یکسان",
      counterpart: "self",
  },
  WireGuardDevice: {
    role: "دستگاه رمزنگاری WireGuard",
    purpose: "ارتباط امن WireGuard را مستقیماً در لایه ۳ پکت پیاده‌سازی می‌کند.",
    pair: "دستگاه WireGuard مقابل",
      counterpart: "self",
    note: "بین لایه ۳ پکت و UdpStatelessSocket قرار می‌گیرد.",
  },
  SniffRouter: {
    role: "روتینگ هوشمند با اسنیف ترافیک",
    purpose: "پروتکل و محتوای ترافیک عبوری را اسنیف کرده و مسیر را تعیین می‌کند.",
  },
  SoftIpLimiter: {
    role: "محدودکننده تعداد آی‌پی فعال",
    purpose: "تعداد آی‌پی‌های همزمان مجاز برای هر شناسه کاربر را محدود می‌کند.",
  },
  HeaderClient: {
    role: "افزودنده هدر اختصاصی واتروال",
    purpose: "اطلاعات پورت و آی‌پی اصلی را در قالب هدر در ابتدای ترافیک می‌فرستد.",
    pair: "HeaderServer",
      counterpart: "HeaderServer",
  },
  HeaderServer: {
    role: "خواننده هدر اختصاصی واتروال",
    purpose: "هدر اضافه شده توسط HeaderClient را خوانده و پورت اصلی را بازیابی می‌کند.",
    pair: "HeaderClient",
      counterpart: "HeaderClient",
  },
  HttpClient: {
    role: "کلاینت کپسوله‌سازی HTTP/2",
    purpose: "ترافیک را در قالب درخواست‌های HTTP/1.1 یا HTTP/2 یا WebSocket بسته‌بندی می‌کند.",
    pair: "HttpServer",
      counterpart: "HttpServer",
  },
  HttpServer: {
    role: "سرور پذیرش HTTP/2",
    purpose: "فریم‌های HTTP/WebSocket را پردازش کرده و بدنه داده را استخراج می‌کند.",
    pair: "HttpClient",
      counterpart: "HttpClient",
  },
};

export function nodeExperience(definition: NodeDefinition): Experience {
  return (
    EXPERIENCE[definition.type] ?? {
      role: categoryLabel(definition.type),
      purpose: definition.descriptionFa,
    }
  );
}

const FIELD_HELP: Record<string, string> = {
  address: "برای Listener آدرس محلی و برای Connector آدرس مقصد است.",
  port: "پورت معتبر بین ۱ تا ۶۵۵۳۵.",
  "port/port-range": "یک پورت مثل 443 یا بازه‌ای مثل 8000-9000.",
  uuid: "شناسه احراز هویت؛ در کلاینت و سرور باید یکسان باشد.",
  password: "راز مشترک قوی؛ در دو سمت متناظر یکسان تنظیم شود.",
  sni: "نام دامنه‌ای که در handshake TLS نمایش داده می‌شود.",
  "cert-file": "مسیر گواهی TLS روی سرور.",
  "key-file": "مسیر کلید خصوصی متناظر با گواهی.",
  "source-ipv4": "IPv4 مبدأ برای تبدیل استریم به پکت.",
  "capture-ip": "IPv4ای که RawSocket باید دریافت کند.",
  "device-name": "نام رابط TUN در سیستم‌عامل.",
  "device-ip": "IPv4 اختصاص‌یافته به رابط TUN.",
  "reverse-secret": "راز مشترک ReverseClient و ReverseServer.",
  pair: "نام مشترک دو Bridge که باید دقیقاً یکسان باشد.",
  "sensitive-mode": "ارسال پینگ‌های heartbeat دوره‌ای جهت سنجش سلامت خط استریم.",
  "packet-validation-level": "سطح اعتبارسنجی پکت‌های decode شده (none / loose / hard).",
  "interval-ms": "فاصله زمانی ارسال پینگ زنده نگه‌دارنده (میلی‌ثانیه).",
  "tolerance-ms": "حداکثر مهلت انتظار پاسخ قبل از بازسازی خط استریم (میلی‌ثانیه).",
  "private-key": "کلید خصوصی بر پایه منحنی منحصر‌به‌فرد 25519.",
  "public-key": "کلید عمومی برای احرازهویت و تبادل هندشیک.",
  "allowed-ips": "بازه‌های IP مجاز جهت هدایت به تونل (AllowedIPs).",
  "protoswap-tcp": "تغییر پروتکل هدر TCP به پروتکل دیگر (مثلاً ESP/IPsec کد ۵۰).",
  "protoswap-udp": "تغییر پروتکل هدر UDP به پروتکل دیگر (مثلاً ESP/IPsec کد ۵۰).",
  "fixed-connections-count": "تعداد اتصال‌های ثابت نگه داشته شده بین MuxClient و MuxServer.",
  xor_key: "کلید بایت به بایت XOR برای مخفی‌سازی بایت‌های داده.",
  "http-version": "نسخه پروتکل HTTP (1.1 یا 2.0).",
};

export function fieldHelp(id: string, fallback?: string): string {
  if (FIELD_HELP[id]) return FIELD_HELP[id];
  if (id.includes("timeout"))
    return "زمان انتظار پیش از آزادسازی اتصال، معمولاً بر حسب میلی‌ثانیه.";
  if (/key|secret|password/.test(id))
    return "مقدار امنیتی؛ در نود جفت باید همان مقدار استفاده شود.";
  if (id.includes("ip")) return "آدرس IP را مطابق جهت و نقش این نود وارد کنید.";
  return fallback ?? "";
}

export const FIELD_OPTIONS: Record<string, string[]> = {
  "domain-strategy": ["prefer_ipv4", "prefer_ipv6", "ipv4_only", "ipv6_only"],
  "http-version": ["1.1", "2.0"],
  "capture-filter-mode": ["source-ip", "dest-ip", "all"],
  "work-mode": ["pause", "drop"],
  "packet-validation-level": ["none", "loose", "hard"],
  mode: ["stream", "packet"],
  method: ["xor"],
};

export type FieldPreset = { label: string; value: string | number };

export const FIELD_PRESETS: Record<string, FieldPreset[]> = {
  port: [
    { label: "443 (HTTPS/TLS محبوب)", value: 443 },
    { label: "8443 (HTTPS جایگزین)", value: 8443 },
    { label: "80 (HTTP عمومی)", value: 80 },
    { label: "2053 (پورت Cloudflare)", value: 2053 },
  ],
  address: [
    { label: "0.0.0.0 (شنود روی همه کارت‌ها)", value: "0.0.0.0" },
    { label: "127.0.0.1 (فقط اتصال محلی)", value: "127.0.0.1" },
  ],
  sni: [
    { label: "www.google.com", value: "www.google.com" },
    { label: "dl.google.com", value: "dl.google.com" },
    { label: "www.cloudflare.com", value: "www.cloudflare.com" },
  ],
  "fixed-connections-count": [
    { label: "۴ اتصال (توصیه‌شده)", value: 4 },
    { label: "۸ اتصال (سرعت بالا)", value: 8 },
    { label: "۱ اتصال (ساده)", value: 1 },
  ],
  "interval-ms": [
    { label: "1000ms (تشخیص سریع قطعی)", value: 1000 },
    { label: "3000ms (حالت استاندارد)", value: 3000 },
  ],
  "tolerance-ms": [
    { label: "2000ms (بازیابی سریع)", value: 2000 },
    { label: "5000ms (ترافیک کند)", value: 5000 },
  ],
};

export const NODE_TIPS: Record<string, string> = {
  TcpListener:
    "روی این آدرس و پورت منتظر اتصال TCP می‌ماند. برای دسترسی عمومی، آدرس شنود باید از شبکه قابل دسترس باشد.",
  TcpConnector:
    "به آدرس و پورت مقصد یک اتصال TCP واقعی باز می‌کند و معمولاً آخر مسیر است.",
  TlsClient:
    "دادهٔ مسیر را داخل TLS می‌فرستد. SNI و تنظیمات امنیتی باید با سمت سرور سازگار باشند.",
  TlsServer:
    "TLS ورودی را باز می‌کند. مسیر فایل گواهی و کلید خصوصی باید روی همان سرور معتبر باشد.",
  RealityClient:
    "پارامترهای Reality این سمت باید با RealityServer متناظر یکسان و سازگار باشند.",
  MuxClient:
    "چند جریان را روی اتصال‌های مشترک می‌فرستد؛ تعداد اتصال ثابت را متناسب با ظرفیت دو سرور انتخاب کنید.",
  PacketsToStream:
    "پکت‌ها را برای عبور از مسیر استریم قاب‌بندی می‌کند. سمت مقابل به مبدل سازگار نیاز دارد.",
  IpManipulator:
    "فقط هدر پکت را طبق قوانین تعیین‌شده تغییر می‌دهد؛ آن را تنها میان نودهای لایه پکت قرار دهید.",
  WireGuardDevice:
    "پکت‌های داخلی را با WireGuard پردازش می‌کند؛ رابط TUN و انتقال UDP در نودهای جدا تنظیم می‌شوند.",
};


/**
 * The counterpart type expected on the other server, or "self" for nodes that
 * pair with another instance of themselves (Bridge, WireGuardDevice).
 * Undefined means the node makes no cross-server claim.
 */
/**
 * Every Client/Server pair the schema itself declares. Derived rather than
 * typed out: if both `XClient` and `XServer` exist as node types, they are each
 * other's counterpart, and there is nothing to keep in sync by hand.
 * A hand-written EXPERIENCE entry still wins, for pairs that do not follow the
 * naming convention (Bridge and WireGuardDevice pair with themselves).
 */
const DERIVED_COUNTERPARTS = new Map<string, string>();
export function registerDerivedCounterparts(types: string[]): void {
  const known = new Set(types);
  for (const type of types) {
    const match = /^(.*)(Client|Server)$/.exec(type);
    if (!match) continue;
    const other = `${match[1]}${match[2] === "Client" ? "Server" : "Client"}`;
    if (known.has(other)) DERIVED_COUNTERPARTS.set(type, other);
  }
}

export function counterpartType(type: string): string | undefined {
  return EXPERIENCE[type]?.counterpart ?? DERIVED_COUNTERPARTS.get(type);
}

/**
 * Derived from the type name rather than tabulated — it covers all 73 types
 * with no maintenance, and it is the same convention the C source uses for its
 * directory names.
 */
export function protocolRole(type: string): "client" | "server" | "symmetric" {
  if (/(?:Client|Connector)$/.test(type)) return "client";
  if (/(?:Server|Listener)$/.test(type)) return "server";
  return "symmetric";
}
