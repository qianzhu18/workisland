const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const scenes = {
  overview: {
    caption: "真实使用界面：一边控着音乐，一边盯着 Agent 会话与额度。",
    image: "assets/demo/overview.png?v=20260906",
    alt: "真实 WorkIsland 界面：音乐播放控制与 ZCode 会话同屏显示",
    duration: 4300
  },
  approval: {
    caption: "真实审批界面：文件差异、拒绝与允许操作一起出现。",
    image: "assets/demo/approval.png",
    alt: "真实 WorkIsland 审批界面：允许或拒绝一次文件写入",
    duration: 5300
  },
  ask: {
    caption: "真实提问界面：在 Island 里选择答案，不必回到终端找问题。",
    image: "assets/demo/question.png",
    alt: "真实 WorkIsland 提问界面：选择首页行动按钮文案",
    duration: 5300
  },
  jump: {
    caption: "真实完成状态：会话保留 Ghostty 回源标记，点击即可回到原上下文。",
    image: "assets/demo/jump.png",
    alt: "真实 WorkIsland 完成界面：任务完成并标记 Ghostty 回源目标",
    duration: 4600
  }
};

const sceneNames = Object.keys(scenes);
const notch = document.querySelector(".vi-notch");
const sceneCaption = document.querySelector("[data-scene-caption]");
const realDemoImage = document.querySelector("[data-real-demo-image]");
let activeScene = "overview";
let sceneTimer;

function activateScene(name, { schedule = true } = {}) {
  const next = scenes[name] ? name : "overview";
  activeScene = next;

  if (notch) notch.dataset.scene = next;
  document.querySelectorAll("[data-scene-panel]").forEach((panel) => {
    panel.classList.toggle("vi-scene-on", panel.dataset.scenePanel === next);
  });
  document.querySelectorAll(".vi-scene-pill").forEach((control) => {
    const isActive = control.dataset.scene === next;
    control.classList.toggle("vi-scene-active", isActive);
    control.classList.toggle("vi-tl-active", isActive && schedule && !prefersReducedMotion);
    control.setAttribute("aria-selected", String(isActive));
  });
  if (sceneCaption) sceneCaption.textContent = scenes[next].caption;
  if (realDemoImage && realDemoImage.dataset.demoScene !== next) {
    realDemoImage.dataset.demoScene = next;
    realDemoImage.classList.add("vi-demo-swapping");
    realDemoImage.src = scenes[next].image;
    realDemoImage.alt = scenes[next].alt;
    realDemoImage.addEventListener("load", () => {
      realDemoImage.classList.remove("vi-demo-swapping");
    }, { once: true });
  }

  window.clearTimeout(sceneTimer);
  if (!schedule || prefersReducedMotion) return;
  sceneTimer = window.setTimeout(() => {
    const currentIndex = sceneNames.indexOf(activeScene);
    activateScene(sceneNames[(currentIndex + 1) % sceneNames.length]);
  }, scenes[next].duration);
}

document.querySelectorAll(".vi-scene-pill").forEach((button) => {
  button.addEventListener("click", () => activateScene(button.dataset.scene));
});

const demo = document.querySelector(".vi-demo-section");
if (demo) {
  demo.addEventListener("mouseenter", () => window.clearTimeout(sceneTimer));
  demo.addEventListener("mouseleave", () => activateScene(activeScene));
  demo.addEventListener("focusin", () => window.clearTimeout(sceneTimer));
  demo.addEventListener("focusout", () => activateScene(activeScene));
}

