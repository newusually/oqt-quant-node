  function boot() {
    css();
    if (!buildSkeleton()) return;
    renderTabs();
    renderSort();
    load();
    loadAI();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(load, 3000);
    if (aiTimer) clearInterval(aiTimer);
    aiTimer = setInterval(loadAI, 60000);   // AI 结论 1 分钟轮询即可
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  global.FlowTrack = { boot: boot };