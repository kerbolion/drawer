import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "kanban-extension");
const source = await readFile(path.join(root, "kanban.html"), "utf8");
const scriptMatch = source.match(/<script>([\s\S]*?)<\/script>/);

if (!scriptMatch) throw new Error("kanban.html no contiene un script integrado");

const html = source.replace(
  scriptMatch[0],
  '<script src="kanban.js"></script>'
);

const manifest = {
  manifest_version: 3,
  name: "Kanban",
  short_name: "Kanban",
  description: "Tableros Kanban locales, limpios y fluidos.",
  version: "1.0.0",
  permissions: ["storage", "tabs"],
  background: {
    service_worker: "background.js"
  },
  action: {
    default_title: "Abrir Kanban"
  }
};

const background = `const appUrl=chrome.runtime.getURL('kanban.html')

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
`;

await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(path.join(output, "background.js"), background),
  writeFile(path.join(output, "kanban.html"), html),
  writeFile(path.join(output, "kanban.js"), `${scriptMatch[1].trim()}\n`)
]);

console.log(`Extension Kanban creada en ${output}`);
