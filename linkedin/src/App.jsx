import { useState } from "react";
import { Toaster } from "react-hot-toast";
import TopBar from "./components/layout/TopBar";
import FreshJobsPortal from "./components/panels/FreshJobsPortal";
import CompanyLeadsList from "./components/panels/CompanyLeadsList";
import LeadConnector from "./components/panels/LeadConnector";
import "./mobile.css";

const MOBILE_TABS = [
  { id: "jobs",  label: "Jobs",  icon: "💼" },
  { id: "leads", label: "Leads", icon: "👥" },
  { id: "queue", label: "Queue", icon: "🔗" },
];

export default function App() {
  const [engine,      setEngine]      = useState("jobs"); // desktop: "jobs" | "leads"
  const [mobilePanel, setMobilePanel] = useState("jobs"); // mobile tab

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stone-100 text-slate-900">
      <TopBar />

      {/* Mobile extension warning — hidden on desktop via CSS */}
      <div className="lb-mobile-warning">
        <span className="lb-mobile-warning-icon">⚠️</span>
        <span>
          Scraping and auto-connect require the Chrome extension on desktop.
          Open this app in Chrome on a computer to use these features.
        </span>
      </div>

      {/* Engine switcher — desktop only (hidden on mobile via CSS) */}
      <div className="lb-engine-switcher">
        <button
          className={`lb-engine-btn ${engine === "jobs" ? "lb-engine-active" : ""}`}
          onClick={() => setEngine("jobs")}
        >
          💼 Jobs Hunt Engine
        </button>
        <button
          className={`lb-engine-btn ${engine === "leads" ? "lb-engine-active" : ""}`}
          onClick={() => setEngine("leads")}
        >
          👥 Leads Engine
        </button>
      </div>

      {/* Panel area — engine class controls desktop layout; lb-active controls mobile */}
      <div className={`lb-panels flex-1 ${engine === "jobs" ? "lb-jobs-engine" : "lb-leads-engine"}`}>
        <div className={`lb-panel ${mobilePanel === "jobs" ? "lb-active" : ""}`}>
          <FreshJobsPortal />
        </div>
        <div className={`lb-panel ${mobilePanel === "leads" ? "lb-active" : ""}`}>
          <CompanyLeadsList />
        </div>
        <div className={`lb-panel ${mobilePanel === "queue" ? "lb-active" : ""}`}>
          <LeadConnector />
        </div>
      </div>

      {/* Bottom tab bar — mobile only */}
      <div className="lb-mobile-tabs">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`lb-mobile-tab ${mobilePanel === tab.id ? "lb-tab-active" : ""}`}
            onClick={() => setMobilePanel(tab.id)}
          >
            <span className="lb-mobile-tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#fdfaf8",
            color: "#1e1510",
            border: "1px solid #d4ccc4",
            boxShadow: "0 6px 18px rgba(0, 0, 0, 0.10)",
          },
        }}
      />
    </div>
  );
}
