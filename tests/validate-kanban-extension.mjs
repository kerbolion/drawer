import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].find(existsSync);

if (!chrome) throw new Error("No se encontro Google Chrome");

const extensionDir = path.resolve(import.meta.dirname, "..", "kanban-extension");
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function connect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let id = 0;

    socket.addEventListener("open", () => resolve({
      evaluate(expression) {
        return new Promise((commandResolve, commandReject) => {
          const commandId = ++id;
          pending.set(commandId, { resolve: commandResolve, reject: commandReject, expression });
          socket.send(JSON.stringify({
            id: commandId,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true, awaitPromise: true }
          }));
        });
      },
      reload() {
        socket.send(JSON.stringify({ id: ++id, method: "Page.reload", params: {} }));
      },
      close() {
        socket.close();
      }
    }));

    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const current = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) current.reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        current.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else current.resolve(message.result?.result?.value);
    });

    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

async function waitForKanban(port, webPort) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === "page" && target.url === `http://127.0.0.1:${webPort}/kanban.html`);
      if (page) return page;
    } catch {}
    await delay(200);
  }
  throw new Error("La extension no abrio kanban.html");
}

const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage", "tabs"])) {
  throw new Error(`Permisos inesperados: ${JSON.stringify(manifest.permissions)}`);
}

const files = await Promise.all([
  readFile(path.join(extensionDir, "kanban.html"), "utf8"),
  readFile(path.join(extensionDir, "kanban.js"), "utf8"),
  readFile(path.join(extensionDir, "background.js"), "utf8")
]);

if (files.some(file => file.includes("localStorage"))) {
  throw new Error("La extension conserva referencias a localStorage");
}

if (
  !files[2].includes("chrome.action.onClicked") ||
  !files[2].includes("chrome.tabs.query({url:appUrl})") ||
  !files[2].includes("chrome.tabs.update(tab.id,{active:true})")
) {
  throw new Error("El boton de la extension no reutiliza y enfoca la pestaña del Kanban");
}

const chromeStorageMock = `globalThis.chrome={storage:{local:{
  async get(keys){
    let stored=JSON.parse(sessionStorage.getItem('__chrome_storage__') || '{}')
    return Object.fromEntries((keys || Object.keys(stored)).filter(key=>key in stored).map(key=>[key,stored[key]]))
  },
  async set(values){
    let stored=JSON.parse(sessionStorage.getItem('__chrome_storage__') || '{}')
    sessionStorage.setItem('__chrome_storage__',JSON.stringify({...stored,...values}))
  }
}}}`;

const webPort = await freePort();
const webServer = http.createServer(async (request, response) => {
  if (request.url === "/chrome-storage-mock.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(chromeStorageMock);
    return;
  }

  if (request.url === "/kanban.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(files[1]);
    return;
  }

  if (request.url === "/kanban.html") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(files[0].replace(
      '<script src="kanban.js"></script>',
      '<script src="chrome-storage-mock.js"></script><script src="kanban.js"></script>'
    ));
    return;
  }

  response.statusCode = 404;
  response.end("Not found");
});
await new Promise((resolve, reject) => webServer.listen(webPort, "127.0.0.1", resolve).once("error", reject));

