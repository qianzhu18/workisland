function copySourceText(source) {
  if (!source) return "";
  if (source instanceof HTMLTemplateElement) return source.content.textContent.trim();
  return source.textContent.trim();
}

document.querySelectorAll("[data-copy-for-ai]").forEach((button) => {
  const source = document.getElementById(button.dataset.copySource);
  const status = button.parentElement?.querySelector("[data-copy-status]");
  const label = button.dataset.copyLabel || button.textContent.trim();
  const done = button.dataset.copyDone || "Copied";
  const success = button.dataset.copySuccess || "Copied.";
  const failure = button.dataset.copyFailure || "Copy failed. Open the brief and copy it manually.";
  const text = copySourceText(source);

  if (!text || !navigator.clipboard?.writeText) {
    button.hidden = true;
    return;
  }

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = done;
      if (status) status.textContent = success;
    } catch {
      button.textContent = label;
      if (status) status.textContent = failure;
      return;
    }

    window.setTimeout(() => {
      button.textContent = label;
      if (status) status.textContent = "";
    }, 2200);
  });
});
