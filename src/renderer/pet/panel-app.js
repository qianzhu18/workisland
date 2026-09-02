import "../shared/i18n.js";
import { R as React, i as i18n, r as reactExports, a as ReactDOM } from "../vendor/react-runtime.js";
import { P as PHASE_ICON, d as defaultIcon, s as stripCwd, A as AgentToolBadge, u as useActionable, S as SubagentList, e as renderActionableCard } from "../island/components/IslandPanel.js";
import { SettingsChangeCard } from "../island/components/SettingsChangeCard.js";
function PetSessionRow({ session, onClick }) {
  const icon = PHASE_ICON[session.phase] ?? defaultIcon;
  const cwd = session.jumpTarget?.workingDirectory;
  const latestUserPrompt = stripCwd(session.latestUserPrompt || "", cwd);
  const currentActivity = stripCwd(session.currentActivity || "", cwd);
  const lastAssistantMessage = stripCwd(session.lastAssistantMessage || "", cwd);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "session-row",
      onClick
    },
    /* @__PURE__ */ React.createElement("div", { className: "session-body" }, /* @__PURE__ */ React.createElement("div", { className: "session-headline" }, /* @__PURE__ */ React.createElement("div", { className: "session-headline-left" }, /* @__PURE__ */ React.createElement("img", { className: "session-icon", src: icon, alt: session.phase }), /* @__PURE__ */ React.createElement("span", { className: "session-title" }, session.title || latestUserPrompt)), /* @__PURE__ */ React.createElement("div", { className: "session-meta" }, /* @__PURE__ */ React.createElement(AgentToolBadge, { tool: session.tool }))), (currentActivity || lastAssistantMessage) && /* @__PURE__ */ React.createElement("div", { className: "session-activity" }, i18n.k3641319963({ placeholder1: currentActivity || lastAssistantMessage }, "最新：{placeholder1}")))
  );
}
function PetPanel({ sessions, surface, direction, onSessionRowClick }) {
  const { actionableId, actionableRef, visibleSessions } = useActionable(sessions, surface);
  const settingsChange = surface?.type === "settingsChange";
  return /* @__PURE__ */ React.createElement("div", { className: `pet-panel is-${direction}` }, /* @__PURE__ */ React.createElement("div", { className: "pet-panel-inner" }, settingsChange ? /* @__PURE__ */ React.createElement(SettingsChangeCard, { surface, onOpenSettings: (tab) => window.islandBridge?.openSettingsTab?.(tab), onCollapse: () => window.petPanelBridge?.collapse?.() }) : visibleSessions.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pet-panel-empty" }, i18n.k1005597952({}, "暂无会话")) : /* @__PURE__ */ React.createElement("div", { className: "pet-session-list" }, visibleSessions.map((session) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: session.id,
      ref: session.id === actionableId ? actionableRef : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "session-row-container" }, /* @__PURE__ */ React.createElement(
      PetSessionRow,
      {
        session,
        onClick: onSessionRowClick ? () => onSessionRowClick(session.id) : void 0
      }
    ), session.activeSubagents && session.activeSubagents.length > 0 && /* @__PURE__ */ React.createElement(
      SubagentList,
      {
        subagents: session.activeSubagents
      }
    ), renderActionableCard({ session, actionableId }))
  )))));
}
function PetPanelApp() {
  const [sessions, setSessions] = reactExports.useState([]);
  const [direction, setDirection] = reactExports.useState("up");
  const [surface, setSurface] = reactExports.useState(null);
  const containerRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    window.petPanelBridge?.onInit((payload) => {
      setDirection(payload.direction);
      setSessions(payload.sessions);
    });
    window.petPanelBridge?.onSessionUpdate((s) => setSessions(s));
    window.petPanelBridge?.onSurface((s) => setSurface(s));
    window.petPanelBridge?.ready();
  }, []);
  reactExports.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        window.petPanelBridge?.resize(height);
      }
    });
    const inner = containerRef.current.querySelector(".pet-panel-inner");
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, [sessions, direction]);
  const handleSessionRowClick = reactExports.useCallback((sessionId) => {
    window.islandBridge?.jumpToSession(sessionId);
  }, []);
  return /* @__PURE__ */ React.createElement("div", { className: "pet-panel-window-root", ref: containerRef }, /* @__PURE__ */ React.createElement(
    PetPanel,
    {
      sessions,
      surface,
      direction,
      onSessionRowClick: handleSessionRowClick
    }
  ));
}
const root = document.getElementById("root");
ReactDOM.createRoot(root).render(/* @__PURE__ */ React.createElement(PetPanelApp, null));
