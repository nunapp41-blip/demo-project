const status=document.getElementById('status');
chrome.runtime.sendMessage({type:'CP_STATUS'},response=>{
  status.textContent=response?.ok
    ? 'Ready. Open any YouTube watch page to see public scorecard data.'
    : (chrome.runtime.lastError?.message||'CreatorPulse could not start. Reload the extension in Chrome.');
});
