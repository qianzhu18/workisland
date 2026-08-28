import { r as reactExports, R as React, i as i18n } from "../../vendor/react-runtime.js";
import { A as AGENT_TOOL_LABELS, j as isPluginAgentTool, g as getPluginColor, h as getAgentLabel, i as getPluginLabelMap, e as DEFAULT_SHORTCUTS } from "../../shared/settings.js";
import { g as getFireIconByTokenCount, s as sanitizeAgentDisplayText, c as cleanAppName, b as buildApproveAlwaysTooltip } from "../../shared/formatters.js";
import { f as formatTokenCount } from "../../shared/tokens.js";
import { M as Markdown, r as remarkGfm } from "../../vendor/markdown.js";
import { canContinueSessionViaTerminalPrompt, filterSurfaceSessions, sortVisibleSessions } from "../session-model.mjs";
import { MediaCard } from "./MediaCard.js";
import { PerformancePopover } from "./PerformancePopover.js";
import { ShelfPanel } from "./ShelfPanel.js";
import { ClipboardPanel } from "./ClipboardPanel.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { enabledToolboxModules, selectToolboxModule } from "./productivity-toolbox-model.mjs";
const defaultIcon = new URL("../assets/status/idle.svg", import.meta.url).href;
const runningIcon = new URL("../assets/status/running.svg", import.meta.url).href;
const approvalIcon = new URL("../assets/status/approval.svg", import.meta.url).href;
const completeIcon = new URL("../assets/status/complete.svg", import.meta.url).href;
const errorIcon = new URL("../assets/status/error.svg", import.meta.url).href;
const codexIcon = new URL("../assets/brands/codex.png", import.meta.url).href;
function useActionable(sessions, surface, options) {
  const actionableId = surface?.type === "sessionList" || surface?.type === "completion" ? surface.actionableSessionId : void 0;
  const actionableRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    if (!actionableId || options?.disableScroll) return;
    const frame = requestAnimationFrame(() => {
      actionableRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [actionableId, options?.disableScroll]);
  const visibleSessions = reactExports.useMemo(
    () => sortVisibleSessions(filterSurfaceSessions(sessions, surface)),
    [sessions, surface]
  );
  return { actionableId, actionableRef, visibleSessions };
}
function ToolIconFrame({ children }) {
  return React.createElement("svg", {
    className: "toolbox-line-icon",
    viewBox: "0 0 18 18",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.45,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  }, children);
}
function ShelfToolIcon() {
  return React.createElement(ToolIconFrame, null,
    React.createElement("path", { d: "M2.4 5.1h4l1.45 1.55h7.75v6.55a1.4 1.4 0 0 1-1.4 1.4H3.8a1.4 1.4 0 0 1-1.4-1.4Z" }),
    React.createElement("path", { d: "M2.4 6.65V4.8a1.4 1.4 0 0 1 1.4-1.4h2.05l1.45 1.7" })
  );
}
function ClipboardToolIcon() {
  return React.createElement(ToolIconFrame, null,
    React.createElement("rect", { x: 3.4, y: 3.5, width: 11.2, height: 12.2, rx: 1.8 }),
    React.createElement("path", { d: "M6.7 4.5V3.35c0-.6.5-1.05 1.1-1.05h2.4c.6 0 1.1.45 1.1 1.05V4.5M6.5 8h5M6.5 11h5" })
  );
}
function TerminalToolIcon() {
  return React.createElement(ToolIconFrame, null,
    React.createElement("rect", { x: 2.3, y: 3.1, width: 13.4, height: 11.8, rx: 2 }),
    React.createElement("path", { d: "m5.3 7 2 2-2 2M9.4 11h3.2" })
  );
}
function AgentHomeIcon() {
  return React.createElement(ToolIconFrame, null,
    React.createElement("path", { d: "m3 8 6-5 6 5v6.5H3Z" }),
    React.createElement("path", { d: "M7 14.5v-4h4v4" })
  );
}
const TokenBurnFire = ({ tokenCount }) => {
  const iconSrc = reactExports.useMemo(() => {
    return getFireIconByTokenCount(tokenCount);
  }, [tokenCount]);
  return /* @__PURE__ */ React.createElement(
    "img",
    {
      src: iconSrc,
      alt: "token burn fire",
      style: { width: 16, height: 16, objectFit: "cover" }
    }
  );
};
const smallMaxWidth = 22;
const TokenBurnCount = ({ tokenCount, size = "default" }) => {
  const displayCount = reactExports.useMemo(() => {
    if (typeof tokenCount === "string") {
      return tokenCount;
    }
    return formatTokenCount(tokenCount);
  }, [tokenCount]);
  const contentRef = reactExports.useRef(null);
  const [scale, setScale] = reactExports.useState(1);
  const [wrapperWidth, setWrapperWidth] = reactExports.useState("auto");
  reactExports.useLayoutEffect(() => {
    if (size === "small" && contentRef.current) {
      const width = contentRef.current.scrollWidth;
      if (width > smallMaxWidth) {
        setScale(smallMaxWidth / width);
        setWrapperWidth(smallMaxWidth);
      } else {
        setScale(1);
        setWrapperWidth("auto");
      }
    }
  }, [displayCount, size]);
  if (size === "small") {
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "token-burn-count-value",
        style: {
          display: "inline-flex",
          justifyContent: "center",
          alignItems: "center",
          width: wrapperWidth
        }
      },
      /* @__PURE__ */ React.createElement(
        "span",
        {
          ref: contentRef,
          style: {
            display: "inline-block",
            whiteSpace: "nowrap",
            transform: `scale(${scale})`,
            transformOrigin: "center"
          }
        },
        displayCount
      )
    );
  }
  return /* @__PURE__ */ React.createElement("span", { className: "token-burn-count-value" }, displayCount);
};
const TokenUsage = ({ tokenCount, onClick }) => {
  return /* @__PURE__ */ React.createElement("div", { className: "token-usage-container", onClick }, /* @__PURE__ */ React.createElement(TokenBurnFire, { tokenCount: typeof tokenCount === "string" ? void 0 : tokenCount }), tokenCount !== 0 && /* @__PURE__ */ React.createElement(TokenBurnCount, { tokenCount }));
};
const settingIcon = "data:image/svg+xml,%3csvg%20width='14'%20height='14'%20viewBox='0%200%2014%2014'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cg%20clip-path='url(%23clip0_6_762)'%3e%3cpath%20d='M6.41634%205.99086L4.08301%201.94836'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M6.41634%208.00916L4.08301%2012.0517'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M7%2012.8333V11.6666'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M7%201.16663V2.33329'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M8.16699%207H12.8337'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M9.91634%2012.0516L9.33301%2011.0425'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M9.91634%201.94836L9.33301%202.95753'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M1.16699%207H2.33366'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M12.0521%209.91659L11.043%209.33325'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M12.0521%204.08325L11.043%204.66659'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M1.94824%209.91671L2.95741%209.33337'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M1.94824%204.08337L2.95741%204.66671'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M6.99967%208.16659C7.64401%208.16659%208.16634%207.64425%208.16634%206.99992C8.16634%206.35559%207.64401%205.83325%206.99967%205.83325C6.35534%205.83325%205.83301%206.35559%205.83301%206.99992C5.83301%207.64425%206.35534%208.16659%206.99967%208.16659Z'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M6.99967%2011.6666C9.577%2011.6666%2011.6663%209.57725%2011.6663%206.99992C11.6663%204.42259%209.577%202.33325%206.99967%202.33325C4.42235%202.33325%202.33301%204.42259%202.33301%206.99992C2.33301%209.57725%204.42235%2011.6666%206.99967%2011.6666Z'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/g%3e%3cdefs%3e%3cclipPath%20id='clip0_6_762'%3e%3crect%20width='14'%20height='14'%20fill='white'%20style='fill:white;fill-opacity:1;'/%3e%3c/clipPath%3e%3c/defs%3e%3c/svg%3e";
const voiceIcon = "data:image/svg+xml,%3csvg%20width='14'%20height='14'%20viewBox='0%200%2014%2014'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M6.41699%202.74281C6.41687%202.66156%206.39269%202.58216%206.34749%202.51464C6.3023%202.44712%206.23811%202.3945%206.16304%202.36342C6.08797%202.33235%206.00537%202.3242%205.92567%202.34002C5.84598%202.35584%205.77275%202.39491%205.71524%202.45231L3.74124%204.42573C3.66506%204.50236%203.57443%204.56312%203.4746%204.60447C3.37476%204.64583%203.26772%204.66696%203.15966%204.66664H1.75033C1.59562%204.66664%201.44724%204.7281%201.33785%204.8375C1.22845%204.94689%201.16699%205.09527%201.16699%205.24998V8.74998C1.16699%208.90469%201.22845%209.05306%201.33785%209.16245C1.44724%209.27185%201.59562%209.33331%201.75033%209.33331H3.15966C3.26772%209.33299%203.37476%209.35412%203.4746%209.39548C3.57443%209.43683%203.66506%209.49759%203.74124%209.57423L5.71466%2011.5482C5.77217%2011.6059%205.8455%2011.6451%205.92535%2011.661C6.0052%2011.6769%206.08798%2011.6688%206.1632%2011.6376C6.23842%2011.6065%206.30269%2011.5537%206.34787%2011.4859C6.39305%2011.4182%206.41711%2011.3386%206.41699%2011.2571V2.74281Z'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M9.33301%205.25C9.71166%205.75486%209.91634%206.36892%209.91634%207C9.91634%207.63108%209.71166%208.24514%209.33301%208.75'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M11.2949%2010.7123C11.7824%2010.2248%2012.1692%209.646%2012.433%209.00903C12.6968%208.37207%2012.8326%207.68938%2012.8326%206.99993C12.8326%206.31049%2012.6968%205.62779%2012.433%204.99083C12.1692%204.35386%2011.7824%203.77511%2011.2949%203.2876'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
const voiceMuteIcon = "data:image/svg+xml,%3csvg%20width='14'%20height='14'%20viewBox='0%200%2014%2014'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M6.41699%202.74293C6.41687%202.66168%206.39269%202.58228%206.34749%202.51476C6.3023%202.44724%206.23811%202.39462%206.16304%202.36355C6.08797%202.33247%206.00537%202.32433%205.92567%202.34015C5.84598%202.35596%205.77275%202.39504%205.71524%202.45243L3.74124%204.42585C3.66506%204.50248%203.57443%204.56324%203.4746%204.60459C3.37476%204.64595%203.26772%204.66708%203.15966%204.66676H1.75033C1.59562%204.66676%201.44724%204.72822%201.33785%204.83762C1.22845%204.94702%201.16699%205.09539%201.16699%205.2501V8.7501C1.16699%208.90481%201.22845%209.05318%201.33785%209.16258C1.44724%209.27197%201.59562%209.33343%201.75033%209.33343H3.15966C3.26772%209.33311%203.37476%209.35425%203.4746%209.3956C3.57443%209.43696%203.66506%209.49771%203.74124%209.57435L5.71466%2011.5483C5.77217%2011.606%205.8455%2011.6452%205.92535%2011.6612C6.0052%2011.6771%206.08798%2011.6689%206.1632%2011.6377C6.23842%2011.6066%206.30269%2011.5538%206.34787%2011.486C6.39305%2011.4183%206.41711%2011.3387%206.41699%2011.2573V2.74293Z'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M12.833%205.25L9.33301%208.75'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M9.33301%205.25L12.833%208.75'%20stroke='%23D1D3DB'%20style='stroke:%23D1D3DB;stroke:color(display-p3%200.8196%200.8275%200.8588);stroke-opacity:1;'%20stroke-width='1.16667'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
const cleanIcon = "data:image/svg+xml,%3csvg%20width='16'%20height='16'%20viewBox='0%200%2016%2016'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M10.6002%2014.4994L9.9502%2011.8994'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.29997'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M12.5505%209.29981C12.7229%209.29981%2012.8883%209.23133%2013.0102%209.10943C13.132%208.98754%2013.2005%208.82221%2013.2005%208.64983V7.99984C13.2005%207.65507%2013.0636%207.32442%2012.8198%207.08063C12.576%206.83683%2012.2453%206.69987%2011.9006%206.69987H9.95061C9.77822%206.69987%209.61289%206.63139%209.491%206.5095C9.3691%206.3876%209.30062%206.22228%209.30062%206.04989V2.79997C9.30062%202.4552%209.16366%202.12454%208.91987%201.88075C8.67608%201.63696%208.34543%201.5%208.00065%201.5C7.65588%201.5%207.32523%201.63696%207.08144%201.88075C6.83765%202.12454%206.70069%202.4552%206.70069%202.79997V6.04989C6.70069%206.22228%206.63221%206.3876%206.51031%206.5095C6.38841%206.63139%206.22309%206.69987%206.0507%206.69987H4.10075C3.75598%206.69987%203.42532%206.83683%203.18153%207.08063C2.93774%207.32442%202.80078%207.65507%202.80078%207.99984V8.64983C2.80078%208.82221%202.86926%208.98754%202.99116%209.10943C3.11305%209.23133%203.27838%209.29981%203.45077%209.29981'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.29997'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M12.5495%209.2998H3.44972L2.1673%2013.6982C2.14441%2013.7938%202.14348%2013.8933%202.16458%2013.9893C2.18569%2014.0853%202.22828%2014.1752%202.28915%2014.2523C2.35003%2014.3295%202.4276%2014.3918%202.51604%2014.4347C2.60447%2014.4775%202.70147%2014.4997%202.79974%2014.4997H13.1995C13.2978%2014.4997%2013.3947%2014.4775%2013.4832%2014.4347C13.5716%2014.3918%2013.6492%2014.3295%2013.7101%2014.2523C13.7709%2014.1752%2013.8135%2014.0853%2013.8346%2013.9893C13.8557%2013.8933%2013.8548%2013.7938%2013.8319%2013.6982L12.5495%209.2998Z'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.29997'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M5.39941%2014.4994L6.0494%2011.8994'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.29997'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
const updateIcon = "data:image/svg+xml,%3csvg%20width='16'%20height='16'%20viewBox='0%200%2016%2016'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M8.00065%208.66699V14.0003L5.33398%2011.3337'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M8%2013.9997L10.6667%2011.333'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M2.92901%2010.179C2.38452%209.70273%201.95823%209.10634%201.68379%208.43699C1.40935%207.76764%201.29429%207.04365%201.34769%206.32219C1.40109%205.60074%201.62149%204.90158%201.99149%204.27993C2.36148%203.65827%202.87093%203.13115%203.47962%202.74019C4.0883%202.34922%204.77955%202.10513%205.49876%202.02717C6.21798%201.94922%206.94547%202.03954%207.62379%202.29101C8.3021%202.54248%208.91267%202.9482%209.40726%203.47614C9.90186%204.00409%2010.2669%204.63979%2010.4737%205.33305H11.667C12.3151%205.33297%2012.9457%205.54273%2013.4646%205.93095C13.9835%206.31917%2014.3627%206.86498%2014.5455%207.4867C14.7284%208.10842%2014.7049%208.77262%2014.4788%209.37993C14.2527%209.98724%2013.8359%2010.505%2013.291%2010.8557'%20stroke='%23DADCE1'%20style='stroke:%23DADCE1;stroke:color(display-p3%200.8568%200.8617%200.8817);stroke-opacity:1;'%20stroke-width='1.33333'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
const ALL_AGENTS = ["claude", "codex", "cursor", "opencode", "kimi"];
const AGENT_BADGE_COLORS = { claude: "#F08A5D", codex: "#63D5A0", cursor: "#A7B0C0", opencode: "#D6A85A", kimi: "#7EA7FF" };
function isValidPeriod(period) {
  return period.total !== "-";
}
function isValidQuota(quota) {
  return isValidPeriod(quota.daily) || isValidPeriod(quota.weekly);
}
function formatPct(pct) {
  const s = pct.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
function usagePctColor(pct) {
  if (pct >= 80) return "#FF304B";
  if (pct >= 50) return "#FFC224";
  return "#00F873";
}
function AgentQuotaCell({ tool, quota }) {
  const dailyValid = isValidPeriod(quota.daily);
  const weeklyValid = isValidPeriod(quota.weekly);
  const [showTooltip, setShowTooltip] = React.useState(false);
  const activePeriod = dailyValid ? quota.daily : weeklyValid ? quota.weekly : null;
  const tooltipLines = [];
  if (dailyValid) {
    tooltipLines.push(`${i18n.k296832979({ placeholder1: quota.daily.total, placeholder2: formatPct(quota.daily.usedPct), placeholder3: quota.daily.remaining }, "{placeholder1} 额度已用 {placeholder2}%, {placeholder3} 后重置")}`);
  }
  if (weeklyValid) {
    tooltipLines.push(`${i18n.k296832979({ placeholder1: quota.weekly.total, placeholder2: formatPct(quota.weekly.usedPct), placeholder3: quota.weekly.remaining }, "{placeholder1} 额度已用 {placeholder2}%, {placeholder3} 后重置")}`);
  }
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "usage-cell",
      onMouseEnter: () => setShowTooltip(true),
      onMouseLeave: () => setShowTooltip(false)
    },
    /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "agent-monogram",
        title: AGENT_TOOL_LABELS[tool],
        style: { background: tool === "codex" ? "transparent" : AGENT_BADGE_COLORS[tool] ?? "#7B8794" }
      },
      tool === "codex"
        ? /* @__PURE__ */ React.createElement("img", { className: "agent-monogram-image", src: codexIcon, alt: "", draggable: false })
        : String(AGENT_TOOL_LABELS[tool] ?? tool).slice(0, 1).toUpperCase()
    ),
    activePeriod && /* @__PURE__ */ React.createElement("span", { className: "usage-cell-text" }, /* @__PURE__ */ React.createElement("span", { className: "usage-period" }, activePeriod.total, " ", /* @__PURE__ */ React.createElement("span", { style: { color: usagePctColor(activePeriod.usedPct) } }, formatPct(activePeriod.usedPct), "%"), " ", activePeriod.remaining)),
    tooltipLines.length > 0 && showTooltip && /* @__PURE__ */ React.createElement("span", { className: "usage-cell-tooltip is-visible", role: "tooltip" }, tooltipLines.join("\n"))
  );
}
function StatusIcon({ icon, badgeColor, title, onClick }) {
  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick?.();
  };
  return /* @__PURE__ */ React.createElement("span", { className: "status-icon-wrapper", onClick: handleClick, title, style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("img", { src: icon, width: 16, height: 16 }), /* @__PURE__ */ React.createElement("span", { className: "status-icon-badge", style: { background: badgeColor } }));
}
function PetButtonIcon() {
  const [sprite, setSprite] = reactExports.useState(null);
  reactExports.useEffect(() => {
    let cancelled = false;
    const loadSprite = async () => {
      try {
        const result = await window.islandBridge?.getPetSpritePath?.();
        const dataUrl = typeof result === "string" ? result : result?.dataUrl;
        if (!dataUrl || cancelled) return;
        const image = new Image();
        image.onload = () => {
          if (cancelled) return;
          const isCodexPet = result?.protocol === "codex-v2" || (image.naturalWidth === 1536 && image.naturalHeight === 2288);
          const cellWidth = isCodexPet ? 192 : Math.max(1, Math.round(image.naturalHeight / 7));
          const cellHeight = isCodexPet ? 208 : cellWidth;
          const scale = 18 / Math.max(cellWidth, cellHeight);
          setSprite({
            dataUrl,
            backgroundSize: `${Math.round(image.naturalWidth * scale)}px ${Math.round(image.naturalHeight * scale)}px`
          });
        };
        image.onerror = () => {
          if (!cancelled) setSprite(null);
        };
        image.src = dataUrl;
      } catch {
        if (!cancelled) setSprite(null);
      }
    };
    void loadSprite();
    const unsubscribe = window.islandBridge?.onSettingsChanged?.(() => {
      setSprite(null);
      void loadSprite();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  if (!sprite) {
    return /* @__PURE__ */ React.createElement("img", { className: "pet-button-icon-fallback", src: defaultIcon, alt: "桌宠" });
  }
  return /* @__PURE__ */ React.createElement("span", { className: "pet-button-icon", role: "img", "aria-label": "桌宠", style: { backgroundImage: `url(${sprite.dataUrl})`, backgroundSize: sprite.backgroundSize } });
}
function AgentUsageRow({
  agentQuotas,
  notchHeight,
  hasUpdate,
  tokenBurnTotal,
  visibleSessionIds,
  pillFirstRow,
  showUsageQuota = true,
  performanceState,
  performanceEnabled = true,
  enabledToolboxModules = [],
  activeToolboxModule = "agent",
  onToolboxModuleChange,
  onOpenSettings,
  onOpenAbout,
  onOpenPet
}) {
  const agentsWithQuota = ALL_AGENTS.filter(
    (tool) => agentQuotas[tool] && (tool !== "codex" || isValidQuota(agentQuotas[tool]))
  );
  const [muted, setMuted] = reactExports.useState(false);
  reactExports.useEffect(() => {
    window.islandBridge?.onSoundStateUpdate((enabled) => {
      setMuted(!enabled);
    });
  }, []);
  const handleToggleSound = () => {
    window.islandBridge?.toggleSound();
  };
  const handleClearSessions = () => {
    window.islandBridge?.deleteSessions(visibleSessionIds);
  };
  const utilityModules = [
    ["shelf", "文件架", ShelfToolIcon],
    ["clipboard", "剪贴板", ClipboardToolIcon],
    ["terminal", "终端", TerminalToolIcon]
  ].filter(([id]) => enabledToolboxModules.includes(id));
  const utilityButtons = utilityModules.map(([id, label, Icon]) => React.createElement("button", {
    key: id,
    type: "button",
    className: `panel-btn toolbox-icon-button${activeToolboxModule === id ? " is-active" : ""}`,
    title: label,
    "aria-label": label,
    "aria-pressed": activeToolboxModule === id,
    onClick: () => onToolboxModuleChange?.(activeToolboxModule === id ? "agent" : id)
  }, React.createElement(Icon)));
  const agentHomeButton = activeToolboxModule !== "agent" && React.createElement("button", {
    key: "agent",
    type: "button",
    className: "panel-btn toolbox-icon-button",
    title: "智能体主页",
    "aria-label": "智能体主页",
    onClick: () => onToolboxModuleChange?.("agent")
  }, React.createElement(AgentHomeIcon));
  const quotaCells = agentsWithQuota.filter((tool) => {
    if (tool === "claude" && !pillFirstRow.claudeSubscription) return false;
    if (tool === "codex" && !pillFirstRow.codexSubscription) return false;
    return true;
  }).map((tool, idx, arr) => /* @__PURE__ */ React.createElement(React.Fragment, { key: tool }, /* @__PURE__ */ React.createElement(AgentQuotaCell, { tool, quota: agentQuotas[tool] }), idx < arr.length - 1 && /* @__PURE__ */ React.createElement("span", { className: "usage-cell-divider" }, "|")));
  return /* @__PURE__ */ React.createElement("div", { className: "usage-row", style: { minHeight: notchHeight } }, showUsageQuota && /* @__PURE__ */ React.createElement("div", { className: "usage-row-agents" }, quotaCells), /* @__PURE__ */ React.createElement("div", { className: "usage-row-actions" }, visibleSessionIds.length > 0 && /* @__PURE__ */ React.createElement("button", { className: "panel-btn", onClick: handleClearSessions, title: i18n.k1005723937({}, "清理会话") }, /* @__PURE__ */ React.createElement("img", { src: cleanIcon, alt: "clean sessions", width: 16, height: 16 })), pillFirstRow.upgradeButton && hasUpdate && /* @__PURE__ */ React.createElement(StatusIcon, { icon: updateIcon, badgeColor: "#4A90D9", title: i18n.k3734051999({}, "有新版本可用"), onClick: onOpenAbout }), pillFirstRow.soundIcon && /* @__PURE__ */ React.createElement("button", { className: "panel-btn", onClick: handleToggleSound, title: muted ? "Unmute" : "Mute" }, /* @__PURE__ */ React.createElement("img", { src: muted ? voiceMuteIcon : voiceIcon, alt: muted ? "muted" : "sound" })), agentHomeButton, utilityButtons, performanceEnabled && /* @__PURE__ */ React.createElement(PerformancePopover, { state: performanceState }), /* @__PURE__ */ React.createElement("button", { className: "panel-btn panel-pet-button", type: "button", onClick: onOpenPet, title: "打开或关闭桌宠", "aria-label": "打开或关闭桌宠" }, /* @__PURE__ */ React.createElement(PetButtonIcon)), /* @__PURE__ */ React.createElement("button", { className: "panel-btn", onClick: () => onOpenSettings("display"), title: "Settings" }, /* @__PURE__ */ React.createElement("img", { src: settingIcon, alt: "settings" }))));
}
const TOOL_BADGE_COLORS = {
  claude: "#DA7250",
  codex: "#8EA1FF",
  coco: "#32F08C",
  trae: "#32F08C",
  "trae-cn": "#32F08C",
  opencode: "#E0E3EE",
  cursor: "#8EA1FF",
  kimi: "#3F92FF",
  hermes: "#B9963C",
  gemini: "#6E83D5",
  "copilot-cli": "#E0E3EE",
  aiden: "#DEE3F0",
  sara: "#E98EAE",
  "traex": "#32F08C"
};
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function AgentToolBadge({ tool }) {
  const badgeColor = isPluginAgentTool(tool) ? getPluginColor(tool) ?? "#888" : TOOL_BADGE_COLORS[tool] ?? "#888";
  const label = isPluginAgentTool(tool) ? getAgentLabel(tool, getPluginLabelMap()) : AGENT_TOOL_LABELS[tool] ?? tool;
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "session-tool-badge",
      style: {
        color: badgeColor,
        background: hexToRgba(badgeColor, 0.16)
      }
    },
    label
  );
}
const deleteIcon = "data:image/svg+xml,%3csvg%20width='12'%20height='12'%20viewBox='0%200%2012%2012'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M9.5%203V10C9.5%2010.2652%209.39464%2010.5196%209.20711%2010.7071C9.01957%2010.8946%208.76522%2011%208.5%2011H3.5C3.23478%2011%202.98043%2010.8946%202.79289%2010.7071C2.60536%2010.5196%202.5%2010.2652%202.5%2010V3'%20stroke='%23666B75'%20style='stroke:%23666B75;stroke:color(display-p3%200.4000%200.4196%200.4588);stroke-opacity:1;'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M1.5%203H10.5'%20stroke='%23666B75'%20style='stroke:%23666B75;stroke:color(display-p3%200.4000%200.4196%200.4588);stroke-opacity:1;'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3cpath%20d='M4%203V2C4%201.73478%204.10536%201.48043%204.29289%201.29289C4.48043%201.10536%204.73478%201%205%201H7C7.26522%201%207.51957%201.10536%207.70711%201.29289C7.89464%201.48043%208%201.73478%208%202V3'%20stroke='%23666B75'%20style='stroke:%23666B75;stroke:color(display-p3%200.4000%200.4196%200.4588);stroke-opacity:1;'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
const PHASE_ICON = {
  running: runningIcon,
  waitingForApproval: approvalIcon,
  waitingForAnswer: approvalIcon,
  completed: completeIcon
};
function stripCwd(text, cwd) {
  if (!cwd) return text;
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return text.replaceAll(prefix, "");
}
function formatDuration(seconds) {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const rem = s % 60;
    return rem ? `${Math.floor(s / 60)}m${String(rem).padStart(2, "0")}s` : `${Math.floor(s / 60)}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}
function useElapsed(session) {
  const isRunning = session.phase !== "completed";
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(id);
  }, [isRunning]);
  const end = isRunning ? now : session.updatedAt;
  // 优先按本轮起点计时；老状态里没有该字段时退回整段语义
  const start = session.turnStartedAt ?? session.createdAt;
  const elapsed = Math.floor((end - start) / 1e3);
  return formatDuration(elapsed);
}
function SessionRow({
  session,
  isActive,
  isFollowUpOpen,
  onClick,
  onFollowUpClick
}) {
  const icon = session.error ? errorIcon : PHASE_ICON[session.phase] ?? defaultIcon;
  const terminalApp = session.jumpTarget?.app;
  const cwd = session.jumpTarget?.workingDirectory;
  const elapsed = useElapsed(session);
  const latestUserPrompt = sanitizeAgentDisplayText(
    stripCwd(session.latestUserPrompt || "", cwd)
  );
  const currentActivity = sanitizeAgentDisplayText(
    stripCwd(session.currentActivity || "", cwd)
  );
  const lastAssistantMessage = sanitizeAgentDisplayText(
    stripCwd(session.lastAssistantMessage || "", cwd)
  );
  function handleDelete(e) {
    e.stopPropagation();
    window.islandBridge?.deleteSession(session.id);
  }
  function handleFollowUpClick(e) {
    e.stopPropagation();
    onFollowUpClick?.();
  }
  const canContinueSession = canContinueSessionViaTerminalPrompt(session);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `session-row${isActive ? " is-active" : ""}`,
      onClick
    },
    /* @__PURE__ */ React.createElement(
      "img",
      {
        className: "session-icon",
        src: icon,
        alt: session.phase,
        width: 32,
        height: 32
      }
    ),
    /* @__PURE__ */ React.createElement("div", { className: "session-body" }, /* @__PURE__ */ React.createElement("div", { className: "session-headline" }, /* @__PURE__ */ React.createElement("div", { className: "session-headline-left" }, /* @__PURE__ */ React.createElement(AgentToolBadge, { tool: session.tool }), /* @__PURE__ */ React.createElement("span", { className: "session-title" }, session.title)), /* @__PURE__ */ React.createElement("div", { className: "session-meta" }, terminalApp && /* @__PURE__ */ React.createElement("span", { className: "session-terminal" }, terminalApp.toLowerCase() === "claude" ? "APP" : cleanAppName(terminalApp)), /* @__PURE__ */ React.createElement("span", { className: "session-elapsed" }, elapsed), canContinueSession && /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: `session-continue-btn${isFollowUpOpen ? " is-active" : ""}`,
        onClick: handleFollowUpClick,
        title: i18n.k4191004497({}, "继续现有会话"),
        "aria-label": i18n.k4191004497({}, "继续现有会话")
      },
      i18n.k3182587559({}, "💬 追问")
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "session-delete-btn",
        onClick: handleDelete,
        title: "Delete session"
      },
      /* @__PURE__ */ React.createElement("img", { src: deleteIcon, alt: "delete", width: 14, height: 14 })
    ))), latestUserPrompt && /* @__PURE__ */ React.createElement("div", { className: "session-prompt" }, `${i18n.k722092343({ placeholder1: latestUserPrompt }, "你: {placeholder1}")}`), (currentActivity || lastAssistantMessage) && /* @__PURE__ */ React.createElement("div", { className: "session-activity" }, currentActivity || lastAssistantMessage))
  );
}
const MAX_VISIBLE = 3;
function formatElapsed(startedAt) {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1e3));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${String(s).padStart(2, "0")}s` : `${m}m`;
}
function formatPrimaryLine(info) {
  const desc = info.taskDescription || info.title;
  if (info.agentType && desc) {
    return `${info.agentType}: ${desc}`;
  }
  if (desc) return desc;
  if (info.agentType) return info.agentType;
  return info.agentId.slice(0, 8);
}
function formatSecondaryLine(info) {
  const tool = info.lastToolActivity?.trim();
  if (!tool) return void 0;
  if (/^prompt:/i.test(tool)) return void 0;
  if (/^processing prompt/i.test(tool)) return void 0;
  if (/^thinking\.{0,3}$/i.test(tool)) return void 0;
  if (/<task-notification\b/i.test(tool)) return void 0;
  return tool;
}
function SubagentRow({
  info,
  index
}) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!info.startedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1e3);
    return () => clearInterval(id);
  }, [info.startedAt]);
  const primary = formatPrimaryLine(info);
  const secondary = formatSecondaryLine(info);
  const elapsed = formatElapsed(info.startedAt);
  return /* @__PURE__ */ React.createElement("div", { className: "subagent-item" }, /* @__PURE__ */ React.createElement("div", { className: "subagent-primary" }, /* @__PURE__ */ React.createElement("span", { className: "subagent-num" }, index, "."), /* @__PURE__ */ React.createElement("div", { className: "subagent-body" }, /* @__PURE__ */ React.createElement("div", { className: "subagent-primary-line" }, /* @__PURE__ */ React.createElement("span", { className: "subagent-primary-text" }, primary), elapsed ? /* @__PURE__ */ React.createElement("span", { className: "subagent-elapsed" }, elapsed) : null), secondary ? /* @__PURE__ */ React.createElement("div", { className: "subagent-secondary" }, /* @__PURE__ */ React.createElement("span", { className: "subagent-bullet", "aria-hidden": true }, "•"), /* @__PURE__ */ React.createElement("span", { className: "subagent-secondary-text" }, secondary)) : null)));
}
function SubagentList({ subagents }) {
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    if (subagents.length <= MAX_VISIBLE) setExpanded(false);
  }, [subagents.length]);
  if (!subagents || subagents.length === 0) return null;
  const hasOverflow = subagents.length > MAX_VISIBLE;
  const shown = expanded || !hasOverflow ? subagents : subagents.slice(0, MAX_VISIBLE);
  const overflowCount = subagents.length - MAX_VISIBLE;
  return /* @__PURE__ */ React.createElement("div", { className: "subagent-card" }, /* @__PURE__ */ React.createElement("div", { className: "subagent-header" }, /* @__PURE__ */ React.createElement("span", { className: "subagent-header-title" }, "Subagents"), /* @__PURE__ */ React.createElement("span", { className: "subagent-header-badge" }, subagents.length)), /* @__PURE__ */ React.createElement("div", { className: "subagent-list" }, shown.map((info, i) => /* @__PURE__ */ React.createElement(SubagentRow, { key: info.agentId, info, index: i + 1 })), hasOverflow ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "subagent-list-toggle",
      onClick: () => setExpanded((v) => !v)
    },
    expanded ? i18n.k4797988({}, "收起") : `+${overflowCount} more`
  ) : null));
}
class Diff {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
}
class LineDiff extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes("\n")) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes("\n")) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith("\n")) {
        left = left.slice(0, -1);
      }
      if (right.endsWith("\n")) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
}
const lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}
function CodeDiff({
  fileName,
  oldContent,
  newContent
}) {
  const changes = diffLines(oldContent, newContent);
  if (changes.length === 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "code-diff-empty" }, "No changes to display");
  }
  let oldLineNumber = 0;
  let newLineNumber = 0;
  return /* @__PURE__ */ React.createElement("div", { className: "code-diff" }, /* @__PURE__ */ React.createElement("div", { className: "code-diff-header" }, /* @__PURE__ */ React.createElement("span", { className: "code-diff-file-name" }, fileName)), /* @__PURE__ */ React.createElement("div", { className: "code-diff-content" }, /* @__PURE__ */ React.createElement("div", { className: "diff-view" }, changes.map((change, index) => {
    let lineClass = "diff-line";
    if (change.added) lineClass += " diff-add";
    if (change.removed) lineClass += " diff-delete";
    const lines = change.value.split("\n").filter((line) => line !== "");
    return lines.map((line, lineIndex) => {
      let oldLineNum = "";
      let newLineNum = "";
      if (change.removed) {
        oldLineNumber++;
        oldLineNum = oldLineNumber.toString();
      } else if (change.added) {
        newLineNumber++;
        newLineNum = newLineNumber.toString();
      } else {
        oldLineNumber++;
        newLineNumber++;
        oldLineNum = oldLineNumber.toString();
        newLineNum = newLineNumber.toString();
      }
      return /* @__PURE__ */ React.createElement("div", { key: `${index}-${lineIndex}`, className: lineClass }, /* @__PURE__ */ React.createElement("span", { className: "diff-gutter diff-gutter-old" }, change.removed || !change.added ? oldLineNum : ""), /* @__PURE__ */ React.createElement("span", { className: "diff-gutter diff-gutter-new" }, change.added || !change.removed ? newLineNum : ""), /* @__PURE__ */ React.createElement("span", { className: "diff-gutter diff-gutter-sign" }, change.added ? "+" : change.removed ? "-" : " "), /* @__PURE__ */ React.createElement("span", { className: "diff-code" }, line));
    });
  }))));
}
let cached = null;
const listeners = /* @__PURE__ */ new Set();
let initPromise = null;
function ensureInit() {
  if (initPromise) return;
  const bridge = window.islandBridge;
  if (!bridge?.getSettings) return;
  initPromise = bridge.getSettings().then((s) => {
    cached = s.shortcuts ?? DEFAULT_SHORTCUTS;
    listeners.forEach((l) => l(cached));
  }).catch(() => {
    cached = DEFAULT_SHORTCUTS;
    listeners.forEach((l) => l(cached));
  });
  bridge.onSettingsChanged?.((s) => {
    cached = s.shortcuts ?? DEFAULT_SHORTCUTS;
    listeners.forEach((l) => l(cached));
  });
}
function useShortcuts() {
  const [cfg, setCfg] = reactExports.useState(cached ?? DEFAULT_SHORTCUTS);
  reactExports.useEffect(() => {
    ensureInit();
    if (cached) setCfg(cached);
    const listener = (c) => setCfg(c);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return cfg;
}
function modifierGlyph(m) {
  if (m === "Cmd") return "⌘";
  if (m === "Ctrl") return "⌃";
  if (m === "Shift") return "⇧";
  return "⌥";
}
function formatBinding(config, id) {
  const binding = config.bindings[id];
  if (!binding || !binding.enabled || !binding.key) return null;
  if (config.modifiers.length === 0) return null;
  return config.modifiers.map(modifierGlyph).join("") + binding.key;
}
function ApprovalCard({ session }) {
  const req = session.permissionRequest;
  const shortcuts = useShortcuts();
  if (!req) return null;
  const approveHint = formatBinding(shortcuts, "approve");
  const rejectHint = formatBinding(shortcuts, "reject");
  const allowAlwaysHint = formatBinding(shortcuts, "allowAlways");
  const isExitPlanMode = req.toolName === "ExitPlanMode";
  const showAllowAlways = isExitPlanMode || (req.permissionSuggestions?.length ?? 0) > 0;
  const allowAlwaysTooltip = !isExitPlanMode && showAllowAlways ? buildApproveAlwaysTooltip(req) : void 0;
  const mode = req.approvalMode ?? "bridge";
  const isExternal = mode === "terminalNative";
  const isFromTrae = session.tool === "trae" || session.tool === "trae-cn";
  const canJumpToTerminal = !!session.jumpTarget;
  function deny() {
    window.islandBridge?.denySession(session.id);
  }
  function allowOnce() {
    window.islandBridge?.approveSession(session.id, "allowOnce");
  }
  function allowAlways() {
    window.islandBridge?.approveSession(session.id, "allowAlways");
  }
  function jumpToTerminal() {
    window.islandBridge?.jumpToSession(session.id);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "approval-card" }, /* @__PURE__ */ React.createElement("div", { className: "approval-container" }, /* @__PURE__ */ React.createElement("div", { className: "approval-tool" }, req.toolName), !(req.codeDiff && req.codeDiff.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "approval-input island-markdown" }, /* @__PURE__ */ React.createElement(
    Markdown,
    {
      remarkPlugins: [remarkGfm],
      components: {
        a: ({ href, children }) => /* @__PURE__ */ React.createElement(
          "a",
          {
            href,
            onClick: (e) => {
              e.preventDefault();
              if (href) window.islandBridge?.openExternal?.(href);
            }
          },
          children
        )
      }
    },
    req.toolInput
  ))), req.codeDiff && req.codeDiff.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "approval-code-diffs" }, req.codeDiff.map((diff, index) => /* @__PURE__ */ React.createElement(
    CodeDiff,
    {
      key: `${diff.fileName}-${index}`,
      fileName: diff.fileName,
      oldContent: diff.oldContent,
      newContent: diff.newContent
    }
  ))), isExternal ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "approval-note" }, isFromTrae ? i18n.k408497818({}, "请前往 TRAE IDE 中处理此权限请求。") : i18n.k3026826246({}, "由于 Code Agent 权限限制，请在终端的原生审批框中处理这次权限请求。")), /* @__PURE__ */ React.createElement("div", { className: "approval-actions" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "approval-btn jump",
      onClick: jumpToTerminal,
      disabled: !canJumpToTerminal
    },
    isFromTrae ? i18n.k1243075842({}, "前往 TRAE IDE") : canJumpToTerminal ? i18n.k1755521477({}, "前往终端确认") : i18n.k1734251801({}, "等待终端定位")
  ))) : /* @__PURE__ */ React.createElement("div", { className: "approval-actions" }, /* @__PURE__ */ React.createElement("button", { className: "approval-btn deny", onClick: deny }, i18n.k6052010({}, "拒绝"), rejectHint && /* @__PURE__ */ React.createElement("span", { className: "kbd" }, rejectHint)), /* @__PURE__ */ React.createElement("button", { className: "approval-btn allow", onClick: allowOnce }, isExitPlanMode ? i18n.k3627436501({}, "手动采纳编辑") : i18n.k2477555965({}, "允许一次"), approveHint && /* @__PURE__ */ React.createElement("span", { className: "kbd" }, approveHint)), showAllowAlways && /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "approval-btn allow-always",
      onClick: allowAlways,
      "data-tooltip": allowAlwaysTooltip
    },
    isExitPlanMode ? i18n.k3627461236({}, "自动采纳编辑") : i18n.k1008057599({}, "始终允许"),
    allowAlwaysHint && /* @__PURE__ */ React.createElement("span", { className: "kbd" }, allowAlwaysHint)
  )));
}
const emptyDraft = {
  selectedOptions: /* @__PURE__ */ new Set(),
  customSelected: false,
  customText: ""
};
const AGENT_TOOLS_CANCEL_QUESTIONS = ["claude"];
function QuestionCard({
  session
}) {
  const prompt = session.questionPrompt;
  if (!prompt || !prompt.questions) return null;
  const supportsCustomInput = session.tool === "claude" || session.tool === "opencode" || session.tool === "sara";
  const [drafts, setDrafts] = reactExports.useState({});
  function toggleOption(qid, index, isMultiple) {
    setDrafts((prev) => {
      const cur = prev[qid] ?? emptyDraft;
      const next = new Set(isMultiple ? cur.selectedOptions : []);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return {
        ...prev,
        [qid]: {
          ...cur,
          selectedOptions: next,
          customSelected: !isMultiple ? false : cur.customSelected
        }
      };
    });
  }
  function toggleCustom(qid, isMultiple) {
    setDrafts((prev) => {
      const cur = prev[qid] ?? emptyDraft;
      const customSelected = !cur.customSelected;
      return {
        ...prev,
        [qid]: {
          ...cur,
          customSelected,
          selectedOptions: !isMultiple && customSelected ? /* @__PURE__ */ new Set() : cur.selectedOptions
        }
      };
    });
  }
  function setCustomText(qid, text) {
    setDrafts((prev) => ({
      ...prev,
      [qid]: { ...prev[qid] ?? emptyDraft, customText: text }
    }));
  }
  function isOptionSelected(qid, index) {
    return drafts[qid]?.selectedOptions.has(index) ?? false;
  }
  function isCustomSelected(qid) {
    return drafts[qid]?.customSelected ?? false;
  }
  function buildAnswerPayload() {
    const entries = [];
    const questions = prompt?.questions ?? [];
    questions.forEach((q, questionIndex) => {
      const d = drafts[q.id];
      if (!d) return;
      const values = [
        ...[...d.selectedOptions].sort((a, b) => a - b).map((index) => ({ kind: "option", index })),
        ...d.customSelected ? [{ kind: "text", text: d.customText }] : []
      ];
      if (values.length > 0) entries.push({ questionIndex, values });
    });
    return { entries };
  }
  function handleSubmit() {
    window.islandBridge?.answerSession(session.id, buildAnswerPayload());
  }
  function handleCancelQuestion() {
    window.islandBridge?.cancelQuestion(session.id, {});
  }
  const canJumpToTerminal = !!session.jumpTarget;
  const isDisableInCardThenJump2CLI = session.tool === "kimi" || session.tool === "hermes" || session.tool === "copilot-cli" || session.tool === "codex";
  function jumpToTerminal() {
    window.islandBridge?.jumpToSession(session.id);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "question-card" }, /* @__PURE__ */ React.createElement("div", { className: "question-container" }, /* @__PURE__ */ React.createElement("div", { className: "question-header" }, /* @__PURE__ */ React.createElement("span", { className: "question-header-title" }, i18n.k4606587({}, "提问")), /* @__PURE__ */ React.createElement("span", { className: "question-header-count" }, prompt.questions.length)), /* @__PURE__ */ React.createElement("div", { className: "question-list" }, prompt.questions.map((q, qIndex) => {
    const isMultiple = q.type === "multiple";
    return /* @__PURE__ */ React.createElement("div", { key: q.id, className: "question-item" }, /* @__PURE__ */ React.createElement("div", { className: "question-title" }, /* @__PURE__ */ React.createElement("span", { className: "question-title-text" }, /* @__PURE__ */ React.createElement("span", { className: "question-number" }, qIndex + 1, ". "), q.question)), /* @__PURE__ */ React.createElement("div", { className: "question-options" }, q.choices.map((choice, cIndex) => {
      const isSelected = isOptionSelected(q.id, cIndex);
      return /* @__PURE__ */ React.createElement(
        "label",
        {
          key: choice.id,
          className: `question-option ${isSelected ? "is-selected" : ""}`
        },
        /* @__PURE__ */ React.createElement(
          "input",
          {
            type: isMultiple ? "checkbox" : "radio",
            name: q.id,
            value: choice.id,
            checked: isSelected,
            disabled: isDisableInCardThenJump2CLI,
            onChange: () => toggleOption(q.id, cIndex, isMultiple),
            className: "question-native-input"
          }
        ),
        /* @__PURE__ */ React.createElement("span", { className: "question-option-label" }, choice.label)
      );
    }), supportsCustomInput && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "label",
      {
        className: `question-option ${isCustomSelected(q.id) ? "is-selected" : ""}`
      },
      /* @__PURE__ */ React.createElement(
        "input",
        {
          type: isMultiple ? "checkbox" : "radio",
          name: q.id,
          value: "__custom__",
          checked: isCustomSelected(q.id),
          disabled: isDisableInCardThenJump2CLI,
          onChange: () => toggleCustom(q.id, isMultiple),
          className: "question-native-input"
        }
      ),
      /* @__PURE__ */ React.createElement("span", { className: "question-option-label" }, i18n.k2340434329({}, "输入回答"))
    ), isCustomSelected(q.id) && /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "question-custom-input",
        placeholder: i18n.k1881288656({}, "输入自定义答案…"),
        value: drafts[q.id]?.customText ?? "",
        disabled: isDisableInCardThenJump2CLI,
        autoComplete: "off",
        autoCorrect: "off",
        autoCapitalize: "off",
        spellCheck: false,
        onChange: (e) => setCustomText(q.id, e.target.value)
      }
    ))));
  }))), isDisableInCardThenJump2CLI ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "approval-note" }, i18n.k1237460428({}, "由于 Code Agent 限制，请前往终端处理这次问答请求")), /* @__PURE__ */ React.createElement("div", { className: "approval-actions" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "approval-btn jump",
      onClick: jumpToTerminal,
      disabled: !canJumpToTerminal
    },
    canJumpToTerminal ? i18n.k1755521477({}, "前往终端确认") : i18n.k1734251801({}, "等待终端定位")
  ))) : /* @__PURE__ */ React.createElement("div", { className: "question-actions" }, /* @__PURE__ */ React.createElement("button", { className: "question-submit-btn", onClick: handleSubmit }, i18n.k2395458847({}, "提交信息")), AGENT_TOOLS_CANCEL_QUESTIONS.includes(session.tool) && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "question-cancel-btn",
      onClick: handleCancelQuestion
    },
    i18n.k6131227({}, "取消")
  )));
}
function PlanConfirmationCard({
  session
}) {
  const [selectedChoice, setSelectedChoice] = reactExports.useState(null);
  const planConfirmation = session.planConfirmation;
  if (!planConfirmation) return null;
  function handleSubmit() {
    if (!selectedChoice) return;
    window.islandBridge?.confirmPlan(session.id, selectedChoice);
  }
  const canJumpToTerminal = !!session.jumpTarget;
  function jumpToTerminal() {
    window.islandBridge?.jumpToSession(session.id);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-card" }, /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-container" }, /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-header" }, /* @__PURE__ */ React.createElement("span", { className: "plan-confirmation-header-title" }, i18n.k3476981328({}, "等待确认计划"))), /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-content" }, /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-plan" }, planConfirmation.plan), /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-choices" }, /* @__PURE__ */ React.createElement(
    "label",
    {
      className: `plan-confirmation-choice ${selectedChoice === "AGENT" ? "is-selected" : ""}`
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name: "plan-choice",
        value: "AGENT",
        checked: selectedChoice === "AGENT",
        onChange: () => setSelectedChoice("AGENT"),
        className: "plan-confirmation-native-input"
      }
    ),
    /* @__PURE__ */ React.createElement("span", { className: "plan-confirmation-choice-label" }, i18n.k2507976213({}, "同意计划"))
  ), /* @__PURE__ */ React.createElement(
    "label",
    {
      className: `plan-confirmation-choice ${selectedChoice === "FEEDBACK" ? "is-selected" : ""}`
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name: "plan-choice",
        value: "FEEDBACK",
        checked: selectedChoice === "FEEDBACK",
        onChange: () => setSelectedChoice("FEEDBACK"),
        className: "plan-confirmation-native-input"
      }
    ),
    /* @__PURE__ */ React.createElement("span", { className: "plan-confirmation-choice-label" }, i18n.k2507819097({}, "拒绝计划"))
  )))), /* @__PURE__ */ React.createElement("div", { className: "plan-confirmation-actions" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "plan-confirmation-submit-btn",
      onClick: handleSubmit,
      disabled: !selectedChoice
    },
    i18n.k2395458847({}, "提交信息")
  ), canJumpToTerminal && /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "plan-confirmation-jump-btn",
      onClick: jumpToTerminal
    },
    i18n.k3125065045({}, "前往页面确认")
  )));
}
const continueChatIcon = "data:image/svg+xml,%3csvg%20width='12'%20height='12'%20viewBox='0%200%2012%2012'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M1.04554%208.05423C1.12274%208.24896%201.13992%208.46233%201.09489%208.66691L0.535765%2010.3941C0.517749%2010.4817%200.522407%2010.5725%200.549297%2010.6578C0.576187%2010.7431%200.624418%2010.8201%200.689415%2010.8815C0.754412%2010.9429%200.834022%2010.9867%200.920694%2011.0087C1.00737%2011.0308%201.09823%2011.0303%201.18466%2011.0073L2.97649%2010.4834C3.16954%2010.4451%203.36946%2010.4618%203.55346%2010.5317C4.67454%2011.0552%205.9445%2011.166%207.13929%2010.8444C8.33407%2010.5229%209.3769%209.78969%2010.0838%208.7742C10.7906%207.75871%2011.1161%206.52619%2011.0028%205.29409C10.8895%204.062%2010.3447%202.90952%209.46446%202.03998C8.58423%201.17045%207.42517%200.639736%206.19178%200.541487C4.95839%200.443238%203.72993%200.783765%202.72314%201.50299C1.71636%202.22221%200.995943%203.27391%200.689009%204.47252C0.382074%205.67114%200.508344%206.93964%201.04554%208.05423Z'%20stroke='%230C0C0D'%20style='stroke:%230C0C0D;stroke:color(display-p3%200.0471%200.0471%200.0510);stroke-opacity:1;'%20stroke-width='1.05'%20stroke-linecap='round'%20stroke-linejoin='round'/%3e%3c/svg%3e";
function CompletionCard({
  session,
  isFollowUpOpen,
  onCollapse,
  onFollowUpClick
}) {
  const prompt = sanitizeAgentDisplayText(session.latestUserPrompt ?? "");
  const details = session.lastAssistantMessage ?? "";
  const isError = !!session.error;
  const hasContent = isError || !!details;
  const shortcuts = useShortcuts();
  const jumpHint = formatBinding(shortcuts, "jumpToTerminal");
  const canFollowUp = !!onFollowUpClick && canContinueSessionViaTerminalPrompt(session);
  function handleJump() {
    window.islandBridge?.jumpToSession(session.id);
    onCollapse?.();
  }
  return /* @__PURE__ */ React.createElement("div", { className: "completion-card" }, /* @__PURE__ */ React.createElement("div", { className: `completion-container${isError ? " completion-container-error" : ""}` }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `completion-header${hasContent ? "" : " completion-header-no-content"}${isError ? " completion-header-error" : ""}`
    },
    /* @__PURE__ */ React.createElement("div", { className: `completion-title${isError ? " completion-title-error" : ""}` }, isError ? `${i18n.k2930548929({ placeholder1: session.error }, "⚠ 任务异常终止：{placeholder1}")}` : prompt ? `${i18n.k981631581({ placeholder1: prompt }, "你: {placeholder1}")}` : i18n.k2887680449({}, "最新任务已完成"))
  ), hasContent && /* @__PURE__ */ React.createElement("div", { className: "completion-content" }, isError ? /* @__PURE__ */ React.createElement("div", { className: "completion-error-detail" }, session.errorDetail || session.error) : details && /* @__PURE__ */ React.createElement("div", { className: "island-markdown" }, /* @__PURE__ */ React.createElement(Markdown, { remarkPlugins: [remarkGfm], components: { a: ({ href, children }) => /* @__PURE__ */ React.createElement("a", { href, onClick: (e) => {
    e.preventDefault();
    if (href) window.islandBridge?.openExternal?.(href);
  } }, children) } }, details)))), session.jumpTarget && !isFollowUpOpen && /* @__PURE__ */ React.createElement("div", { className: "completion-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "approval-btn completion-jump-btn", onClick: handleJump }, i18n.k6315286({}, "打开"), " ", cleanAppName(session.jumpTarget.app), " ↗", jumpHint && /* @__PURE__ */ React.createElement("span", { className: "kbd" }, jumpHint)), canFollowUp && /* @__PURE__ */ React.createElement("button", { type: "button", className: "approval-btn completion-follow-up-btn", onClick: onFollowUpClick }, /* @__PURE__ */ React.createElement("img", { src: continueChatIcon, alt: "continue chat", className: "completion-follow-up-icon", "aria-hidden": "true" }), i18n.k746418620({}, "继续追问"))));
}
const AUTOMATION_PRIVACY_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";
const TEXTAREA_MIN_HEIGHT = 40;
const TEXTAREA_MAX_HEIGHT = 76;
function continuePromptErrorMessage(result) {
  switch (result.reason) {
    case "automation-denied":
      return {
        text: i18n.k1905081417({}, "需要允许 WorkIsland 控制 Terminal/iTerm，才能继续会话。"),
        showSettings: true
      };
    case "terminal-session-not-found":
      return { text: i18n.k1502991054({}, "未找到对应终端会话。"), showSettings: false };
    case "unsupported":
      return { text: i18n.k3600427917({}, "当前会话不支持通过终端继续。"), showSettings: false };
    default:
      return { text: i18n.k3452160286({}, "继续会话失败。"), showSettings: false };
  }
}
function ContinuePromptInput({
  session,
  autoFocus = true,
  onCancel,
  onSubmitted
}) {
  const textareaRef = React.useRef(null);
  const [text, setText] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [isScrollable, setIsScrollable] = React.useState(false);
  const [continueError, setContinueError] = React.useState(null);
  React.useEffect(() => {
    setText("");
    setIsSending(false);
    setIsScrollable(false);
    setContinueError(null);
  }, [session.id]);
  React.useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus, session.id]);
  React.useEffect(() => {
    if (!continueError) return;
    const timer = window.setTimeout(() => setContinueError(null), 8e3);
    return () => window.clearTimeout(timer);
  }, [continueError]);
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    const nextHeight = Math.min(
      TEXTAREA_MAX_HEIGHT,
      Math.max(TEXTAREA_MIN_HEIGHT, textarea.scrollHeight)
    );
    textarea.style.height = `${nextHeight}px`;
    setIsScrollable(textarea.scrollHeight > TEXTAREA_MAX_HEIGHT);
  }, [text, session.id]);
  function handleOpenAutomationSettings(e) {
    e.stopPropagation();
    window.islandBridge?.openExternal?.(AUTOMATION_PRIVACY_SETTINGS_URL);
  }
  function handleContainerClick(e) {
    e.stopPropagation();
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button")) return;
    textareaRef.current?.focus();
  }
  async function submitPrompt() {
    const prompt = text.trim();
    if (!prompt || isSending) return;
    setIsSending(true);
    setContinueError(null);
    try {
      const continueSessionViaTerminalPrompt = window.islandBridge?.continueSessionViaTerminalPrompt;
      if (!continueSessionViaTerminalPrompt) {
        console.warn("[ContinuePromptInput] continueSessionViaTerminalPrompt unavailable: bridge not ready");
        setContinueError({ text: i18n.k3452160286({}, "继续会话失败。"), showSettings: false });
        return;
      }
      const result = await continueSessionViaTerminalPrompt(session.id, prompt);
      if (!result) {
        console.warn("[ContinuePromptInput] continueSessionViaTerminalPrompt returned empty result");
        setContinueError({ text: i18n.k3452160286({}, "继续会话失败。"), showSettings: false });
        return;
      }
      if (!result?.ok) {
        setContinueError(continuePromptErrorMessage(result));
        return;
      }
      setText("");
      onSubmitted?.();
    } catch (err) {
      console.warn("[ContinuePromptInput] continueSessionViaTerminalPrompt rejected:", err);
      setContinueError({ text: i18n.k3452160286({}, "继续会话失败。"), showSettings: false });
    } finally {
      setIsSending(false);
    }
  }
  function handleSubmit(e) {
    e.preventDefault();
    void submitPrompt();
  }
  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitPrompt();
    }
  }
  const canSubmit = text.trim().length > 0 && !isSending;
  return /* @__PURE__ */ React.createElement("form", { className: "continue-prompt-input", "data-follow-up-input": true, onSubmit: handleSubmit, onClick: handleContainerClick }, /* @__PURE__ */ React.createElement("div", { className: "continue-prompt-content" }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      ref: textareaRef,
      className: "continue-prompt-textarea",
      value: text,
      onChange: (e) => setText(e.target.value),
      onKeyDown: handleKeyDown,
      placeholder: i18n.k3464911708({}, "输入追问内容"),
      disabled: isSending,
      "data-scrollable": isScrollable ? "true" : void 0
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "continue-prompt-footer" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "continue-prompt-cancel-btn",
      disabled: isSending,
      onClick: onCancel
    },
    i18n.k746513288({}, "取消追问")
  ), continueError && /* @__PURE__ */ React.createElement("div", { className: "continue-prompt-error" }, /* @__PURE__ */ React.createElement("span", null, continueError.text), continueError.showSettings && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "continue-prompt-error-action",
      onClick: handleOpenAutomationSettings
    },
    i18n.k1441193026({}, "打开系统设置")
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "continue-prompt-send-btn",
      disabled: !canSubmit,
      "aria-label": i18n.k2395458847({}, "提交信息")
    },
    /* @__PURE__ */ React.createElement(
      "svg",
      {
        className: "continue-prompt-send-icon",
        viewBox: "0 0 16 16",
        "aria-hidden": "true",
        focusable: "false"
      },
      /* @__PURE__ */ React.createElement("path", { d: "M8 13.5V2.5M3.5 7L8 2.5L12.5 7" })
    )
  )));
}
function renderActionableCard(props) {
  const { session, actionableId, isFollowUpOpen, onCollapse, onFollowUpClick } = props;
  if (session.phase === "waitingForApproval")
    return /* @__PURE__ */ React.createElement(ApprovalCard, { session });
  if (session.phase === "waitingForAnswer") {
    if (session.planConfirmation)
      return /* @__PURE__ */ React.createElement(PlanConfirmationCard, { session });
    if (session.questionPrompt)
      return /* @__PURE__ */ React.createElement(QuestionCard, { session });
  }
  if (session.phase === "completed" && session.id === actionableId)
    return /* @__PURE__ */ React.createElement(
      CompletionCard,
      {
        session,
        isFollowUpOpen,
        onCollapse,
        onFollowUpClick
      }
    );
  return null;
}
function IslandPanel({
  sessions,
  surface,
  notchHeight,
  panelMaxHeightPx,
  agentQuotas,
  hasUpdate,
  tokenBurnTotal,
  pillFirstRow,
  mediaState,
  lyricsState,
  mediaEnabled = true,
  performanceState,
  performanceEnabled = true,
  fileShelfEnabled = true,
  clipboardHistoryEnabled = false,
  terminalEnabled = true,
  terminalSavedCommands = [],
  requestedToolboxModule = null,
  onSessionRowClick,
  onOpenSettings,
  onOpenAbout,
  onOpenPet,
  onCollapse,
  onFollowUpChange,
  onActiveModuleChange
}) {
  const [followUpSessionId, setFollowUpSessionId] = React.useState(null);
  const [activeModule, setActiveModule] = React.useState("agent");
  const enabledModules = enabledToolboxModules({ fileShelfEnabled, clipboardHistoryEnabled, terminalEnabled });
  const agentAttention = Boolean(surface?.actionableSessionId) || sessions.some((session) => ["waitingForApproval", "waitingForAnswer", "failed"].includes(session.phase));
  React.useEffect(() => {
    setActiveModule((current) => selectToolboxModule({ current, attention: agentAttention, enabled: enabledModules }));
  }, [agentAttention, fileShelfEnabled, clipboardHistoryEnabled, terminalEnabled]);
  React.useEffect(() => {
    onActiveModuleChange?.(activeModule);
  }, [activeModule, onActiveModuleChange]);
  React.useEffect(() => {
    if (!agentAttention && requestedToolboxModule?.id && enabledModules.includes(requestedToolboxModule.id)) {
      setActiveModule(requestedToolboxModule.id);
    }
  }, [requestedToolboxModule, agentAttention, enabledModules.join("|")]);
  const { actionableId, actionableRef, visibleSessions } = useActionable(sessions, surface, {
    disableScroll: !!followUpSessionId
  });
  const sessionListRef = React.useRef(null);
  const followUpRef = React.useRef(null);
  const panelStyle = {
    "--island-panel-max-height": `${panelMaxHeightPx}px`,
    "--island-safe-top-inset": `${Math.max(0, notchHeight)}px`
  };
  React.useEffect(() => {
    if (!followUpSessionId) return;
    const followUpSession = visibleSessions.find((session) => session.id === followUpSessionId);
    if (!followUpSession || followUpSession.phase !== "completed" || !canContinueSessionViaTerminalPrompt(followUpSession)) {
      setFollowUpSessionId(null);
    }
  }, [followUpSessionId, visibleSessions]);
  React.useEffect(() => {
    onFollowUpChange?.(followUpSessionId !== null);
  }, [followUpSessionId, onFollowUpChange]);
  React.useEffect(() => {
    if (!followUpSessionId) return;
    const frame = requestAnimationFrame(() => {
      if (followUpRef.current && sessionListRef.current) {
        const container = sessionListRef.current;
        const item = followUpRef.current;
        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        const absoluteItemTop = container.scrollTop + (itemRect.top - containerRect.top);
        let targetTop = absoluteItemTop - 16;
        const expectedVisibleBottom = targetTop + container.clientHeight - 16;
        const actualItemBottom = absoluteItemTop + item.offsetHeight;
        if (actualItemBottom > expectedVisibleBottom) {
          targetTop = actualItemBottom - container.clientHeight + 16;
        }
        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth"
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [followUpSessionId]);
  return /* @__PURE__ */ React.createElement("div", { className: "panel", style: panelStyle }, /* @__PURE__ */ React.createElement(
    AgentUsageRow,
    {
      agentQuotas,
      notchHeight,
      hasUpdate,
      tokenBurnTotal,
      visibleSessionIds: visibleSessions.map((session) => session.id),
      pillFirstRow,
      performanceState,
      performanceEnabled,
      enabledToolboxModules: enabledModules,
      activeToolboxModule: activeModule,
      onToolboxModuleChange: setActiveModule,
      onOpenSettings,
      onOpenAbout,
      onOpenPet
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "panel-divider" }), activeModule === "shelf" && /* @__PURE__ */ React.createElement(ShelfPanel), activeModule === "clipboard" && /* @__PURE__ */ React.createElement(ClipboardPanel), activeModule === "terminal" && /* @__PURE__ */ React.createElement(TerminalPanel, { savedCommands: terminalSavedCommands, onOpenSettings: () => onOpenSettings("general") }), /* @__PURE__ */ React.createElement("div", { className: `workspace-content${mediaEnabled && mediaState?.active && mediaState?.title ? " has-media" : ""}${activeModule === "agent" ? "" : " is-hidden"}` }, mediaEnabled && mediaState?.active && mediaState?.title && /* @__PURE__ */ React.createElement(MediaCard, { media: mediaState, lyrics: lyricsState }), /* @__PURE__ */ React.createElement("div", { className: "workspace-agent-pane" }, /* @__PURE__ */ React.createElement("div", { className: "session-list", ref: sessionListRef }, visibleSessions.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "session-list-empty" }, /* @__PURE__ */ React.createElement(
    "img",
    {
      className: "session-list-empty-icon",
      src: defaultIcon,
      alt: "",
      draggable: false
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "session-list-empty-text" }, i18n.k1005597952({}, "暂无会话"))) : visibleSessions.map((session) => {
    const canFollowUp = session.phase === "completed" && canContinueSessionViaTerminalPrompt(session);
    const isFollowUpOpen = followUpSessionId === session.id && canFollowUp;
    const openFollowUp = canFollowUp ? () => setFollowUpSessionId(session.id) : void 0;
    const actionableCard = renderActionableCard({
      session,
      actionableId,
      isFollowUpOpen,
      onCollapse,
      onFollowUpClick: openFollowUp
    });
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: session.id,
        ref: (node) => {
          if (session.id === actionableId && actionableRef && "current" in actionableRef) {
            actionableRef.current = node;
          }
          if (isFollowUpOpen && followUpRef) {
            followUpRef.current = node;
          }
        }
      },
      /* @__PURE__ */ React.createElement("div", { className: "session-row-container" }, /* @__PURE__ */ React.createElement(
        SessionRow,
        {
          session,
          isActive: session.id === actionableId,
          isFollowUpOpen,
          onClick: onSessionRowClick ? () => onSessionRowClick(session.id) : void 0,
          onFollowUpClick: openFollowUp
        }
      ), session.activeSubagents && session.activeSubagents.length > 0 && /* @__PURE__ */ React.createElement(SubagentList, { subagents: session.activeSubagents }), (actionableCard || isFollowUpOpen) && /* @__PURE__ */ React.createElement("div", { className: "session-action-area" }, actionableCard, isFollowUpOpen && /* @__PURE__ */ React.createElement(
        ContinuePromptInput,
        {
          session,
          onCancel: () => setFollowUpSessionId(null),
          onSubmitted: () => setFollowUpSessionId(null)
        }
      )))
    );
  })))));
}
export {
  AgentToolBadge as A,
  IslandPanel as I,
  PHASE_ICON as P,
  SubagentList as S,
  approvalIcon as b,
  completeIcon as c,
  defaultIcon as d,
  renderActionableCard as e,
  runningIcon as r,
  stripCwd as s,
  useActionable as u
};
