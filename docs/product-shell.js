(function () {
  "use strict";

  var root = document.documentElement;

  function preferredTheme() {
    try {
      var saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // Use the system preference when storage is unavailable.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function syncThemeButton(button) {
    if (!button) return;
    var dark = root.dataset.theme === "dark";
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    var icon = button.querySelector("i");
    if (icon) icon.className = dark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }

  function setTheme(theme, button) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Theme selection remains active for the current page.
    }
    syncThemeButton(button);
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  function bindThemeControl() {
    var button = document.getElementById("themeToggle");
    if (!button || button.dataset.siteShellBound === "true") return;
    button.dataset.siteShellBound = "true";
    syncThemeButton(button);
    button.addEventListener("click", function () {
      setTheme(root.dataset.theme === "dark" ? "light" : "dark", button);
    });
  }

  function observeThemeControl() {
    if (!document.body || typeof MutationObserver === "undefined") return;
    new MutationObserver(bindThemeControl).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function initializeThemeControl() {
    bindThemeControl();
    observeThemeControl();
  }

  root.dataset.theme = root.dataset.theme === "dark" || root.dataset.theme === "light"
    ? root.dataset.theme
    : preferredTheme();

  if (document.body) initializeThemeControl();
  else document.addEventListener("DOMContentLoaded", initializeThemeControl);
})();
