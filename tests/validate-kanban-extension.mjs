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
  readFile(path.join(extensionDir, "background.js"), "utf8"),
  readFile(path.join(extensionDir, "panzoom.js"), "utf8")
]);

if (files.some(file => file.includes("localStorage"))) {
  throw new Error("La extension conserva referencias a localStorage");
}

const normalizedKanbanHtml = files[0].replaceAll('\r', '');

if (
  !normalizedKanbanHtml.includes(
    'html:not([data-theme="dark"]) .card-group{\n  background:color-mix(in srgb,var(--site-bg) 88%,#ffffff);'
  ) ||
  !normalizedKanbanHtml.includes(
    'html[data-theme="dark"] .card-group{\n  background:color-mix(in srgb,var(--site-bg) 88%,#000000);'
  )
) {
  throw new Error("Los grupos no conservan los fondos definidos para ambos temas");
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

  if (request.url === "/panzoom.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(files[3]);
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

  const selectionPolicy = await cdp.evaluate(`({
    board:getComputedStyle(document.body).userSelect,
    input:getComputedStyle(document.querySelector('#confirm-input')).userSelect
  })`);
  if (selectionPolicy.board !== "none" || selectionPolicy.input !== "text") {
    throw new Error(`La politica de seleccion no se aplico: ${JSON.stringify(selectionPolicy)}`);
  }

  const groups = await cdp.evaluate(`(async()=>{
    let column=document.querySelector('.column')
    let root=column.querySelector(':scope > .cards')
    let originalCard=root.querySelector(':scope > .card')
    let originalContent=originalCard.innerHTML
    let initialCount=column.querySelectorAll('.card').length

    column.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:80,
      clientY:80
    }))
    let menuButton=document.querySelector('#add-group-context')
    let menuVisible=!menuButton.hidden
    menuButton.click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let modalTitle=document.querySelector('#confirm-title').textContent.trim()
    let input=document.querySelector('#confirm-input')
    input.value='Prioridad'
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,60))

    let group=column.querySelector('.card-group')
    let heightBefore=group.offsetHeight
    group.querySelector('.group-add-card').click()
    let created=group.querySelector('.group-cards > .card')
    created.textContent='Tarea agrupada'
    created.blur()
    await new Promise(resolve=>setTimeout(resolve,50))

    let transfer=new DataTransfer()
    originalCard.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    let groupRect=group.getBoundingClientRect()
    group.querySelector('.card-group-header').dispatchEvent(
      new DragEvent('dragover',{
        bubbles:true,
        cancelable:true,
        clientX:groupRect.left+20,
        clientY:groupRect.bottom-20,
        dataTransfer:transfer
      })
    )
    originalCard.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    let active=stored.workspaces.find(
      workspace=>workspace.id===stored.activeWorkspace
    )
    let storedGroup=active.board[0].groups?.[0]
    let result={
      menuVisible,
      modalTitle,
      title:group.querySelector('.card-group-title').textContent.trim(),
      cards:group.querySelectorAll('.group-cards > .card').length,
      groupCount:group.querySelector('.group-count').textContent.trim(),
      columnCount:column.querySelector('.column-count').textContent.trim(),
      expectedColumnCount:String(initialCount+1),
      grew:group.offsetHeight>heightBefore,
      storedTitle:storedGroup?.title,
      storedCards:storedGroup?.cards?.map(value=>{
        let element=document.createElement('div')
        element.innerHTML=value
        return element.textContent
      })
    }

    group.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      button:0,
      pointerId:41,
      clientX:groupRect.left+8,
      clientY:groupRect.top+8
    }))
    group.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      button:0,
      pointerId:41,
      clientX:groupRect.left+8,
      clientY:groupRect.top+8
    }))
    result.selected=group.classList.contains('selected')

    let destination=document.querySelectorAll('.column')[1]
    let destinationCards=destination.querySelector(':scope > .cards')
    let destinationRect=destinationCards.getBoundingClientRect()
    transfer=new DataTransfer()
    group.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    destinationCards.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:destinationRect.left+20,
      clientY:destinationRect.bottom-20,
      dataTransfer:transfer
    }))
    group.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))
    result.moved=group.closest('.column')===destination

    group.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:90,
      clientY:90
    }))
    result.editVisible=!document.querySelector('#edit-context').hidden
    document.querySelector('#edit-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    result.editModal=document.querySelector('#confirm-title').textContent.trim()
    document.querySelector('#confirm-input').value='Prioridad alta'
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,60))
    result.editedTitle=group.querySelector('.card-group-title').textContent.trim()

    group.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:90,
      clientY:90
    }))
    result.duplicateVisible=!document.querySelector('#duplicate-context').hidden
    document.querySelector('#duplicate-context').click()
    await new Promise(resolve=>setTimeout(resolve,80))
    let duplicate=group.nextElementSibling
    result.duplicated=
      duplicate?.matches('.card-group') &&
      duplicate.querySelector('.card-group-title').textContent.trim()==='Prioridad alta' &&
      duplicate.querySelectorAll('.group-cards > .card').length===2 &&
      duplicate.classList.contains('selected')
    stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    active=stored.workspaces.find(
      workspace=>workspace.id===stored.activeWorkspace
    )
    result.duplicateStored=active.board.some(item=>
      item.groups?.filter(value=>value.title==='Prioridad alta').length===2
    )
    duplicate.remove()

    created.remove()
    root.append(originalCard)
    group.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:90,
      clientY:90
    }))
    result.deleteLabel=document.querySelector('#delete-context').textContent.trim()
    document.querySelector('#delete-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))
    result.deleted=!group.isConnected
    stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    active=stored.workspaces.find(
      workspace=>workspace.id===stored.activeWorkspace
    )
    result.deletedFromStorage=!active.board.some(item=>
      item.groups?.some(value=>value.title==='Prioridad alta')
    )

    return result
  })()`);

  if (
    !groups.menuVisible ||
    groups.modalTitle !== "Agregar grupo" ||
    groups.title !== "Prioridad" ||
    groups.cards !== 2 ||
    groups.groupCount !== "2" ||
    groups.columnCount !== groups.expectedColumnCount ||
    !groups.grew ||
    groups.storedTitle !== "Prioridad" ||
    groups.storedCards?.length !== 2 ||
    !groups.storedCards.includes("Tarea agrupada") ||
    !groups.selected ||
    !groups.moved ||
    !groups.editVisible ||
    groups.editModal !== "Renombrar grupo" ||
    groups.editedTitle !== "Prioridad alta" ||
    !groups.duplicateVisible ||
    !groups.duplicated ||
    !groups.duplicateStored ||
    groups.deleteLabel !== "Eliminar grupo" ||
    !groups.deleted ||
    !groups.deletedFromStorage
  ) {
    throw new Error(`Los grupos de columna no funcionan correctamente: ${JSON.stringify(groups)}`);
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

  const overview = await cdp.evaluate(`(async()=>{
    let sourceId=document.querySelector('.workspace-tab.active').dataset.workspace

    document.querySelector('.add-workspace').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    document.querySelector('#confirm-input').value='Destino general'
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let destinationId=document.querySelector('.workspace-tab.active').dataset.workspace
    document.querySelector('.workspace-tab[data-workspace="'+sourceId+'"]').click()
    await new Promise(resolve=>setTimeout(resolve,40))
    document.querySelector('#view').value='row'
    document.querySelector('#view').dispatchEvent(new Event('change',{bubbles:true}))
    await new Promise(resolve=>setTimeout(resolve,40))
    document.querySelector('.view-button').click()
    let menuVisible=!document.querySelector('.view-menu').hidden
    document.querySelector('#show-overview').click()
    await new Promise(resolve=>setTimeout(resolve,40))

    let sourceBoard=document.querySelector('.overview-workspace[data-workspace="'+sourceId+'"]')
    let destinationBoard=document.querySelector('.overview-workspace[data-workspace="'+destinationId+'"]')
    let sourceKeepsRow=sourceBoard.querySelector('.overview-columns')
      .classList.contains('row')
    let destinationKeepsGrid=destinationBoard.querySelector('.overview-columns')
      .classList.contains('grid')
    let boardTransfer=new DataTransfer()
    let boardRect=sourceBoard.getBoundingClientRect()

    destinationBoard.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:boardTransfer
    }))
    sourceBoard.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:boardRect.left+boardRect.width/2,
      clientY:boardRect.top+boardRect.height/2,
      dataTransfer:boardTransfer
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let boardPlaceholderVisible=
      !!document.querySelector('.overview-workspace-placeholder')
    let boardFocused=destinationBoard.classList.contains('selected')
    let boardPreviewBackground=getComputedStyle(
      document.querySelector('.drag-image .overview-workspace')
    ).backgroundColor
    destinationBoard.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:boardTransfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let boardOrder=[...document.querySelectorAll('.overview-workspace')]
      .map(workspace=>workspace.dataset.workspace)
    let card=sourceBoard.querySelector('.card')
    let cardContent=card.innerHTML
    let targetCards=destinationBoard.querySelector('.cards')
    let transfer=new DataTransfer()
    let rect=targetCards.getBoundingClientRect()

    card.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    targetCards.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+10,
      dataTransfer:transfer
    }))
    card.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let cardMoved=[...destinationBoard.querySelectorAll('.card')]
      .some(item=>item.innerHTML===cardContent)

    let sourceColumn=sourceBoard.querySelector('.column')
    let columnTitle=sourceColumn.querySelector('h3').innerHTML
    let targetColumn=destinationBoard.querySelector('.column')
    rect=targetColumn.getBoundingClientRect()
    transfer=new DataTransfer()
    sourceColumn.querySelector('h3').dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    targetColumn.dispatchEvent(new DragEvent('dragover',{
      bubbles:true,
      cancelable:true,
      clientX:rect.left+rect.width/2,
      clientY:rect.top+rect.height/2,
      dataTransfer:transfer
    }))
    sourceColumn.querySelector('h3').dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:transfer
    }))
    await new Promise(resolve=>setTimeout(resolve,80))

    let columnMoved=[...destinationBoard.querySelectorAll('.column')]
      .some(item=>item.querySelector('h3').innerHTML===columnTitle)
    let contextCard=destinationBoard.querySelector('.card')

    contextCard.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:850,
      clientY:100
    }))
    document.querySelector('#move-context').click()
    let moveOpensLeft=document.querySelector('#context-menu')
      .classList.contains('open-left')
    let moveBridgeWidth=getComputedStyle(
      document.querySelector('.move-workspace-option'),
      '::after'
    ).width
    let moveBoards=[...document.querySelectorAll(
      '#move-menu .move-workspace-trigger'
    )].map(button=>button.textContent)
    let moveOptions=[...document.querySelectorAll(
      '#move-menu .move-columns-menu button[data-column]'
    )]
      .map(button=>button.textContent)
    let sourceOption=[...document.querySelectorAll(
      '#move-menu .move-columns-menu button[data-column]'
    )]
      .find(button=>button.dataset.workspace===sourceId)
    sourceOption.click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let contextColumn=destinationBoard.querySelector('.column')
    let contextColumnTitle=contextColumn.querySelector('h3').innerHTML

    contextColumn.dispatchEvent(new MouseEvent('contextmenu',{
      bubbles:true,
      cancelable:true,
      clientX:110,
      clientY:110
    }))
    document.querySelector('#move-context').click()
    let columnMoveOptions=[...document.querySelectorAll('#move-menu button')]
      .map(button=>button.textContent)
    document.querySelector(
      '#move-menu button[data-workspace="'+sourceId+'"]'
    ).click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let contextColumnMoved=[...sourceBoard.querySelectorAll('.column')]
      .some(column=>column.querySelector('h3').innerHTML===contextColumnTitle)

    sourceBoard.querySelector('.overview-workspace-header')
      .dispatchEvent(new MouseEvent('contextmenu',{
        bubbles:true,
        cancelable:true,
        clientX:120,
        clientY:120
      }))
    let boardEditVisible=!document.querySelector('#edit-context').hidden
    let boardAddColumnVisible=!document.querySelector('#add-column-context').hidden
    let boardAddColumnLabel=document.querySelector('#add-column-context').textContent.trim()
    let boardDeleteLabel=document.querySelector('#delete-context').textContent.trim()
    let boardColumnsBefore=sourceBoard.querySelectorAll(
      '.overview-columns > .column'
    ).length
    document.querySelector('#add-column-context').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let boardColumnsAfter=sourceBoard.querySelectorAll(
      '.overview-columns > .column'
    ).length
    let addedHeading=sourceBoard.querySelector(
      '.overview-columns > .column:last-child h3'
    )
    let addedColumnEditing=addedHeading.isContentEditable
    addedHeading.blur()
    await new Promise(resolve=>setTimeout(resolve,40))

    document.querySelector('#view').value='row'
    document.querySelector('#view').dispatchEvent(new Event('change',{bubbles:true}))
    let rowMode=document.querySelector('#kanban').classList.contains('row')
    document.querySelector('#view').value='grid'
    document.querySelector('#view').dispatchEvent(new Event('change',{bubbles:true}))
    await new Promise(resolve=>setTimeout(resolve,80))
    let allViewWorkspaces=document.querySelectorAll(
      '.overview-workspace'
    ).length

    document.querySelector('.view-button').click()
    let addViewLabel=document.querySelector('#new-view').textContent.trim()
    document.querySelector('#new-view').click()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let addViewModalTitle=document.querySelector('#confirm-title').textContent.trim()
    let viewCheckboxes=[...document.querySelectorAll(
      '#view-workspaces input[type="checkbox"]'
    )]
    document.querySelector('#confirm-input').value='Vista enfocada'
    viewCheckboxes.find(input=>input.value===sourceId).checked=true
    document.querySelector('#accept-confirm').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let customViewButton=[...document.querySelectorAll(
      '#saved-views button[data-view]'
    )].find(button=>button.textContent==='Vista enfocada')
    let customViewId=customViewButton?.dataset.view || ''
    let customWorkspaceIds=[...document.querySelectorAll(
      '.overview-workspace'
    )].map(workspace=>workspace.dataset.workspace)
    document.querySelector('#view').value='row'
    document.querySelector('#view').dispatchEvent(new Event('change',{bubbles:true}))
    await new Promise(resolve=>setTimeout(resolve,80))
    document.querySelector('#show-overview').click()
    await new Promise(resolve=>setTimeout(resolve,40))
    customViewButton.click()
    await new Promise(resolve=>setTimeout(resolve,40))
    let customKeepsRow=document.querySelector('#kanban').classList.contains('row')

    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']
    let sourceStored=stored.workspaces.find(workspace=>workspace.id===sourceId)
    let destinationStored=stored.workspaces.find(workspace=>workspace.id===destinationId)
    let contextMoved=sourceStored.board.some(column=>
      column.cards.includes(contextCard.innerHTML)
    )
    let countersMatch=[...document.querySelectorAll('.overview-workspace')]
      .every(workspace=>
        Number(workspace.querySelector(
          '.overview-workspace-header .workspace-count'
        ).textContent)===workspace.querySelectorAll('.card').length
      )

    return {
      menuVisible,
      destinationId,
      sourceKeepsRow,
      destinationKeepsGrid,
      boardPlaceholderVisible,
      boardFocused,
      boardPreviewBackground,
      boardOrder,
      storedBoardOrder:stored.workspaces.map(workspace=>workspace.id),
      overviewClass:document.querySelector('#kanban').classList.contains('overview'),
      workspaces:document.querySelectorAll('.overview-workspace').length,
      allViewWorkspaces,
      tabs:document.querySelectorAll('.workspace-tab').length,
      cardMoved,
      columnMoved,
      contextMoved,
      contextColumnMoved,
      countersMatch,
      boardEditVisible,
      boardAddColumnVisible,
      boardAddColumnLabel,
      boardColumnsBefore,
      boardColumnsAfter,
      addedColumnEditing,
      boardDeleteLabel,
      moveBoards,
      moveOpensLeft,
      moveBridgeWidth,
      moveOptions,
      columnMoveOptions,
      rowMode,
      viewCheckboxes:viewCheckboxes.length,
      addViewLabel,
      addViewModalTitle,
      customViewId,
      customWorkspaceIds,
      customKeepsRow,
      storedCustomView:stored.views.find(view=>view.id===customViewId),
      storedDestinationColumns:destinationStored.board.length,
      storedOverviewView:stored.overviewSettings.view
    }
  })()`);

  if (
    !overview.menuVisible ||
    !overview.sourceKeepsRow ||
    !overview.destinationKeepsGrid ||
    !overview.boardPlaceholderVisible ||
    !overview.boardFocused ||
    overview.boardPreviewBackground === "rgba(0, 0, 0, 0)" ||
    overview.boardOrder[0] !== overview.destinationId ||
    JSON.stringify(overview.storedBoardOrder) !== JSON.stringify(overview.boardOrder) ||
    !overview.overviewClass ||
    overview.allViewWorkspaces !== overview.tabs ||
    !overview.cardMoved ||
    !overview.columnMoved ||
    !overview.contextMoved ||
    !overview.contextColumnMoved ||
    !overview.countersMatch ||
    !overview.boardEditVisible ||
    !overview.boardAddColumnVisible ||
    overview.boardAddColumnLabel !== "Agregar columna" ||
    overview.boardColumnsAfter !== overview.boardColumnsBefore + 1 ||
    !overview.addedColumnEditing ||
    overview.boardDeleteLabel !== "Eliminar tablero" ||
    overview.moveBoards.length !== overview.tabs ||
    !overview.moveOpensLeft ||
    overview.moveBridgeWidth !== "6px" ||
    overview.moveOptions.length < overview.moveBoards.length ||
    overview.moveOptions.some(option=>option.includes(" > ")) ||
    overview.columnMoveOptions.some(option=>option.includes(" > ")) ||
    !overview.rowMode ||
    overview.viewCheckboxes !== overview.tabs ||
    overview.addViewLabel !== "Agregar vista" ||
    overview.addViewModalTitle !== "Agregar vista" ||
    !overview.customViewId ||
    JSON.stringify(overview.customWorkspaceIds) !== JSON.stringify([boardDeletion.activeId]) ||
    !overview.customKeepsRow ||
    JSON.stringify(overview.storedCustomView?.workspaceIds) !== JSON.stringify([boardDeletion.activeId]) ||
    overview.storedCustomView?.settings?.view !== "row" ||
    overview.storedDestinationColumns < 1 ||
    overview.storedOverviewView !== "grid"
  ) {
    throw new Error(`La vista general no sincronizo movimientos: ${JSON.stringify(overview)}`);
  }

  const canvasView = await cdp.evaluate(`(async()=>{
    let configuredTab=document.querySelector('.workspace-tab')
    let configuredWorkspaceId=configuredTab.dataset.workspace
    configuredTab.click()
    await new Promise(resolve=>setTimeout(resolve,80))
    document.querySelector('#view').value='grid'
    document.querySelector('#view').dispatchEvent(
      new Event('change',{bubbles:true})
    )
    document.querySelector('#heightMode').value='fixed'
    document.querySelector('#heightMode').dispatchEvent(
      new Event('change',{bubbles:true})
    )
    document.querySelector('#height').value='333'
    document.querySelector('#height').dispatchEvent(
      new Event('input',{bubbles:true})
    )
    await new Promise(resolve=>setTimeout(resolve,80))

    document.querySelector('.view-button').click()
    document.querySelector('#show-canvas').click()
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))

    let initialScale=document.querySelector('#canvas-scale').textContent.trim()
    let canvasActive=document.querySelector('#canvas-viewport')
      .classList.contains('canvas-active')
    let controlsVisible=!document.querySelector('#canvas-controls').hidden
    let settingsHidden=document.querySelector('.settings').hidden
    let boards=document.querySelectorAll('.overview-workspace').length
    let viewport=document.querySelector('#canvas-viewport')
    let gridAlignContent=getComputedStyle(
      document.querySelector('.overview-columns.grid')
    ).alignContent
    let altDownAccepted=document.dispatchEvent(new KeyboardEvent('keydown',{
      bubbles:true,
      cancelable:true,
      key:'Alt',
      code:'AltLeft',
      altKey:true
    }))
    let altUpAccepted=document.dispatchEvent(new KeyboardEvent('keyup',{
      bubbles:true,
      cancelable:true,
      key:'Alt',
      code:'AltLeft'
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let altFocusRetained=document.activeElement===viewport
    let freeBoard=document.querySelector(
      '.overview-workspace[data-workspace="'+configuredWorkspaceId+'"]'
    )
    let freeBoardId=freeBoard.dataset.workspace
    let configuredColumnHeight=freeBoard.querySelector('.column').offsetHeight
    let editableCard=freeBoard.querySelector('.card')
    editableCard.contentEditable=true
    editableCard.draggable=false
    editableCard.focus({preventScroll:true})
    let editableAltDownAccepted=editableCard.dispatchEvent(
      new KeyboardEvent('keydown',{
        bubbles:true,
        cancelable:true,
        key:'Alt',
        code:'AltLeft',
        altKey:true
      })
    )
    let editableAltUpAccepted=editableCard.dispatchEvent(
      new KeyboardEvent('keyup',{
        bubbles:true,
        cancelable:true,
        key:'Alt',
        code:'AltLeft'
      })
    )
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let editableAltFocusRetained=document.activeElement===editableCard
    editableCard.contentEditable=false
    editableCard.draggable=true
    let initialBoardLayout={
      x:parseFloat(freeBoard.style.left),
      y:parseFloat(freeBoard.style.top),
      width:freeBoard.offsetWidth,
      height:freeBoard.offsetHeight
    }
    let header=freeBoard.querySelector('.overview-workspace-header')

    freeBoard.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:21,
      button:0,
      clientX:200,
      clientY:160
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:21,
      button:0,
      clientX:50,
      clientY:130
    }))
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:21,
      button:0,
      clientX:50,
      clientY:130
    }))

    let resize=freeBoard.querySelector('.canvas-resize-handle')
    resize.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:22,
      button:0,
      clientX:500,
      clientY:400
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:22,
      button:0,
      clientX:580,
      clientY:460
    }))
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:22,
      button:0,
      clientX:580,
      clientY:460
    }))

    let changedBoardLayout={
      x:parseFloat(freeBoard.style.left),
      y:parseFloat(freeBoard.style.top),
      width:freeBoard.offsetWidth,
      height:freeBoard.offsetHeight
    }

    viewport.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:31,
      button:0,
      clientX:40,
      clientY:40
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:31,
      button:0,
      clientX:100,
      clientY:80
    }))
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:31,
      button:0,
      clientX:100,
      clientY:80
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))

    let scaleBeforeModifier=document.querySelector('#canvas-scale').textContent.trim()
    freeBoard.dispatchEvent(new WheelEvent('wheel',{
      bubbles:true,
      cancelable:true,
      ctrlKey:true,
      deltaY:-100,
      clientX:200,
      clientY:180
    }))
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    let scaleAfterControl=document.querySelector('#canvas-scale').textContent.trim()
    freeBoard.dispatchEvent(new WheelEvent('wheel',{
      bubbles:true,
      cancelable:true,
      altKey:true,
      deltaY:-100,
      clientX:200,
      clientY:180
    }))
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    let scaleAfterAlt=document.querySelector('#canvas-scale').textContent.trim()
    document.querySelector('#canvas-scale').click()
    await new Promise(resolve=>setTimeout(resolve,250))

    document.querySelector('#canvas-zoom-in').click()
    await new Promise(resolve=>setTimeout(resolve,300))

    let previewSource=freeBoard.querySelector('.card')
    let previewSourceText=previewSource.textContent
    let previewSourceRect=previewSource.getBoundingClientRect().toJSON()
    let previewTransfer=new DataTransfer()
    previewSource.dispatchEvent(new DragEvent('dragstart',{
      bubbles:true,
      cancelable:true,
      dataTransfer:previewTransfer,
      clientX:previewSourceRect.left+10,
      clientY:previewSourceRect.top+10
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let cardPlaceholderRect=document.querySelector('.card-placeholder')
      .getBoundingClientRect().toJSON()
    let cardPreview=document.querySelector('.drag-image > .card')
    let cardPreviewRect=cardPreview.getBoundingClientRect().toJSON()
    let cardPreviewText=cardPreview.textContent
    let cardPreviewSelected=cardPreview.classList.contains('selected')
    previewSource.dispatchEvent(new DragEvent('dragend',{
      bubbles:true,
      cancelable:true,
      dataTransfer:previewTransfer
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))

    let renderedScale=document.querySelector('#kanban').getBoundingClientRect().width /
      document.querySelector('#kanban').offsetWidth

    header.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:23,
      button:0,
      clientX:220,
      clientY:180
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:23,
      button:0,
      clientX:220+45*renderedScale,
      clientY:180+25*renderedScale
    }))
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:23,
      button:0,
      clientX:220+45*renderedScale,
      clientY:180+25*renderedScale
    }))

    resize.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:24,
      button:0,
      clientX:600,
      clientY:500
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:24,
      button:0,
      clientX:600+30*renderedScale,
      clientY:500+20*renderedScale
    }))
    let rectBeforeRelease=freeBoard.getBoundingClientRect().toJSON()
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:24,
      button:0,
      clientX:600+30*renderedScale,
      clientY:500+20*renderedScale
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let rectAfterRelease=freeBoard.getBoundingClientRect().toJSON()

    changedBoardLayout={
      x:parseFloat(freeBoard.style.left),
      y:parseFloat(freeBoard.style.top),
      width:freeBoard.offsetWidth,
      height:freeBoard.offsetHeight
    }

    let layoutBeforeSpace={...changedBoardLayout}
    let panBeforeSpace=canvasPanzoom.getPan()
    document.dispatchEvent(new KeyboardEvent('keydown',{
      bubbles:true,
      cancelable:true,
      code:'Space',
      key:' '
    }))
    let spaceModeEnabled=viewport.classList.contains('canvas-space-pan')
    header.dispatchEvent(new PointerEvent('pointerdown',{
      bubbles:true,
      cancelable:true,
      pointerId:25,
      button:0,
      clientX:240,
      clientY:200
    }))
    document.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,
      pointerId:25,
      button:0,
      clientX:320,
      clientY:250
    }))
    document.dispatchEvent(new PointerEvent('pointerup',{
      bubbles:true,
      pointerId:25,
      button:0,
      clientX:320,
      clientY:250
    }))
    document.dispatchEvent(new KeyboardEvent('keyup',{
      bubbles:true,
      cancelable:true,
      code:'Space',
      key:' '
    }))
    await new Promise(resolve=>requestAnimationFrame(resolve))
    let panAfterSpace=canvasPanzoom.getPan()
    let layoutAfterSpace={
      x:parseFloat(freeBoard.style.left),
      y:parseFloat(freeBoard.style.top),
      width:freeBoard.offsetWidth,
      height:freeBoard.offsetHeight
    }
    await new Promise(resolve=>setTimeout(resolve,250))

    let zoomedScale=document.querySelector('#canvas-scale').textContent.trim()
    let transformed=getComputedStyle(document.querySelector('#kanban')).transform
    let stored=(await chrome.storage.local.get(['kanban-data']))['kanban-data']

    document.querySelector('.workspace-tab').click()
    await new Promise(resolve=>setTimeout(resolve,80))

    let settingsRestored=!document.querySelector('.settings').hidden
    document.querySelector('#heightMode').value='available'
    document.querySelector('#heightMode').dispatchEvent(
      new Event('change',{bubbles:true})
    )
    await new Promise(resolve=>setTimeout(resolve,80))
    let availableHeightClass=document.querySelector('#kanban')
      .classList.contains('available-height')
    let fixedHeightHidden=document.querySelector('#height-value').hidden

    let firstCloseWorked=!document.querySelector('#canvas-viewport')
      .classList.contains('canvas-active')

    document.querySelector('.view-button').click()
    document.querySelector('#show-canvas').click()
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))

    let restoredBoard=document.querySelector(
      '.overview-workspace[data-workspace="'+freeBoardId+'"]'
    )
    let restoredBoardLayout={
      x:parseFloat(restoredBoard.style.left),
      y:parseFloat(restoredBoard.style.top),
      width:restoredBoard.offsetWidth,
      height:restoredBoard.offsetHeight
    }
    let boardAvailableHeight=restoredBoard
      .querySelector('.overview-columns')
      .classList.contains('available-height')

    document.querySelector('.workspace-tab').click()
    await new Promise(resolve=>setTimeout(resolve,80))
    document.querySelector('#heightMode').value='fixed'
    document.querySelector('#heightMode').dispatchEvent(
      new Event('change',{bubbles:true})
    )

    return {
      panzoomType:typeof Panzoom,
      canvasHandler:typeof document.querySelector('#show-canvas').onclick,
      initialScale,
      scaleBeforeModifier,
      scaleAfterControl,
      scaleAfterAlt,
      zoomedScale,
      canvasActive,
      controlsVisible,
      settingsHidden,
      settingsRestored,
      availableHeightClass,
      fixedHeightHidden,
      boardAvailableHeight,
      configuredColumnHeight,
      boards,
      gridAlignContent,
      altDownAccepted,
      altUpAccepted,
      altFocusRetained,
      editableAltDownAccepted,
      editableAltUpAccepted,
      editableAltFocusRetained,
      transformed,
      previewSourceText,
      previewSourceRect,
      cardPlaceholderRect,
      cardPreviewRect,
      cardPreviewText,
      cardPreviewSelected,
      rectBeforeRelease,
      rectAfterRelease,
      spaceModeEnabled,
      spaceModeReleased:!viewport.classList.contains('canvas-space-pan'),
      panBeforeSpace,
      panAfterSpace,
      layoutBeforeSpace,
      layoutAfterSpace,
      initialBoardLayout,
      changedBoardLayout,
      restoredBoardLayout,
      storedBoardLayout:stored.workspaces.find(
        workspace=>workspace.id===freeBoardId
      )?.canvasLayout,
      storedX:stored.canvasTransform?.x,
      storedScale:stored.canvasTransform?.scale,
      canvasClosed:firstCloseWorked && !document.querySelector('#canvas-viewport')
        .classList.contains('canvas-active'),
      controlsHidden:document.querySelector('#canvas-controls').hidden,
      transformCleared:!document.querySelector('#kanban').style.transform
    }
  })()`);

  if (
    !canvasView.canvasActive ||
    !canvasView.controlsVisible ||
    !canvasView.settingsHidden ||
    !canvasView.settingsRestored ||
    !canvasView.availableHeightClass ||
    !canvasView.fixedHeightHidden ||
    !canvasView.boardAvailableHeight ||
    canvasView.configuredColumnHeight !== 333 ||
    canvasView.boards !== overview.tabs ||
    canvasView.gridAlignContent !== "start" ||
    canvasView.altDownAccepted ||
    canvasView.altUpAccepted ||
    !canvasView.altFocusRetained ||
    canvasView.editableAltDownAccepted ||
    canvasView.editableAltUpAccepted ||
    !canvasView.editableAltFocusRetained ||
    canvasView.scaleAfterControl !== canvasView.scaleBeforeModifier ||
    canvasView.scaleAfterAlt === canvasView.scaleBeforeModifier ||
    canvasView.initialScale === canvasView.zoomedScale ||
    canvasView.transformed === "none" ||
    Math.abs(canvasView.cardPlaceholderRect.height-
      canvasView.previewSourceRect.height) > 1 ||
    Math.abs(canvasView.cardPreviewRect.width-
      canvasView.previewSourceRect.width) > 1 ||
    Math.abs(canvasView.cardPreviewRect.height-
      canvasView.previewSourceRect.height) > 1 ||
    canvasView.cardPreviewText !== canvasView.previewSourceText ||
    canvasView.cardPreviewSelected ||
    Math.abs(canvasView.rectBeforeRelease.left-
      canvasView.rectAfterRelease.left) > .01 ||
    Math.abs(canvasView.rectBeforeRelease.top-
      canvasView.rectAfterRelease.top) > .01 ||
    !canvasView.spaceModeEnabled ||
    !canvasView.spaceModeReleased ||
    canvasView.panAfterSpace.x === canvasView.panBeforeSpace.x ||
    canvasView.panAfterSpace.y === canvasView.panBeforeSpace.y ||
    JSON.stringify(canvasView.layoutAfterSpace) !==
      JSON.stringify(canvasView.layoutBeforeSpace) ||
    Math.abs(canvasView.changedBoardLayout.x -
      (canvasView.initialBoardLayout.x - 105)) > .01 ||
    Math.abs(canvasView.changedBoardLayout.y -
      (canvasView.initialBoardLayout.y - 5)) > .01 ||
    Math.abs(canvasView.changedBoardLayout.width -
      (canvasView.initialBoardLayout.width + 110)) > .01 ||
    Math.abs(canvasView.changedBoardLayout.height -
      (canvasView.initialBoardLayout.height + 80)) > .01 ||
    canvasView.storedBoardLayout?.x !== canvasView.changedBoardLayout.x ||
    canvasView.storedBoardLayout?.y !== canvasView.changedBoardLayout.y ||
    canvasView.storedBoardLayout?.width !== canvasView.changedBoardLayout.width ||
    canvasView.storedBoardLayout?.height !== canvasView.changedBoardLayout.height ||
    JSON.stringify(canvasView.restoredBoardLayout) !==
      JSON.stringify(canvasView.changedBoardLayout) ||
    !(canvasView.storedX > 0) ||
    !(canvasView.storedScale > 1) ||
    !canvasView.canvasClosed ||
    !canvasView.controlsHidden ||
    !canvasView.transformCleared
  ) {
    throw new Error(`El modo lienzo no funciono correctamente: ${JSON.stringify(canvasView)}`);
  }

  console.log("KANBAN_EXTENSION_OK: grupos, lienzo, paneo, zonas de aterrizaje y persistencia confirmados.");
} finally {
  cdp?.close();
  browser.kill();
  await new Promise(resolve => webServer.close(resolve));
  await delay(200);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
