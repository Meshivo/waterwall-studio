import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  X,
  Rocket,
} from "lucide-react";
import type { StudioProject } from "../types";
import { SCENARIOS, projectFromScenario, type Scenario } from "../data/scenarios";

export function WizardModal({
  project,
  onApplyScenario,
  onClose,
}: {
  project: StudioProject;
  onApplyScenario: (nextProject: StudioProject) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(SCENARIOS[0]);
  const [iranIp, setIranIp] = useState("185.190.1.100");
  const [kharejIp, setKharejIp] = useState("194.165.1.200");
  const [port, setPort] = useState("443");
  const [uuid, setUuid] = useState<string>(() => crypto.randomUUID());
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    modalRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  const installCmd = `curl -sSL https://raw.githubusercontent.com/WaterWall-VPN/WaterWall/main/scripts/install.sh | bash -s -- --role server --port ${port}`;

  const clientLink = `vless://${uuid}@${iranIp}:${port}?type=tcp&security=none#WaterWall-${selectedScenario.id}`;

  const handleFinish = () => {
    // The step-2 form used to feed only the install command and the client
    // link; the graph was built from placeholders regardless of what the user
    // typed. These values now enter through the same secrets map that keeps
    // both servers consistent.
    const nextProj = projectFromScenario(selectedScenario, project, {
      iranIp,
      kharejIp,
      uuid,
    });
    onApplyScenario(nextProj);
    onClose();
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="wizard-modal-box"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <header className="modal-header">
          <div className="title-with-icon">
            <Rocket className="icon-accent" />
            <div>
              <h3>ساخت سریع و هوشمند (ویزارد مبتدی)</h3>
              <small>تنظیم ۳ مرحله‌ای برای افرادی که دانش عمیق شبکه ندارند</small>
            </div>
          </div>
          <button className="icon-button close-btn" onClick={onClose} aria-label="بستن">
            <X />
          </button>
        </header>

        {/* Wizard Steps Indicator */}
        <div className="wizard-steps-ribbon">
          <div className={`step-item ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>
            <span className="num">۱</span>
            <span>انتخاب الگوی عملیاتی</span>
          </div>
          <div className="step-line" />
          <div className={`step-item ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>
            <span className="num">۲</span>
            <span>تنظیم آدرس‌ها و پورت</span>
          </div>
          <div className="step-line" />
          <div className={`step-item ${step === 3 ? "active" : ""}`}>
            <span className="num">۳</span>
            <span>دریافت دستور نصب و کلاینت</span>
          </div>
        </div>

        {/* Step 1: Scenario Selection */}
        {step === 1 && (
          <div className="wizard-step-body">
            <h4>الگوی ارتباطی مورد نظر خود را انتخاب کنید:</h4>
            <div className="scenario-wizard-grid">
              {SCENARIOS.map((sc) => (
                <div
                  key={sc.id}
                  className={`scenario-card ${selectedScenario.id === sc.id ? "selected" : ""}`}
                  onClick={() => setSelectedScenario(sc)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedScenario(sc);
                    }
                  }}
                  role="option"
                  aria-selected={selectedScenario.id === sc.id}
                  tabIndex={0}
                >
                  <div className="card-top">
                    <span className="badge">{sc.difficulty}</span>
                    <strong className="title">{sc.title}</strong>
                  </div>
                  <p className="summary">{sc.summary}</p>
                  <div className="tags">
                    {sc.tags.map((t) => (
                      <span key={t} className="tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                  {selectedScenario.id === sc.id && (
                    <button
                      className="primary-button scenario-continue"
                      onClick={(event) => {
                        event.stopPropagation();
                        setStep(2);
                      }}
                    >
                      ادامه با این الگو <ArrowLeft />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="wizard-footer">
              <button className="secondary-button" onClick={onClose}>
                انصراف
              </button>
            </div>
          </div>
        )}

        {/* Step 2: IP and Port Configuration */}
        {step === 2 && (
          <div className="wizard-step-body">
            <h4>اطلاعات سرورها و پورت تانل را وارد کنید:</h4>
            <div className="wizard-form-grid">
              <div className="field-group">
                <label htmlFor="wizard-iran-ip">IP عمومی سرور ایران</label>
                <input
                  id="wizard-iran-ip"
                  type="text"
                  value={iranIp}
                  onChange={(e) => setIranIp(e.target.value)}
                  placeholder="مثال: 185.190.1.100"
                />
              </div>

              <div className="field-group">
                <label htmlFor="wizard-kharej-ip">IP عمومی سرور خارج</label>
                <input
                  id="wizard-kharej-ip"
                  type="text"
                  value={kharejIp}
                  onChange={(e) => setKharejIp(e.target.value)}
                  placeholder="مثال: 194.165.1.200"
                />
              </div>

              <div className="field-group">
                <label htmlFor="wizard-port">پورت اتصال (Port)</label>
                <input
                  id="wizard-port"
                  type="text"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="443"
                />
              </div>

              <div className="field-group">
                <label htmlFor="wizard-uuid">شناسه کلید امنیتی (UUID)</label>
                <div className="input-with-button">
                  <input
                    id="wizard-uuid"
                    type="text"
                    value={uuid}
                    onChange={(e) => setUuid(e.target.value)}
                  />
                  <button
                    className="secondary-button sm"
                    onClick={() => setUuid(crypto.randomUUID())}
                  >
                    تولید جدید
                  </button>
                </div>
              </div>
            </div>

            <div className="wizard-footer">
              <button className="secondary-button" onClick={() => setStep(1)}>
                <ArrowRight /> بازگشت
              </button>
              <button className="primary-button" onClick={() => setStep(3)}>
                تولید کانفیگ و دستور نصب <ArrowLeft />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Commands and Client Link */}
        {step === 3 && (
          <div className="wizard-step-body">
            <div className="success-banner">
              <CheckCircle2 />
              <span>کانفیگ دوطرفه با موفقیت بر اساس الگوی «{selectedScenario.title}» آماده شد!</span>
            </div>

            <div className="code-block-section">
              <label>📜 اسکریپت ۱-کلیکی نصب روی سرور لینوکس:</label>
              <div className="code-box">
                <code>{installCmd}</code>
                <button className="copy-btn" onClick={handleCopyCmd}>
                  {copied ? <Check className="green" /> : <Copy />}
                  <span>{copied ? "کپی شد" : "کپی اسکریپت"}</span>
                </button>
              </div>
            </div>

            <div className="client-link-section">
              <label>📱 لینک اتصال کلاینت (VLESS/Tunnel):</label>
              <textarea className="mono-textarea" value={clientLink} readOnly />
            </div>

            <div className="wizard-footer">
              <button className="secondary-button" onClick={() => setStep(2)}>
                <ArrowRight /> ویرایش اطلاعات
              </button>
              <button className="primary-button good-btn" onClick={handleFinish}>
                انتقال خودکار به بوم گرافیکی IDE 🚀
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
