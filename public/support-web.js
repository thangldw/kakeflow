(function () {
  if (location.origin !== 'https://thangldw.github.io' || !location.pathname.startsWith('/kakeflow/app/')) return;
  var link = document.createElement('a');
  link.href = 'https://thangldw.github.io/kakeflow/#support';
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = 'Fuel my next build';
  link.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100;padding:9px 13px;border:0;border-radius:14px;background:#f08804;color:#fff;font:600 12px system-ui;text-decoration:none';
  document.body.appendChild(link);
})();