const tourScenes = {
  connect: {
    index: "01 / 03",
    title: "连接你已经在用的 Agent",
    description: "打开 WorkIsland 后，它通过本地连接器读取真实的任务事件。没有连接成功，不会伪造一个“已完成”的状态给你看。",
    image: "assets/demo/overview.png?v=20260906",
    alt: "真实 WorkIsland 总览界面",
    windowTitle: "连接到 Codex",
    windowCopy: "识别本机的真实任务状态",
    islandTitle: "已经准备好",
    islandCopy: "连接器已在本机运行",
    orb: "⌁",
    badge: "✓"
  },
  flow: {
    index: "02 / 03",
    title: "离开终端，任务仍然可见",
    description: "当多个任务并行推进，Island 只显示最相关的状态。你可以阅读、开会或继续下一件事，而不是轮流检查每一个终端。",
    image: "assets/demo/overview.png?v=20260906",
    alt: "真实 WorkIsland 多任务总览界面",
    windowTitle: "3 个任务正在运行",
    windowCopy: "release-check · launch-flow · settings-ui",
    islandTitle: "后台工作仍在推进",
    islandCopy: "Claude Code · 64%",
    orb: "◉",
    badge: "64%"
  },
  act: {
    index: "03 / 03",
    title: "遇到关键节点，再回来处理",
    description: "需要审批、回答或检查结果时，WorkIsland 会带着准确的上下文出现。处理完后，一键回到原会话继续工作。",
    image: "assets/demo/approval.png",
    alt: "真实 WorkIsland 审批界面",
    windowTitle: "等待你的确认",
    windowCopy: "允许 Agent 更新 session-policy.cjs",
    islandTitle: "Codex 请求确认",
    islandCopy: "需要你决定下一步",
    orb: "!",
    badge: "处理"
  }
};

function setTourScene(name) {
  const scene = tourScenes[name] || tourScenes.connect;
  const stage = document.querySelector("[data-tour-stage]");
  if (stage) stage.dataset.tourStage = name;
  const tourImage = document.querySelector("[data-tour-image]");
  if (tourImage && tourImage.dataset.tourScene !== name) {
    tourImage.dataset.tourScene = name;
    tourImage.classList.add("vi-tour-image-swapping");
    tourImage.src = scene.image;
    tourImage.alt = scene.alt;
    tourImage.addEventListener("load", () => {
      tourImage.classList.remove("vi-tour-image-swapping");
    }, { once: true });
  }

  const values = [
    ["[data-tour-index]", scene.index],
    ["[data-tour-title]", scene.title],
    ["[data-tour-description]", scene.description],
    ["[data-tour-window-title]", scene.windowTitle],
    ["[data-tour-window-copy]", scene.windowCopy],
    ["[data-tour-island-title]", scene.islandTitle],
    ["[data-tour-island-copy]", scene.islandCopy],
    ["[data-tour-orb]", scene.orb],
    ["[data-tour-island-badge]", scene.badge]
  ];
  values.forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  });
  document.querySelectorAll("[data-tour-tab]").forEach((button) => {
    const isActive = button.dataset.tourTab === name;
    button.classList.toggle("vi-tour-tab-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

document.querySelectorAll("[data-tour-tab]").forEach((button) => {
  button.addEventListener("click", () => setTourScene(button.dataset.tourTab));
});

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("vi-revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .13 })
  : null;

document.querySelectorAll(".vi-reveal").forEach((element) => {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("vi-revealed");
});

const nav = document.querySelector(".vi-nav");
const updateNav = () => nav?.classList.toggle("scrolled", window.scrollY > 20);
window.addEventListener("scroll", updateNav, { passive: true });
updateNav();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearTimeout(sceneTimer);
  else activateScene(activeScene);
});

activateScene("overview");
setTourScene("connect");

// Umami 事件埋点：下载转化与 GitHub 外链点击。统计脚本未加载时静默跳过。
function trackEvent(name, data) {
  try { window.umami?.track(name, data); } catch { /* 统计失败不影响站点 */ }
}
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a");
  if (!link) return;
  if (link.hasAttribute("data-download-link")) trackEvent("download_click", { to: link.href });
  else if ((link.href || "").startsWith("https://github.com/")) trackEvent("github_click", { to: link.href });
});
