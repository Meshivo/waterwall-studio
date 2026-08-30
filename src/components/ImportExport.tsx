import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Network,
  QrCode,
  Upload,
} from "lucide-react";
import type { GraphDocument, StudioProject, ValidationIssue } from "../types";
import {
  configFromGraph,
  defaultCore,
  graphFromConfig,
  parseWaterWall,
} from "../domain/importer";
import { validateGraph } from "../domain/validator";

export function ImportExport({
  project,
  issues,
  onImport,
  onClose,
}: {
  project: StudioProject;
  issues: ValidationIssue[];
  onImport: (value: GraphDocument | StudioProject) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [qr, setQr] = useState("");
  const graph = project.servers[project.activeServer];
  const analysis = useMemo(() => {
    if (!text.trim()) return undefined;
    try {
      const parsed = parseWaterWall(text);
      const candidate = isStudioProject(parsed)
        ? parsed.servers[parsed.activeServer === "kharej" ? "kharej" : "iran"]
        : graphFromConfig(parsed);
      const previewIssues = validateGraph(candidate.nodes, candidate.edges);
      return {
        kind: isStudioProject(parsed) ? "پروژه دوطرفه" : "کانفیگ یک سرور",
        nodes: candidate.nodes.length,
        edges: candidate.edges.length,
        unknown: candidate.nodes.filter((item) => item.data.definition?.unknown)
          .length,
        errors: previewIssues.filter((item) => item.severity === "error")
          .length,
        warnings: previewIssues.filter((item) => item.severity === "warning")
          .length,
      };
    } catch {
      return undefined;
    }
  }, [text]);
  const importNow = () => {
    try {
      const parsed = parseWaterWall(text);
      // core.json has no `nodes`, so importing it as a graph would silently
      // blank the canvas. It is half of a deploy, not a topology.
      if (isCoreConfig(parsed)) {
        const named = (parsed.configs as string[]).join("، ");
        setError(
          `این فایل core.json است، نه گراف نودها. فایل «${named}» را که خودش نام می‌برد بچسبانید.`,
        );
        return;
      }
      onImport(isStudioProject(parsed) ? parsed : graphFromConfig(parsed));
      setError("");
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "فایل قابل خواندن نیست",
      );
    }
  };
  const clientUri = clientLink(project);
  useEffect(() => {
    if (clientUri)
      import("qrcode")
        .then(({ default: QRCode }) =>
          QRCode.toDataURL(clientUri, {
            width: 240,
            margin: 1,
            color: { dark: "#14100b", light: "#f5eadc" },
          }),
        )
        .then(setQr);
  }, [clientUri]);
  const downloadJson = () =>
    save(
      new Blob([JSON.stringify(configFromGraph(graph), null, 2)], {
        type: "application/json",
      }),
      `${project.activeServer}.json`,
    );
  /**
   * A runnable deployment is two files per server: core.json, which carries the
   * runtime settings and names the config files, plus the node config itself.
   *
   * The previous bundle shipped iran.json and kharej.json while the compose
   * file, the systemd unit and install.sh all referred to a config.json that
   * was never in the archive — nothing in it could actually be run. Every path
   * named below is now a file that exists, laid out per server the way the real
   * dataset does it.
   */
  const downloadZip = async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    const servers = [
      { id: "iran" as const, dir: "iran", label: "ایران" },
      { id: "kharej" as const, dir: "kharej", label: "خارج" },
    ];

    for (const server of servers) {
      const graph = project.servers[server.id];
      const config = configFromGraph(graph);
      const configFile = `config_${server.dir}.json`;
      const core = project.core?.[server.id] ?? defaultCore(configFile);
      // Whatever the project carries, the bundle's own filename wins — a stale
      // configs[] entry would name a file that is not in this archive.
      const folder = zip.folder(server.dir)!;
      folder.file("core.json", JSON.stringify({ ...core, configs: [configFile] }, null, 2));
      folder.file(configFile, JSON.stringify(config, null, 2));
    }

    zip.file("project.waterwall.json", JSON.stringify(project, null, 2));
    zip.file("validation-report.json", JSON.stringify(issues, null, 2));

    const dockerCompose = `version: '3.8'
services:
  waterwall:
    image: ghcr.io/waterwall-vpn/waterwall:latest
    container_name: waterwall_core
    restart: always
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    volumes:
      # Mount one server's folder; it holds core.json and the config it names.
      - ./iran:/etc/waterwall
    working_dir: /etc/waterwall
    command: ["waterwall", "core.json"]
`;
    zip.file("docker-compose.yml", dockerCompose);

    const systemdService = `[Unit]
Description=WaterWall Core Tunnel Engine
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/etc/waterwall
ExecStart=/usr/local/bin/waterwall core.json
Restart=always
RestartSec=3s
LimitNOFILE=65536
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW

[Install]
WantedBy=multi-user.target
`;
    zip.file("waterwall.service", systemdService);

    const installSh = `#!/bin/bash
# WaterWall deployment installer. Run it from the extracted bundle.
set -e

ROLE="\${1:-}"
if [ "$ROLE" != "iran" ] && [ "$ROLE" != "kharej" ]; then
  echo "usage: ./install.sh iran|kharej" >&2
  exit 1
fi

echo "Installing WaterWall ($ROLE)..."
sudo mkdir -p /etc/waterwall
sudo cp "$ROLE/core.json" /etc/waterwall/core.json
sudo cp "$ROLE"/config_*.json /etc/waterwall/
sudo cp waterwall.service /etc/systemd/system/waterwall.service
sudo systemctl daemon-reload
echo "Installed. Start it with: sudo systemctl enable --now waterwall"
`;
    zip.file("install.sh", installSh);

    zip.file(
      "README.txt",
      [
        "WaterWall Studio deployment bundle",
        "",
        "  iran/core.json           runtime settings, names the config below",
        "  iran/config_iran.json    node graph for the Iran server",
        "  kharej/core.json",
        "  kharej/config_kharej.json",
        "",
        "  install.sh iran          copy one side into /etc/waterwall + systemd",
        "  docker-compose.yml       mounts ./iran; edit for the other side",
        "  waterwall.service        systemd unit (installed by install.sh)",
        "  validation-report.json   issues found on the active canvas at export",
        "  project.waterwall.json   re-importable Studio project",
      ].join("\n"),
    );

    save(
      await zip.generateAsync({ type: "blob" }),
      "waterwall-deployment-bundle.zip",
    );
  };
  return (
    <div className="io-panel">
      <section>
        <h3>
          <Upload /> ورود کانفیگ
        </h3>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="JSON را اینجا بچسبانید…"
        />
        <label className="file-button">
          <FileJson /> انتخاب فایل
          <input
            type="file"
            accept=".json,.waterwall.json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) file.text().then(setText);
            }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {analysis && (
          <div className="import-analysis" aria-live="polite">
            <header>
              <Network />
              <strong>{analysis.kind} شناسایی شد</strong>
            </header>
            <div>
              <span>
                <b>{analysis.nodes}</b> نود
              </span>
              <span>
                <b>{analysis.edges}</b> اتصال
              </span>
              <span>
                <b>{analysis.unknown}</b> ناشناخته
              </span>
            </div>
            {analysis.errors || analysis.warnings ? (
              <p>
                <AlertTriangle /> پیش از خروجی: {analysis.errors} خطا و{" "}
                {analysis.warnings} هشدار را بررسی کنید.
              </p>
            ) : (
              <p className="analysis-ok">
                <CheckCircle2 /> ساختار اولیه معتبر است.
              </p>
            )}
          </div>
        )}
        <button
          className="primary-button"
          disabled={!text.trim()}
          onClick={importNow}
        >
          تحلیل و انتقال به بوم{" "}
          {project.activeServer === "iran" ? "ایران" : "خارج"}
        </button>
      </section>
      <section>
        <h3>
          <Download /> خروجی واقعی
        </h3>
        <p>
          فایل‌ها فقط روی دستگاه شما ساخته می‌شوند؛ هیچ دستور یا secret به شبکه
          ارسال نمی‌شود.
        </p>
        <div className="button-row">
          <button className="secondary-button" onClick={downloadJson}>
            JSON سرور فعلی
          </button>
          <button className="primary-button" onClick={downloadZip}>
            ZIP کامل پروژه
          </button>
        </div>
        {clientUri && (
          <div className="qr-box">
            <QrCode />
            <strong>QR واقعی کلاینت</strong>
            {qr && <img src={qr} alt="QR کد لینک کلاینت" />}
            <code>{clientUri}</code>
          </div>
        )}
      </section>
    </div>
  );
}
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function clientLink(project: StudioProject) {
  for (const graph of Object.values(project.servers))
    for (const node of graph.nodes)
      if (node.data.type === "VlessClient") {
        const s = node.data.settings;
        if (s.uuid && s.address && s.port)
          return `vless://${s.uuid}@${s.address}:${s.port}?type=tcp#${encodeURIComponent(node.data.name)}`;
      }
  return "";
}

/** A core.json names config files and carries no nodes of its own. */
function isCoreConfig(value: unknown): value is { configs: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    !("nodes" in record) &&
    Array.isArray(record.configs) &&
    record.configs.every((item) => typeof item === "string")
  );
}

function isStudioProject(value: unknown): value is StudioProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!candidate.servers || typeof candidate.servers !== "object") return false;
  const servers = candidate.servers as Record<string, unknown>;
  return Boolean(servers.iran && servers.kharej && candidate.schemaVersion);
}
