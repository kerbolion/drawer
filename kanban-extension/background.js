const appUrl=chrome.runtime.getURL('kanban.html')

async function abrirKanban(){
  let tabs=await chrome.tabs.query({url:appUrl})
  let tab=tabs[0]

  if(!tab){
    await chrome.tabs.create({url:appUrl})
    return
  }

  await chrome.tabs.update(tab.id,{active:true})

  if(tab.windowId)
    await chrome.windows.update(
      tab.windowId,
      {focused:true}
    )
}

chrome.action.onClicked.addListener(()=>{
  void abrirKanban()
})

chrome.runtime.onInstalled.addListener(details=>{
  if(
    details.reason==='install' ||
    details.reason==='update'
  )
    void abrirKanban()
})