const debugPort = await freePort();
const profileDir = path.join(os.tmpdir(), `kanban-extension-${process.pid}-${Date.now()}`);
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--window-size=900,500",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `http://127.0.0.1:${webPort}/kanban.html`
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  const target = await waitForKanban(debugPort, webPort);
  cdp = await connect(target.webSocketDebuggerUrl);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await cdp.evaluate("document.readyState === 'complete' && document.querySelectorAll('.column').length === 3")) break;
    await delay(100);
  }

  const result = await cdp.evaluate(`(async()=>{
    scrollTo(0,250)
    let initialScroll=scrollY
    let initialCards=document.querySelectorAll('.card').length
    document.querySelector('.add-card').click()
    await new Promise(resolve=>setTimeout(resolve,80))
    let createScroll=scrollY
    let afterCreate=document.querySelectorAll('.card').length

    scrollTo(0,250)
    let moveScrollBefore=scrollY
    let moveHeightBefore=document.documentElement.scrollHeight
    let viewportHeight=innerHeight
    let card=[...document.querySelectorAll('.card:not([contenteditable="true"])')]
      .find(item=>{
        let rect=item.getBoundingClientRect()
        return rect.top>=0 && rect.bottom<=innerHeight
      })
    let sourceColumn=card.closest('.column')
    let targetColumn=[...document.querySelectorAll('.column')]
      .find(column=>column!==sourceColumn)
    let target=targetColumn.querySelector('.cards')
    let movedCard=card.innerHTML
    let targetTitle=targetColumn.querySelector('h3').innerHTML
    let targetRect=target.getBoundingClientRect()
    let transfer=new DataTransfer()
    card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}))
    target.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientY:Math.min(
        innerHeight-40,
        Math.max(40,targetRect.top+120)
      ),
      dataTransfer:transfer
    }))
    card.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:transfer}))
    await new Promise(resolve=>setTimeout(resolve,80))
    let moveScrollAfter=scrollY
    let moveHeightAfter=document.documentElement.scrollHeight
    let stored=await chrome.storage.local.get(['kanban-data'])
    document.querySelector('[data-theme-toggle]').click()
    await new Promise(resolve=>setTimeout(resolve,20))
    let storedTheme=(await chrome.storage.local.get(['minimal-builder-theme']))['minimal-builder-theme']

    return {
      initialScroll,
      createScroll,
      moveScrollBefore,
      moveScrollAfter,
      moveHeightBefore,
      moveHeightAfter,
      viewportHeight,
      initialCards,
      afterCreate,
      storedCards:stored['kanban-data'].workspaces[0].board.reduce((total,column)=>total+column.cards.length,0),
      moveStored:stored['kanban-data'].workspaces[0].board.some(column=>column.title===targetTitle && column.cards.includes(movedCard)),
      movedCard,
      targetTitle,
      storedTheme
    }
  })()`);

  if (
    result.initialScroll !== result.createScroll ||
    result.moveScrollBefore !== result.moveScrollAfter
  ) {
    throw new Error(`El scroll general salto: ${JSON.stringify(result)}`);
  }

  if (
    result.afterCreate !== result.initialCards + 1 ||
    result.storedCards !== result.afterCreate ||
    !result.moveStored ||
    !["light", "dark"].includes(result.storedTheme)
  ) {
    throw new Error(`chrome.storage.local no recibio el tablero completo: ${JSON.stringify(result)}`);
  }

  cdp.reload();
  await delay(500);
  const restored = await cdp.evaluate(`({
    cards:document.querySelectorAll('.card').length,
    moveRestored:[...document.querySelectorAll('.column')].some(column=>
      column.querySelector('h3').innerHTML===${JSON.stringify(result.targetTitle)} &&
      [...column.querySelectorAll('.card')].some(card=>card.innerHTML===${JSON.stringify(result.movedCard)})
    ),
    theme:document.documentElement.dataset.theme
  })`);
  if (
    restored.cards !== result.afterCreate ||
    !restored.moveRestored ||
    restored.theme !== result.storedTheme
  ) {
    throw new Error(`El tablero no se restauro al recargar: ${JSON.stringify(restored)}`);
  }

  const copiedMultilineCard = await cdp.evaluate(`(async()=>{
    let copied=''
    let card=document.querySelector('#kanban .card')
    let original=card.innerHTML

    Object.defineProperty(navigator,'clipboard',{
      configurable:true,
      value:{writeText:async text=>{copied=text}}
    })
    card.innerHTML='Linea 1<div>Linea 2</div><div>Linea 3</div>'
    card.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:50,
      clientY:50
    }))
    document.querySelector('#copy-context').click()
    await new Promise(resolve=>setTimeout(resolve,20))
    card.innerHTML=original

    return copied
  })()`);

  if (copiedMultilineCard !== 'Linea 1\nLinea 2\nLinea 3') {
    throw new Error(`El portapapeles perdio los saltos de linea: ${JSON.stringify(copiedMultilineCard)}`);
  }

  const cardDrop = await cdp.evaluate(`(async()=>{
    let source=document.querySelector('#kanban .card')
    let sourceColumn=source.closest('.column')
    let targetColumn=[...document.querySelectorAll('#kanban > .column')]
      .find(column=>column!==sourceColumn)
    let target=targetColumn.querySelector('.cards')
    let targetCards=[...target.querySelectorAll('.card')]
    let hovered=targetCards[0]
    let content=source.innerHTML
    let targetTitle=targetColumn.querySelector('h3').innerHTML
    let before=[...target.querySelectorAll('.card')].map(card=>card.innerHTML)
    let transfer=new DataTransfer()
    let rect=hovered.getBoundingClientRect()

    source.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    target.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top-2,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    rect=hovered.getBoundingClientRect()
    target.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+2,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))

    let during=[...target.children]
      .filter(item=>!item.classList.contains('card-drag-source'))
      .map(item=>
        item.classList.contains('card-placeholder')
          ? '__placeholder__'
          : item.innerHTML
      )
    let sourceHidden=source.classList.contains('card-drag-source')

    source.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let after=[...target.querySelectorAll('.card')].map(card=>card.innerHTML)
    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    let board=stored.workspaces.find(workspace=>workspace.id===stored.activeWorkspace).board
    let storedTarget=board.find(column=>column.title===targetTitle)

    return {
      before,
      during,
      after,
      stored:storedTarget.cards,
      content,
      sourceHidden,
      placeholderCleared:!document.querySelector('.card-placeholder'),
      sourceRestored:!document.querySelector('.card-drag-source')
    }
  })()`);

  const expectedCardOrder = [
    cardDrop.before[0],
    cardDrop.content,
    ...cardDrop.before.slice(1)
  ];
  const expectedCardPreview = [
    cardDrop.before[0],
    '__placeholder__',
    ...cardDrop.before.slice(1)
  ];

  if (
    JSON.stringify(cardDrop.during) !== JSON.stringify(expectedCardPreview) ||
    JSON.stringify(cardDrop.after) !== JSON.stringify(expectedCardOrder) ||
    JSON.stringify(cardDrop.stored) !== JSON.stringify(expectedCardOrder) ||
    !cardDrop.sourceHidden ||
    !cardDrop.placeholderCleared ||
    !cardDrop.sourceRestored
  ) {
    throw new Error(`La insercion de tarjeta no se aplico al soltar: ${JSON.stringify(cardDrop)}`);
  }

  const columnDrop = await cdp.evaluate(`(async()=>{
    let columns=[...document.querySelectorAll('#kanban > .column')]
    let source=columns[0]
    let target=columns[2]
    let title=column=>column.querySelector('h3').textContent.trim()
    let before=columns.map(title)
    let transfer=new DataTransfer()
    let rect=target.getBoundingClientRect()

    source.querySelector('h3').dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    target.querySelector('.cards').dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+rect.height/2,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))

    let during=[...document.querySelector('#kanban').children]
      .filter(item=>!item.classList.contains('column-drag-source'))
      .map(item=>
        item.classList.contains('column-placeholder')
          ? '__placeholder__'
          : title(item)
      )
    let sourceHidden=source.classList.contains('column-drag-source')

    source.querySelector('h3').dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let after=[...document.querySelectorAll('#kanban > .column')].map(title)
    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    let board=stored.workspaces.find(workspace=>workspace.id===stored.activeWorkspace).board

    return {
      before,
      during,
      after,
      stored:board.map(column=>column.title.replace(/<[^>]+>/g,'').trim()),
      sourceHidden,
      placeholderCleared:!document.querySelector('.column-placeholder'),
      sourceRestored:!document.querySelector('.column-drag-source')
    }
  })()`);

  const expectedColumnOrder = [
    columnDrop.before[1],
    columnDrop.before[2],
    columnDrop.before[0]
  ];
  const expectedColumnPreview = [
    columnDrop.before[1],
    columnDrop.before[2],
    '__placeholder__'
  ];

  if (
    JSON.stringify(columnDrop.during) !== JSON.stringify(expectedColumnPreview) ||
    JSON.stringify(columnDrop.after) !== JSON.stringify(expectedColumnOrder) ||
    JSON.stringify(columnDrop.stored) !== JSON.stringify(expectedColumnOrder) ||
    !columnDrop.sourceHidden ||
    !columnDrop.placeholderCleared ||
    !columnDrop.sourceRestored
  ) {
    throw new Error(`La insercion de columna no se aplico al soltar: ${JSON.stringify(columnDrop)}`);
  }

  const deletion = await cdp.evaluate(`(async()=>{
    let initialCards=document.querySelectorAll('.card').length
    let initialColumns=document.querySelectorAll('.column').length
    let card=document.querySelector('.card')
    card.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:50,
      clientY:50
    }))
    let cardMenu=document.querySelector('#delete-context').textContent.trim()
    document.querySelector('#delete-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let cardModal=document.querySelector('#confirm-title').textContent.trim()
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let column=document.querySelector('.column:last-child')
    column.querySelector('h3').dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:70,
      clientY:70
    }))
    let columnMenu=document.querySelector('#delete-context').textContent.trim()
    document.querySelector('#delete-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let columnModal=document.querySelector('#confirm-title').textContent.trim()
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let cards=document.querySelectorAll('.card').length
    let columns=document.querySelectorAll('.column').length
    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    let board=stored.workspaces.find(workspace=>workspace.id===stored.activeWorkspace).board

    return {
      initialCards,
      initialColumns,
      cards,
      columns,
      storedCards:board.reduce((total,item)=>total+item.cards.length,0),
      storedColumns:board.length,
      cardMenu,
      cardModal,
      columnMenu,
      columnModal
    }
  })()`);

  if (
    deletion.cards >= deletion.initialCards ||
    deletion.columns !== deletion.initialColumns - 1 ||
    deletion.storedCards !== deletion.cards ||
    deletion.storedColumns !== deletion.columns ||
    deletion.cardMenu !== "Eliminar tarjeta" ||
    deletion.cardModal !== "Eliminar tarjeta" ||
    deletion.columnMenu !== "Eliminar columna" ||
    deletion.columnModal !== "Eliminar columna"
  ) {
    throw new Error(`El menu contextual no elimino correctamente: ${JSON.stringify(deletion)}`);
  }

  cdp.reload();
  await delay(500);
  const deletionRestored = await cdp.evaluate(`({
    cards:document.querySelectorAll('.card').length,
    columns:document.querySelectorAll('.column').length
  })`);
  if (
    deletionRestored.cards !== deletion.cards ||
    deletionRestored.columns !== deletion.columns
  ) {
    throw new Error(`Las eliminaciones no persistieron: ${JSON.stringify({ deletion, deletionRestored })}`);
  }

  const boardDeletion = await cdp.evaluate(`(async()=>{
    let initialWorkspaces=document.querySelectorAll('.workspace-tab').length
    document.querySelector('.add-workspace').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    document.querySelector('#confirm-input').value='Tablero temporal'
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let createdWorkspaces=document.querySelectorAll('.workspace-tab').length
    let active=document.querySelector('.workspace-tab.active')
    let deletedId=active.dataset.workspace
    active.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:60,
      clientY:30
    }))
    let menu=document.querySelector('#delete-context').textContent.trim()
    document.querySelector('#delete-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let modal=document.querySelector('#confirm-title').textContent.trim()
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    return {
      initialWorkspaces,
      createdWorkspaces,
      workspaces:document.querySelectorAll('.workspace-tab').length,
      activeId:document.querySelector('.workspace-tab.active')?.dataset.workspace || '',
      deletedId,
      storedWorkspaces:stored.workspaces.length,
      storedActive:stored.activeWorkspace,
      menu,
      modal
    }
  })()`);

  if (
    boardDeletion.createdWorkspaces !== boardDeletion.initialWorkspaces + 1 ||
    boardDeletion.workspaces !== boardDeletion.initialWorkspaces ||
    boardDeletion.storedWorkspaces !== boardDeletion.workspaces ||
    boardDeletion.activeId === boardDeletion.deletedId ||
    boardDeletion.storedActive !== boardDeletion.activeId ||
    boardDeletion.menu !== "Eliminar tablero" ||
    boardDeletion.modal !== "Eliminar tablero"
  ) {
    throw new Error(`El menu contextual no elimino el tablero: ${JSON.stringify(boardDeletion)}`);
  }

  cdp.reload();
  await delay(500);
  const boardDeletionRestored = await cdp.evaluate(`({
    workspaces:document.querySelectorAll('.workspace-tab').length,
    activeId:document.querySelector('.workspace-tab.active')?.dataset.workspace || ''
  })`);
  if (
    boardDeletionRestored.workspaces !== boardDeletion.workspaces ||
    boardDeletionRestored.activeId !== boardDeletion.activeId
  ) {
    throw new Error(`La eliminacion del tablero no persistio: ${JSON.stringify({ boardDeletion, boardDeletionRestored })}`);
  }

  console.log("KANBAN_EXTENSION_OK: scroll, menus de tarjeta, columna y tablero, y persistencia confirmados.");
} finally {
  cdp?.close();
  browser.kill();
  await new Promise(resolve => webServer.close(resolve));
  await delay(200);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
