const STORAGE='kanban-data'
const THEME_STORAGE='minimal-builder-theme'
const DEFAULT_SETTINGS={
  columns:'3',
  height:'600',
  minWidth:'280',
  view:'grid'
}

const confirmModal=
  document.querySelector('#confirm-modal')

const confirmTitle=
  document.querySelector('#confirm-title')

const confirmMessage=
  document.querySelector('#confirm-message')

const confirmInput=
  document.querySelector('#confirm-input')

const confirmFile=
  document.querySelector('#confirm-file')

const viewWorkspaces=
  document.querySelector('#view-workspaces')

const cancelConfirm=
  document.querySelector('#cancel-confirm')

const acceptConfirm=
  document.querySelector('#accept-confirm')

const contextMenu=
  document.querySelector('#context-menu')

const editContext=
  document.querySelector('#edit-context')

const addColumnContext=
  document.querySelector('#add-column-context')

const copyContext=
  document.querySelector('#copy-context')

const pasteContext=
  document.querySelector('#paste-context')

const duplicateContext=
  document.querySelector('#duplicate-context')

const moveContext=
  document.querySelector('#move-context')

const moveMenu=
  document.querySelector('#move-menu')

const deleteContext=
  document.querySelector('#delete-context')

const viewControl=
  document.querySelector('.view-control')

const viewButton=
  document.querySelector('.view-button')

const viewMenu=
  document.querySelector('.view-menu')

const showOverview=
  document.querySelector('#show-overview')

const showCanvas=
  document.querySelector('#show-canvas')

const canvasViewport=
  document.querySelector('#canvas-viewport')

const canvasControls=
  document.querySelector('#canvas-controls')

const canvasZoomOut=
  document.querySelector('#canvas-zoom-out')

const canvasZoomIn=
  document.querySelector('#canvas-zoom-in')

const canvasScale=
  document.querySelector('#canvas-scale')

const canvasFit=
  document.querySelector('#canvas-fit')

const savedViews=
  document.querySelector('#saved-views')

const newView=
  document.querySelector('#new-view')

const dataControl=
  document.querySelector('.data-control')

const dataButton=
  document.querySelector('.data-button')

const dataMenu=
  document.querySelector('.data-menu')

const exportData=
  document.querySelector('#export-data')

const importData=
  document.querySelector('#import-data')

let resolveModal
let modalMode='input'
let contextTarget
let overviewMode=false
let canvasMode=false
let canvasPanzoom
let canvasSaveTimer
let canvasActivationVersion=0
let canvasTransform={x:0,y:0,scale:1}
let canvasBoardGesture
let canvasSpacePressed=false
let overviewSettings=normalizarConfiguracion()
let views=[]
let activeViewId='all'


function cerrarModal(value=null){

  confirmModal.hidden=true
  confirmFile.value=''
  viewWorkspaces.hidden=true
  viewWorkspaces.replaceChildren()
  resolveModal?.(value)
  resolveModal=null
}


function pedirNombre(title,message,value=''){

  modalMode='input'
  confirmTitle.textContent=title
  confirmMessage.textContent=message
  confirmInput.value=value
  confirmInput.hidden=false
  confirmFile.hidden=true
  viewWorkspaces.hidden=true
  cancelConfirm.hidden=false
  acceptConfirm.textContent='Guardar'
  acceptConfirm.className='primary'
  confirmModal.hidden=false

  requestAnimationFrame(()=>{
    confirmInput.focus()
    confirmInput.select()
  })

  return new Promise(resolve=>{
    resolveModal=resolve
  })
}


function pedirConfirmacion(title,message){

  modalMode='confirm'
  confirmTitle.textContent=title
  confirmMessage.textContent=message
  confirmInput.value=''
  confirmInput.hidden=true
  confirmFile.hidden=true
  viewWorkspaces.hidden=true
  cancelConfirm.hidden=false
  acceptConfirm.textContent='Eliminar'
  acceptConfirm.className='danger'
  confirmModal.hidden=false

  requestAnimationFrame(()=>{
    acceptConfirm.focus()
  })

  return new Promise(resolve=>{
    resolveModal=resolve
  })
}


function pedirArchivo(){

  modalMode='file'
  confirmTitle.textContent='Importar datos'
  confirmMessage.textContent=
    'Selecciona un archivo JSON exportado desde este Kanban.'
  confirmInput.value=''
  confirmInput.hidden=true
  confirmFile.value=''
  confirmFile.hidden=false
  viewWorkspaces.hidden=true
  cancelConfirm.hidden=false
  acceptConfirm.textContent='Importar'
  acceptConfirm.className='primary'
  confirmModal.hidden=false

  requestAnimationFrame(()=>{
    confirmFile.focus()
  })

  return new Promise(resolve=>{
    resolveModal=resolve
  })
}


function mostrarMensaje(title,message){

  modalMode='message'
  confirmTitle.textContent=title
  confirmMessage.textContent=message
  confirmInput.hidden=true
  confirmFile.hidden=true
  viewWorkspaces.hidden=true
  cancelConfirm.hidden=true
  acceptConfirm.textContent='Aceptar'
  acceptConfirm.className='primary'
  confirmModal.hidden=false

  requestAnimationFrame(()=>{
    acceptConfirm.focus()
  })

  return new Promise(resolve=>{
    resolveModal=resolve
  })
}


function pedirVista(){

  modalMode='view'
  confirmTitle.textContent='Agregar vista'
  confirmMessage.textContent=
    'Escribe un nombre y selecciona los tableros que quieres incluir.'
  confirmInput.value=`Vista ${views.length+1}`
  confirmInput.hidden=false
  confirmFile.hidden=true
  viewWorkspaces.hidden=false
  cancelConfirm.hidden=false
  acceptConfirm.textContent='Crear vista'
  acceptConfirm.className='primary'
  viewWorkspaces.replaceChildren(
    ...workspaces.map(workspace=>{
      let label=document.createElement('label')
      let checkbox=document.createElement('input')
      let text=document.createElement('span')

      checkbox.type='checkbox'
      checkbox.value=workspace.id
      text.textContent=workspace.title
      label.append(checkbox,text)
      return label
    })
  )
  confirmModal.hidden=false

  requestAnimationFrame(()=>{
    confirmInput.focus()
    confirmInput.select()
  })

  return new Promise(resolve=>{
    resolveModal=resolve
  })
}


function cerrarMenuContextual(){

  contextMenu.hidden=true
  contextMenu.classList.remove('open-left')
  moveMenu.hidden=true
  moveMenu.replaceChildren()
  contextTarget=null
}


async function copiarAlPortapapeles(text){

  try{
    await navigator.clipboard.writeText(text)
  }catch{
    let textarea=document.createElement('textarea')

    textarea.value=text
    textarea.style.position='fixed'
    textarea.style.opacity='0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}


function obtenerTextoPlano(element){

  return element.innerText
    .replace(/\u00a0/g,' ')
    .replace(/\r\n?/g,'\n')
    .trim()
}


cancelConfirm.onclick=()=>cerrarModal()

acceptConfirm.onclick=()=>{

  if(modalMode==='file'){
    let file=confirmFile.files[0]

    if(!file)
      return

    cerrarModal(file)
    return
  }

  if(modalMode==='view'){
    let workspaceIds=[
      ...viewWorkspaces.querySelectorAll(
        'input:checked'
      )
    ].map(input=>input.value)

    if(!workspaceIds.length)
      return

    cerrarModal({
      title:confirmInput.value.trim() ||
        `Vista ${views.length+1}`,
      workspaceIds
    })
    return
  }

  cerrarModal(
    modalMode==='confirm' ||
    modalMode==='message'
      ? true
      : confirmInput.value
  )
}

confirmModal.onclick=e=>{

  if(e.target===confirmModal)
    cerrarModal()
}

confirmInput.onkeydown=e=>{

  if(e.key==='Enter' && modalMode==='view'){
    e.preventDefault()
    acceptConfirm.click()
  }else if(e.key==='Enter')
    cerrarModal(
      modalMode==='confirm'
        ? true
        : confirmInput.value
    )

  if(e.key==='Escape')
    cerrarModal()
}

const themeToggle=
  document.querySelector('[data-theme-toggle]')

const sunIcon=themeToggle.innerHTML
const moonIcon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g fill="currentColor"><path d="M6 .278a.77.77 0 0 1 .08.858a7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316a.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71C0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"></path><path d="M10.794 3.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387a1.73 1.73 0 0 0-1.097 1.097l-.387 1.162a.217.217 0 0 1-.412 0l-.387-1.162A1.73 1.73 0 0 0 9.31 6.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387a1.73 1.73 0 0 0 1.097-1.097zM13.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732l-.774-.258a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"></path></g></svg>'

function aplicarTema(theme){

  document.documentElement.dataset.theme=theme

  let dark=theme==='dark'

  themeToggle.innerHTML=dark ? moonIcon : sunIcon
  themeToggle.title=`Modo ${dark ? 'Claro' : 'Oscuro'}`
}

aplicarTema(
  matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
)

themeToggle.onclick=async()=>{

  let next=
    document.documentElement.dataset.theme==='dark'
      ? 'light'
      : 'dark'

  aplicarTema(next)
  await chrome.storage.local.set({
    [THEME_STORAGE]:next
  })
}

let drag
let dragImage
let dragImageOffset={x:0,y:0}
let dragFrame
let pendingDragPoint
let pointerGesture
let workspaceDragMoved=false
let workspaceClickBlockedUntil=0
let selectedCards=new Set()
let selectionAnchor
let selectedColumns=new Set()
let columnSelectionAnchor
let selectedOverviewWorkspace
let draggedCards=[]
let draggedColumns=[]
let cardDropTarget
let cardPlaceholders=[]
let cardOriginalLayouts=[]
let cardOverPlaceholder=false
let cardPointerY
let cardPointerDirection=0
let cardPointerContainer
let columnDropTarget
let columnPlaceholders=[]
let columnOriginalLayouts=[]
let columnOverPlaceholder=false
let overviewDropTarget
let overviewPlaceholder
let overviewOriginalOrder=[]
let overviewOverPlaceholder=false
let internalClipboard
let workspaces=[]
let activeWorkspace=''
let workspaceBoards=new Map()
let boardPreparationVersion=0
let saveQueue=Promise.resolve()
let saveTimer
let scheduledSavePromise
let resolveScheduledSave
let rejectScheduledSave


function moverDragImage(x,y){

  if(!dragImage)
    return

  dragImage.style.transform=
    `translate3d(${x-dragImageOffset.x}px,${y-dragImageOffset.y}px,0)`
}


function crearDragImage(element,e){

  let rect=element.getBoundingClientRect()
  let localWidth=element.offsetWidth || rect.width
  let localHeight=element.offsetHeight || rect.height
  let scaleX=rect.width/localWidth
  let scaleY=rect.height/localHeight
  let preview=element.cloneNode(true)

  dragImage?.remove()
  dragImage=document.createElement('div')
  dragImage.className='drag-image'
  dragImage.setAttribute('aria-hidden','true')
  dragImage.style.width=rect.width+'px'
  dragImage.style.height=rect.height+'px'

  preview.classList.remove(
    'dragging',
    'selected',
    'card-drag-source',
    'column-drag-source',
    'overview-workspace-drag-source'
  )
  preview.classList.add('drag-image-content')
  preview.style.width=`${localWidth}px`
  preview.style.height=`${localHeight}px`
  preview.style.transform=`scale(${scaleX},${scaleY})`
  preview.querySelectorAll('.dragging,.selected')
    .forEach(item=>item.classList.remove('dragging','selected'))

  preview
    .querySelectorAll('[draggable]')
    .forEach(item=>item.draggable=false)

  preview.draggable=false
  dragImage.append(preview)

  let selectionCount=
    draggedCards.length || draggedColumns.length

  if(selectionCount>1){
    let count=document.createElement('span')
    count.className='drag-selection-count'
    count.textContent=selectionCount
    dragImage.append(count)
  }

  dragImageOffset={
    x:e.clientX-rect.left,
    y:e.clientY-rect.top
  }

  document.body.append(dragImage)

  let sourceCards=
    element.querySelector?.('.cards')

  let previewCards=
    preview.querySelector?.('.cards')

  if(sourceCards && previewCards)
    previewCards.scrollTop=sourceCards.scrollTop

  moverDragImage(e.clientX,e.clientY)

  let transparent=
    document.createElement('canvas')

  transparent.width=1
  transparent.height=1

  if(e.dataTransfer){
    e.dataTransfer.effectAllowed='move'
    e.dataTransfer.setData('text/plain','')
    e.dataTransfer.setDragImage(transparent,0,0)
  }
}


function eliminarDragImage(){

  dragImage?.remove()
  dragImage=null
}


function limpiarSeleccion(){

  selectedCards.forEach(card=>card.classList.remove('selected'))
  selectedCards.clear()
  selectedColumns.forEach(column=>column.classList.remove('selected'))
  selectedColumns.clear()
  selectedOverviewWorkspace?.classList.remove('selected')
  selectedOverviewWorkspace=null
  selectionAnchor=null
  columnSelectionAnchor=null
}


function seleccionarTableroVista(workspace){

  limpiarSeleccion()
  selectedOverviewWorkspace=workspace
  workspace.classList.add('selected')
}


function seleccionarColumnas(columns,{anchor=true}={}){

  limpiarSeleccion()

  columns.forEach(column=>{
    selectedColumns.add(column)
    column.classList.add('selected')
  })

  if(anchor)
    columnSelectionAnchor=columns.at(-1) || null
}


function seleccionarColumna(column,e={}){

  let additive=e.ctrlKey || e.metaKey
  let ranged=e.shiftKey && columnSelectionAnchor?.isConnected

  if(ranged){
    let anchorColumn=columnSelectionAnchor
    let columns=[...kanban.querySelectorAll('.column')]
    let from=columns.indexOf(anchorColumn)
    let to=columns.indexOf(column)

    if(from!==-1 && to!==-1){
      let range=columns.slice(
        Math.min(from,to),
        Math.max(from,to)+1
      )

      if(!additive)
        limpiarSeleccion()

      range.forEach(item=>{
        selectedColumns.add(item)
        item.classList.add('selected')
      })
      columnSelectionAnchor=anchorColumn
      return
    }
  }

  if(additive){
    if(selectedColumns.has(column)){
      selectedColumns.delete(column)
      column.classList.remove('selected')
    }else{
      if(selectedCards.size)
        limpiarSeleccion()

      selectedColumns.add(column)
      column.classList.add('selected')
    }

    columnSelectionAnchor=column
    return
  }

  seleccionarColumnas([column])
}


function seleccionarTarjetas(cards,{anchor=true}={}){

  limpiarSeleccion()

  cards.forEach(card=>{
    selectedCards.add(card)
    card.classList.add('selected')
  })

  if(anchor)
    selectionAnchor=cards.at(-1) || null
}


function seleccionarTarjeta(card,e={}){

  let additive=e.ctrlKey || e.metaKey
  let ranged=e.shiftKey && selectionAnchor?.isConnected

  if(ranged){
    let anchorCard=selectionAnchor
    let cards=[...kanban.querySelectorAll('.card')]
    let from=cards.indexOf(selectionAnchor)
    let to=cards.indexOf(card)

    if(from!==-1 && to!==-1){
      let range=cards.slice(
        Math.min(from,to),
        Math.max(from,to)+1
      )

      if(!additive)
        limpiarSeleccion()

      range.forEach(item=>{
        selectedCards.add(item)
        item.classList.add('selected')
      })
      selectionAnchor=anchorCard
      return
    }
  }

  if(additive){
    if(selectedColumns.size)
      limpiarSeleccion()

    if(selectedCards.has(card)){
      selectedCards.delete(card)
      card.classList.remove('selected')
    }else{
      selectedCards.add(card)
      card.classList.add('selected')
    }

    selectionAnchor=card
    return
  }

  seleccionarTarjetas([card])
}


function ajustarColumnas(){

  let grid=
    view.value==='grid'

  kanban.classList.toggle(
    'row',
    !grid
  )

  document.querySelectorAll('.grid-setting')
    .forEach(setting=>setting.hidden=!grid)

  if(!grid)
    return

  let deseadas=Math.max(
    1,
    Number(columns.value) || 1
  )

  let minimo=Math.max(
    100,
    Number(minWidth.value) || 100
  )

  let gap=15

  let ancho=
    kanban.clientWidth - 40

  let caben=Math.max(
    1,
    Math.floor(
      (ancho + gap) /
      (minimo + gap)
    )
  )

  let reales=Math.min(
    deseadas,
    caben
  )

  document.documentElement.style
    .setProperty(
      '--real-columns',
      reales
    )
}


function leerConfiguracion(){

  return {
    columns:columns.value,
    height:height.value,
    minWidth:minWidth.value,
    view:view.value
  }
}


function normalizarConfiguracion(settings={}){

  return {
    columns:String(settings.columns || DEFAULT_SETTINGS.columns),
    height:String(settings.height || DEFAULT_SETTINGS.height),
    minWidth:String(settings.minWidth || DEFAULT_SETTINGS.minWidth),
    view:settings.view==='row' ? 'row' : 'grid'
  }
}


function normalizarTransformLienzo(transform={}){

  let scale=Number(transform.scale)
  let x=Number(transform.x)
  let y=Number(transform.y)

  return {
    x:Number.isFinite(x) ? x : 0,
    y:Number.isFinite(y) ? y : 0,
    scale:Number.isFinite(scale)
      ? Math.min(2.5,Math.max(.35,scale))
      : 1
  }
}


function normalizarDisenoLienzo(layout={},index=0){

  let width=Number(layout.width)
  let heightValue=Number(layout.height)
  let x=Number(layout.x)
  let y=Number(layout.y)
  let z=Number(layout.z)

  return {
    x:Number.isFinite(x) ? x : 40+(index%3)*660,
    y:Number.isFinite(y)
      ? y
      : 40+Math.floor(index/3)*500,
    width:Number.isFinite(width)
      ? Math.max(220,width)
      : 620,
    height:Number.isFinite(heightValue)
      ? Math.max(160,heightValue)
      : 460,
    z:Number.isFinite(z) ? Math.max(1,z) : index+1
  }
}


function aplicarConfiguracion(settings){

  let config=normalizarConfiguracion(settings)

  columns.value=config.columns
  height.value=config.height
  minWidth.value=config.minWidth
  view.value=config.view

  document.documentElement.style
    .setProperty(
      '--height',
      height.value+'px'
    )

  ajustarColumnas()
}


function leerTablero(){

  return leerColumnas(kanban)
}


function leerColumnas(container){

  return [...container.children]
    .filter(element=>element.matches('.column'))
    .map(column=>({

    title:
      column.querySelector('h3').innerHTML,

    cards:[
      ...column.querySelectorAll('.card')
    ].map(card=>card.innerHTML)
    }))
}


function crearTarjeta(content='Nueva tarjeta'){

  let card=document.createElement('div')

  card.className='card'
  card.draggable=true
  card.innerHTML=content

  return card
}


function crearColumna(item={}){

  let column=
    document.createElement('section')

  column.className='column'

  column.innerHTML=`
    <div class="column-header">
      <h3 draggable="true"></h3>
      <span class="column-count"></span>
    </div>
    <div class="cards"></div>
    <button class="add-card">
      + Agregar tarjeta
    </button>
  `

  column.querySelector('h3')
    .innerHTML=item.title || 'Nueva columna'

  let cards=
    column.querySelector('.cards')

  ;(item.cards || []).forEach(text=>{
    cards.append(crearTarjeta(text))
  })

  column.querySelector('.column-count').textContent=
    cards.querySelectorAll('.card').length

  return column
}


function actualizarContadoresColumnas(){

  kanban.querySelectorAll('.column').forEach(column=>{
    column.querySelector('.column-count').textContent=
      column.querySelectorAll('.card').length
  })

  kanban.querySelectorAll('.overview-workspace')
    .forEach(workspace=>{
      workspace.querySelector(
        '.overview-workspace-header .workspace-count'
      ).textContent=
        workspace.querySelectorAll('.card').length
    })
}


function normalizarVista(item,index=0){

  return {
    id:String(
      item?.id ||
      crypto.randomUUID?.() ||
      `view-${Date.now()}-${index}`
    ),
    title:String(item?.title || `Vista ${index+1}`),
    workspaceIds:Array.isArray(item?.workspaceIds)
      ? [...new Set(item.workspaceIds.map(String))]
      : [],
    settings:normalizarConfiguracion(item?.settings)
  }
}


function obtenerVistaActiva(){

  return activeViewId==='all'
    ? null
    : views.find(view=>view.id===activeViewId) || null
}


function dibujarMenuVistas(){

  savedViews.replaceChildren(
    ...views.map(viewItem=>{
      let button=document.createElement('button')

      button.type='button'
      button.dataset.view=viewItem.id
      button.textContent=viewItem.title
      return button
    })
  )
}


function crearVistaGeneral({lienzo=false}={}){

  let customView=obtenerVistaActiva()
  let allowed=customView
    ? new Set(customView.workspaceIds)
    : null

  return workspaces
    .filter(workspace=>!allowed || allowed.has(workspace.id))
    .map((workspace,index)=>{
    let section=document.createElement('section')
    let header=document.createElement('header')
    let title=document.createElement('h2')
    let count=document.createElement('span')
    let columnsContainer=document.createElement('div')
    let resizeHandle=document.createElement('span')
    let boardSettings=normalizarConfiguracion(
      workspace.settings
    )

    section.className='overview-workspace panzoom-exclude'
    section.dataset.workspace=workspace.id
    header.className='overview-workspace-header'
    title.className='overview-open'
    title.textContent=workspace.title
    count.className='workspace-count'
    count.textContent=(workspace.board || []).reduce(
      (total,column)=>total+(column.cards || []).length,
      0
    )
    columnsContainer.className=
      `overview-columns ${boardSettings.view}`
    resizeHandle.className=
      'canvas-resize-handle panzoom-exclude'
    resizeHandle.setAttribute('aria-hidden','true')
    columnsContainer.style.setProperty(
      '--board-columns',
      boardSettings.columns
    )
    columnsContainer.style.setProperty(
      '--board-min-width',
      `${boardSettings.minWidth}px`
    )
    columnsContainer.style.setProperty(
      '--board-height',
      `${boardSettings.height}px`
    )

    ;(workspace.board || []).forEach((item,index)=>{
      let column=crearColumna(item)

      column.dataset.columnIndex=index
      columnsContainer.append(column)
    })

    if(!columnsContainer.children.length){
      let empty=document.createElement('div')

      empty.className='overview-empty'
      empty.textContent='Sin columnas'
      columnsContainer.append(empty)
    }

    if(lienzo){
      let layout=normalizarDisenoLienzo(
        workspace.canvasLayout,
        index
      )

      workspace.canvasLayout=layout
      section.style.left=`${layout.x}px`
      section.style.top=`${layout.y}px`
      section.style.width=`${layout.width}px`
      section.style.height=`${layout.height}px`
      section.style.zIndex=layout.z
    }

    header.append(title,count)
    section.append(header,columnsContainer,resizeHandle)
    return section
    })
}


function sincronizarDesdeVistaGeneral(){

  let byId=new Map(
    workspaces.map(workspace=>[workspace.id,workspace])
  )

  kanban.querySelectorAll('.overview-workspace')
    .forEach(section=>{
      let workspace=byId.get(section.dataset.workspace)

      if(workspace)
        workspace.board=leerColumnas(
          section.querySelector('.overview-columns')
        )
    })

  workspaceBoards.clear()
  boardPreparationVersion++
}


function guardarTransformLienzo(){

  clearTimeout(canvasSaveTimer)
  canvasSaveTimer=setTimeout(
    ()=>guardar({
      tablero:false,
      configuracion:false
    }),
    180
  )
}


function actualizarEscalaLienzo(){

  canvasScale.textContent=
    `${Math.round(canvasTransform.scale*100)}%`
}


function actualizarLimitesLienzo(){

  if(!canvasMode)
    return

  let boards=[
    ...kanban.querySelectorAll('.overview-workspace')
  ]
  let right=boards.reduce(
    (maximum,board)=>Math.max(
      maximum,
      (parseFloat(board.style.left) || 0)+board.offsetWidth
    ),
    0
  )
  let bottom=boards.reduce(
    (maximum,board)=>Math.max(
      maximum,
      (parseFloat(board.style.top) || 0)+board.offsetHeight
    ),
    0
  )

  kanban.style.width=
    `${Math.max(canvasViewport.clientWidth,right+160)}px`
  kanban.style.height=
    `${Math.max(canvasViewport.clientHeight,bottom+160)}px`
}


function establecerPaneoConEspacio(active){

  canvasSpacePressed=!!active && canvasMode
  canvasViewport.classList.toggle(
    'canvas-space-pan',
    canvasSpacePressed
  )
  canvasPanzoom?.setOptions({
    excludeClass:canvasSpacePressed
      ? 'panzoom-control'
      : 'panzoom-exclude'
  })
}


function desactivarLienzo(){

  canvasActivationVersion++
  let deactivationVersion=canvasActivationVersion

  establecerPaneoConEspacio(false)

  if(canvasPanzoom){
    canvasTransform=normalizarTransformLienzo({
      ...canvasPanzoom.getPan(),
      scale:canvasPanzoom.getScale()
    })
    canvasPanzoom.destroy()
    canvasPanzoom.resetStyle()
    canvasPanzoom=null
  }

  canvasMode=false
  canvasViewport.classList.remove(
    'canvas-active',
    'is-panning'
  )
  canvasControls.hidden=true
  kanban.style.removeProperty('transform')
  kanban.style.removeProperty('transition')
  kanban.style.removeProperty('width')
  kanban.style.removeProperty('height')

  setTimeout(()=>{
    if(
      !canvasMode &&
      deactivationVersion===canvasActivationVersion
    ){
      kanban.style.removeProperty('transform')
      kanban.style.removeProperty('transition')
    }
  })
}


function activarLienzo(){

  if(typeof Panzoom!=='function')
    return

  canvasMode=true
  canvasViewport.classList.add('canvas-active')
  canvasControls.hidden=false
  actualizarLimitesLienzo()
  canvasTransform=normalizarTransformLienzo(canvasTransform)
  canvasPanzoom=Panzoom(kanban,{
    canvas:true,
    cursor:'grab',
    minScale:.35,
    maxScale:2.5,
    step:.15,
    startX:canvasTransform.x,
    startY:canvasTransform.y,
    startScale:canvasTransform.scale,
    excludeClass:'panzoom-exclude'
  })
  actualizarEscalaLienzo()
}


function dibujarVistaGeneral(
  viewId=activeViewId,
  {lienzo=canvasMode}={}
){

  desactivarLienzo()
  limpiarSeleccion()
  activeViewId=
    viewId==='all' || views.some(view=>view.id===viewId)
      ? viewId
      : 'all'
  overviewMode=true
  kanban.classList.add('overview')
  kanban.replaceChildren(...crearVistaGeneral({lienzo}))
  viewButton.classList.add('active')
  document.querySelector('.add-column').hidden=true
  aplicarConfiguracion(
    obtenerVistaActiva()?.settings || overviewSettings
  )
  sincronizarWorkspaces()

  if(lienzo){
    let version=canvasActivationVersion

    requestAnimationFrame(()=>{
      if(
        overviewMode &&
        version===canvasActivationVersion
      )
        activarLienzo()
    })
  }
}


function prepararTablero(workspace){

  if(workspaceBoards.has(workspace.id))
    return workspaceBoards.get(workspace.id)

  let nodes=(workspace.board || []).map(crearColumna)

  workspaceBoards.set(workspace.id,nodes)
  return nodes
}


function dibujarTablero(board,id=activeWorkspace){

  let nodes=(board || []).map(crearColumna)

  desactivarLienzo()
  limpiarSeleccion()
  overviewMode=false
  kanban.classList.remove('overview')
  viewButton.classList.remove('active')
  document.querySelector('.add-column').hidden=false
  workspaceBoards.set(id,nodes)
  kanban.replaceChildren(...nodes)
}


function mostrarTablero(id,{preservarActual=true}={}){

  if(
    preservarActual &&
    activeWorkspace &&
    !overviewMode
  )
    workspaceBoards.set(
      activeWorkspace,
      [...kanban.children]
    )

  let workspace=workspaces.find(item=>item.id===id)

  if(!workspace)
    return null

  desactivarLienzo()
  limpiarSeleccion()
  overviewMode=false
  kanban.classList.remove('overview')
  viewButton.classList.remove('active')
  document.querySelector('.add-column').hidden=false
  activeWorkspace=id
  kanban.replaceChildren(...prepararTablero(workspace))

  return workspace
}


function prepararTablerosRestantes(){

  let version=++boardPreparationVersion
  let activeIndex=workspaces.findIndex(
    workspace=>workspace.id===activeWorkspace
  )
  let pending=[
    ...workspaces.slice(activeIndex+1),
    ...workspaces.slice(0,Math.max(activeIndex,0))
  ].filter(workspace=>!workspaceBoards.has(workspace.id))

  let schedule=window.requestIdleCallback ||
    (callback=>setTimeout(
      ()=>callback({didTimeout:false,timeRemaining:()=>8}),
      0
    ))

  let prepareNext=()=>{

    if(
      version!==boardPreparationVersion ||
      !pending.length
    )
      return

    prepararTablero(pending.shift())
    schedule(prepareNext,{timeout:80})
  }

  if(pending.length)
    schedule(prepareNext,{timeout:80})
}


function dibujarWorkspaces(){

  workspaceTabs.replaceChildren(
    ...workspaces.map(workspace=>{

      let button=
        document.createElement('button')

      let name=
        document.createElement('span')

      let count=
        document.createElement('span')

      button.className=
        'workspace-tab' +
        (!overviewMode && workspace.id===activeWorkspace
          ? ' active'
          : '')

      button.dataset.workspace=workspace.id
      button.type='button'
      button.draggable=true

      name.textContent=workspace.title
      count.className='workspace-count'
      count.textContent=(workspace.board || [])
        .reduce(
          (total,column)=>
            total+(column.cards || []).length,
          0
        )

      button.append(name,count)

      return button
    })
  )

  asegurarWorkspaceVisible()
}


function asegurarWorkspaceVisible(){

  requestAnimationFrame(()=>{

    let activeTab=
      workspaceTabs.querySelector(
        '.workspace-tab.active'
      )

    if(!activeTab)
      return

    let tabsRect=
      workspaceTabs.getBoundingClientRect()

    let activeRect=
      activeTab.getBoundingClientRect()

    if(activeRect.left < tabsRect.left)
      workspaceTabs.scrollLeft-=
        tabsRect.left-activeRect.left

    if(activeRect.right > tabsRect.right)
      workspaceTabs.scrollLeft+=
        activeRect.right-tabsRect.right
  })
}


function sincronizarWorkspaces(){

  let tabs=[
    ...workspaceTabs.querySelectorAll('.workspace-tab')
  ]

  if(
    tabs.length!==workspaces.length ||
    tabs.some(
      (tab,index)=>
        tab.dataset.workspace!==workspaces[index]?.id
    )
  ){
    dibujarWorkspaces()
    return
  }

  let activeChanged=false

  tabs.forEach((tab,index)=>{

    let workspace=workspaces[index]
    let active=
      !overviewMode &&
      workspace.id===activeWorkspace

    if(tab.classList.contains('active')!==active)
      activeChanged=true

    tab.classList.toggle('active',active)
    tab.querySelector('span').textContent=workspace.title
    tab.querySelector('.workspace-count').textContent=
      (workspace.board || []).reduce(
        (total,column)=>
          total+(column.cards || []).length,
        0
      )
  })

  if(activeChanged)
    asegurarWorkspaceVisible()
}


function escribirDatos(){

  let data=structuredClone({
    activeWorkspace,
    overviewSettings,
    canvasTransform,
    views,
    workspaces
  })

  saveQueue=saveQueue
    .catch(()=>{})
    .then(()=>chrome.storage.local.set({
      [STORAGE]:data
    }))

  return saveQueue
}


function ejecutarGuardadoProgramado(){

  if(saveTimer){
    clearTimeout(saveTimer)
    saveTimer=null
  }

  let resolve=resolveScheduledSave
  let reject=rejectScheduledSave

  scheduledSavePromise=null
  resolveScheduledSave=null
  rejectScheduledSave=null

  let task=escribirDatos()

  task.then(resolve,reject)
  return task
}


function programarGuardado(){

  if(!scheduledSavePromise)
    scheduledSavePromise=new Promise((resolve,reject)=>{
      resolveScheduledSave=resolve
      rejectScheduledSave=reject
    })

  clearTimeout(saveTimer)
  saveTimer=setTimeout(
    ejecutarGuardadoProgramado,
    30
  )

  return scheduledSavePromise
}


function guardar({
  inmediato=false,
  tablero=true,
  configuracion=true
}={}){

  if(overviewMode){
    if(tablero){
      actualizarContadoresColumnas()
      sincronizarDesdeVistaGeneral()
    }

    if(configuracion){
      let customView=obtenerVistaActiva()

      if(customView)
        customView.settings=leerConfiguracion()
      else
        overviewSettings=leerConfiguracion()
    }

    sincronizarWorkspaces()

    return inmediato
      ? ejecutarGuardadoProgramado()
      : programarGuardado()
  }

  let current=
    workspaces.find(
      workspace=>workspace.id===activeWorkspace
    )

  if(current){
    if(tablero){
      actualizarContadoresColumnas()
      current.board=leerTablero()
    }

    if(configuracion)
      current.settings=leerConfiguracion()
  }

  sincronizarWorkspaces()

  return inmediato
    ? ejecutarGuardadoProgramado()
    : programarGuardado()
}


async function exportarDatos(){

  await guardar({inmediato:true})

  let data=JSON.stringify({
    version:1,
    activeWorkspace,
    overviewSettings,
    canvasTransform,
    views,
    workspaces
  },null,2)

  let blob=new Blob(
    [data],
    {type:'application/json'}
  )

  let url=URL.createObjectURL(blob)
  let link=document.createElement('a')
  let now=new Date()
  let localDate=[
    now.getFullYear(),
    String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')
  ].join('-')

  link.href=url
  link.download=
    `kanban-${localDate}.json`

  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}


async function importarDatos(data){

  if(
    !data ||
    !Array.isArray(data.workspaces) ||
    !data.workspaces.length
  )
    throw new Error('Formato invalido')

  let legacySettings={
    columns:data.columns,
    height:data.height,
    minWidth:data.minWidth,
    view:data.view
  }

  workspaces=data.workspaces.map((workspace,index)=>({
    id:String(workspace?.id || `workspace-${index+1}`),
    title:String(workspace?.title || `Tablero ${index+1}`),
    board:Array.isArray(workspace?.board)
      ? workspace.board
          .filter(column=>column && typeof column==='object')
          .map((column,columnIndex)=>({
            title:String(
              column.title ||
              `Nueva columna ${columnIndex+1}`
            ),
            cards:Array.isArray(column.cards)
              ? column.cards.map(card=>String(card))
              : []
          }))
      : [],
    settings:normalizarConfiguracion(
      workspace?.settings || legacySettings
    ),
    canvasLayout:normalizarDisenoLienzo(
      workspace?.canvasLayout,
      index
    )
  }))

  overviewSettings=normalizarConfiguracion(
    data.overviewSettings
  )
  canvasTransform=normalizarTransformLienzo(
    data.canvasTransform
  )
  views=Array.isArray(data.views)
    ? data.views.map(normalizarVista)
    : []

  activeWorkspace=workspaces.some(
    workspace=>workspace.id===String(data.activeWorkspace)
  )
    ? String(data.activeWorkspace)
    : workspaces[0].id

  let current=workspaces.find(
    workspace=>workspace.id===activeWorkspace
  )

  workspaceBoards.clear()
  boardPreparationVersion++
  dibujarTablero(current.board,current.id)
  aplicarConfiguracion(current.settings)
  dibujarWorkspaces()
  dibujarMenuVistas()
  prepararTablerosRestantes()
  await guardar({inmediato:true})
}


async function cargar(){

  let initialBoard=
    leerTablero()

  let stored=
    await chrome.storage.local.get([
      STORAGE,
      THEME_STORAGE
    ])

  let data=
    stored[STORAGE] || {}

  let storedTheme=
    stored[THEME_STORAGE]

  if(
    storedTheme==='dark' ||
    storedTheme==='light'
  )
    aplicarTema(storedTheme)


  let legacySettings={
    columns:data.columns,
    height:data.height,
    minWidth:data.minWidth,
    view:data.view
  }

  overviewSettings=normalizarConfiguracion(
    data.overviewSettings
  )
  canvasTransform=normalizarTransformLienzo(
    data.canvasTransform
  )
  views=Array.isArray(data.views)
    ? data.views.map(normalizarVista)
    : []


  workspaces=Array.isArray(data.workspaces) &&
    data.workspaces.length
      ? data.workspaces.map((workspace,index)=>({
          id:String(workspace.id || `workspace-${index+1}`),
          title:String(workspace.title || `Tablero ${index+1}`),
          board:Array.isArray(workspace.board)
            ? workspace.board
            : [],
          settings:normalizarConfiguracion(
            workspace.settings || legacySettings
          ),
          canvasLayout:normalizarDisenoLienzo(
            workspace.canvasLayout,
            index
          )
        }))
      : [{
          id:'workspace-1',
          title:'Tablero 1',
          board:Array.isArray(data.board)
            ? data.board
            : initialBoard,
          settings:normalizarConfiguracion(legacySettings),
          canvasLayout:normalizarDisenoLienzo({},0)
        }]

  activeWorkspace=workspaces.some(
    workspace=>workspace.id===data.activeWorkspace
  )
    ? data.activeWorkspace
    : workspaces[0].id

  let current=workspaces.find(
    workspace=>workspace.id===activeWorkspace
  )

  workspaceBoards.clear()
  boardPreparationVersion++
  dibujarTablero(current.board,current.id)
  aplicarConfiguracion(current.settings)
  dibujarWorkspaces()
  dibujarMenuVistas()
  prepararTablerosRestantes()
  await guardar({inmediato:true})
}


function editar(el,seleccionar=false){

  el.contentEditable=true
  el.draggable=false
  el.focus({preventScroll:true})

  let range=
    document.createRange()

  range.selectNodeContents(el)

  if(!seleccionar)
    range.collapse(false)

  let selection=
    window.getSelection()

  selection.removeAllRanges()
  selection.addRange(range)
}


columns.oninput=()=>{

  ajustarColumnas()
  guardar({tablero:false})
}


view.onchange=()=>{

  ajustarColumnas()
  guardar({tablero:false})
}


height.oninput=()=>{

  document.documentElement.style
    .setProperty(
      '--height',
      height.value+'px'
    )

  guardar({tablero:false})
}


minWidth.oninput=()=>{

  ajustarColumnas()
  guardar({tablero:false})
}


window.addEventListener(
  'resize',
  ajustarColumnas
)


document.addEventListener(
  'contextmenu',
  e=>{

    let workspaceTab=
      e.target.closest('.workspace-tab')

    let card=e.target.closest('.card')
    let column=e.target.closest('.column')
    let overviewWorkspace=
      e.target.closest('.overview-workspace')

    if(
      workspaceTab &&
      workspaceTabs.contains(workspaceTab)
    ){
      e.preventDefault()
      contextTarget=workspaceTab
      editContext.hidden=false
      addColumnContext.hidden=false
      copyContext.hidden=true
      pasteContext.hidden=true
      duplicateContext.hidden=true
      moveContext.hidden=true
      deleteContext.hidden=false
      deleteContext.textContent='Eliminar tablero'
    }else if(
      column &&
      kanban.contains(column)
    ){
      e.preventDefault()
      contextTarget=card || column
      editContext.hidden=true
      addColumnContext.hidden=true
      copyContext.hidden=false
      pasteContext.hidden=internalClipboard?.type!=='card'
      duplicateContext.hidden=false
      moveContext.hidden=false
      deleteContext.hidden=false

      if(card && !selectedCards.has(card))
        seleccionarTarjetas([card])

      if(!card && !selectedColumns.has(column))
        seleccionarColumnas([column])

      deleteContext.textContent=
        card
          ? selectedCards.has(card) && selectedCards.size>1
            ? `Eliminar ${selectedCards.size} tarjetas`
            : 'Eliminar tarjeta'
          : selectedColumns.has(column) && selectedColumns.size>1
            ? `Eliminar ${selectedColumns.size} columnas`
            : 'Eliminar columna'
    }else if(
      overviewWorkspace &&
      kanban.contains(overviewWorkspace)
    ){
      e.preventDefault()
      contextTarget=overviewWorkspace
      seleccionarTableroVista(overviewWorkspace)
      editContext.hidden=false
      addColumnContext.hidden=false
      copyContext.hidden=true
      pasteContext.hidden=true
      duplicateContext.hidden=true
      moveContext.hidden=true
      deleteContext.hidden=false
      deleteContext.textContent='Eliminar tablero'
    }else if(
      !overviewMode &&
      kanban.contains(e.target) &&
      internalClipboard?.type==='column'
    ){
      e.preventDefault()
      contextTarget=kanban
      editContext.hidden=true
      addColumnContext.hidden=true
      copyContext.hidden=true
      pasteContext.hidden=false
      duplicateContext.hidden=true
      moveContext.hidden=true
      deleteContext.hidden=true
    }else{
      cerrarMenuContextual()
      return
    }

    contextMenu.hidden=false

    let rect=contextMenu.getBoundingClientRect()

    contextMenu.style.left=
      Math.max(
        6,
        Math.min(e.clientX,innerWidth-rect.width-6)
      )+'px'

    contextMenu.style.top=
      Math.max(
        6,
        Math.min(e.clientY,innerHeight-rect.height-6)
      )+'px'

    contextMenu.classList.toggle(
      'open-left',
      e.clientX+rect.width+460>innerWidth
    )
  }
)


editContext.onclick=async()=>{

  let target=contextTarget
  cerrarMenuContextual()

  if(
    !target?.matches(
      '.workspace-tab,.overview-workspace'
    )
  )
    return

  let workspace=workspaces.find(
    item=>item.id===target.dataset.workspace
  )

  if(!workspace)
    return

  let title=await pedirNombre(
    'Renombrar tablero',
    'Escribe el nuevo nombre del tablero.',
    workspace.title
  )

  if(!title?.trim())
    return

  workspace.title=title.trim()

  if(overviewMode){
    let overviewTitle=kanban.querySelector(
      `.overview-workspace[data-workspace="${CSS.escape(workspace.id)}"] .overview-open`
    )

    if(overviewTitle)
      overviewTitle.textContent=workspace.title
  }

  guardar({tablero:false,configuracion:false})
}


addColumnContext.onclick=()=>{

  let target=contextTarget
  let workspaceId=target?.dataset.workspace
  cerrarMenuContextual()

  if(!workspaceId)
    return

  let workspace=workspaces.find(
    item=>item.id===workspaceId
  )

  if(!workspace)
    return

  let visibleContainer=overviewMode
    ? kanban.querySelector(
        `.overview-workspace[data-workspace="${CSS.escape(workspaceId)}"] .overview-columns`
      )
    : workspaceId===activeWorkspace
      ? kanban
      : null

  if(visibleContainer){
    let count=visibleContainer.querySelectorAll(
      ':scope > .column'
    ).length
    let column=crearColumna({
      title:`Nueva columna ${count+1}`
    })

    visibleContainer.querySelector('.overview-empty')?.remove()
    visibleContainer.append(column)
    actualizarVaciosVistaGeneral()
    ajustarColumnas()
    guardar()
    editar(column.querySelector('h3'),true)
    return
  }

  workspace.board.push({
    title:`Nueva columna ${workspace.board.length+1}`,
    cards:[]
  })
  workspaceBoards.delete(workspaceId)
  guardar({tablero:false,configuracion:false})
}


copyContext.onclick=async()=>{

  let target=contextTarget
  cerrarMenuContextual()

  if(
    !target ||
    target.matches('.workspace-tab,.overview-workspace')
  )
    return

  let text

  if(target.matches('.card')){
    let cards=selectedCards.has(target)
      ? [...kanban.querySelectorAll('.card')]
          .filter(card=>selectedCards.has(card))
      : [target]

    internalClipboard={
      type:'card',
      items:cards.map(card=>card.innerHTML)
    }
    text=cards.map(obtenerTextoPlano).join('\n')
  }else{
    let columns=selectedColumns.has(target)
      ? [...kanban.querySelectorAll('.column')]
          .filter(column=>selectedColumns.has(column))
      : [target]
    let items=columns.map(column=>({
      title:column.querySelector('h3').innerHTML,
      cards:[...column.querySelectorAll('.card')]
        .map(card=>card.innerHTML)
    }))

    internalClipboard={type:'column',items}
    text=columns.map(column=>[
      obtenerTextoPlano(column.querySelector('h3')),
      ...[...column.querySelectorAll('.card')]
        .map(obtenerTextoPlano)
    ].filter(Boolean).join('\n')).join('\n\n')
  }

  await copiarAlPortapapeles(text)
}


function textoDesdeHtml(html){

  let element=document.createElement('div')

  element.innerHTML=html
  return element.textContent.trim()
}


function sincronizarModeloVisible(){

  if(overviewMode){
    sincronizarDesdeVistaGeneral()
    return
  }

  let current=workspaces.find(
    workspace=>workspace.id===activeWorkspace
  )

  if(current)
    current.board=leerTablero()
}


function crearOpcionesMover(target){

  sincronizarModeloVisible()
  moveMenu.replaceChildren()

  let card=target.matches('.card')

  workspaces.forEach(workspace=>{
    if(card){
      let option=document.createElement('div')
      let trigger=document.createElement('button')
      let columnsMenu=document.createElement('div')

      option.className='move-workspace-option'
      trigger.className='move-workspace-trigger'
      trigger.type='button'
      trigger.textContent=workspace.title
      columnsMenu.className='move-columns-menu'

      ;(workspace.board || []).forEach((column,index)=>{
        let button=document.createElement('button')

        button.type='button'
        button.dataset.workspace=workspace.id
        button.dataset.column=String(index)
        button.textContent=textoDesdeHtml(column.title)
        columnsMenu.append(button)
      })

      if(!columnsMenu.children.length){
        let empty=document.createElement('button')

        empty.type='button'
        empty.disabled=true
        empty.textContent='Sin columnas'
        columnsMenu.append(empty)
      }

      option.append(trigger,columnsMenu)
      moveMenu.append(option)
      return
    }

    let button=document.createElement('button')

    button.type='button'
    button.dataset.workspace=workspace.id
    button.textContent=workspace.title
    moveMenu.append(button)
  })
}


function moverSeleccionA(workspaceId,columnIndex){

  let targetWorkspace=workspaces.find(
    workspace=>workspace.id===workspaceId
  )

  if(!targetWorkspace)
    return

  let target=contextTarget
  let card=target?.matches('.card')
  let items=card
    ? selectedCards.has(target)
      ? [...kanban.querySelectorAll('.card')]
          .filter(item=>selectedCards.has(item))
      : [target]
    : selectedColumns.has(target)
      ? [...kanban.querySelectorAll('.column')]
          .filter(item=>selectedColumns.has(item))
      : [target]

  if(!items.length)
    return

  if(overviewMode){
    let workspaceElement=kanban.querySelector(
      `.overview-workspace[data-workspace="${CSS.escape(workspaceId)}"]`
    )

    if(card){
      let column=workspaceElement
        ?.querySelectorAll('.overview-columns > .column')
        [columnIndex]
      let container=column?.querySelector('.cards')

      if(!container)
        return

      container.append(...items)
    }else{
      let container=workspaceElement
        ?.querySelector('.overview-columns')

      if(!container)
        return

      container.querySelector('.overview-empty')?.remove()
      container.append(...items)
      actualizarVaciosVistaGeneral()
    }

    limpiarSeleccion()
    guardar()
    return
  }

  if(card){
    let contents=items.map(item=>item.innerHTML)

    if(workspaceId===activeWorkspace){
      let column=[...kanban.children]
        .filter(item=>item.matches('.column'))
        [columnIndex]
      let container=column?.querySelector('.cards')

      if(!container)
        return

      container.append(...items)
    }else{
      items.forEach(item=>item.remove())
      let column=targetWorkspace.board[columnIndex]

      if(!column)
        return

      column.cards.push(...contents)
      workspaceBoards.delete(workspaceId)
    }
  }else{
    let contents=items.map(column=>({
      title:column.querySelector('h3').innerHTML,
      cards:[...column.querySelectorAll('.card')]
        .map(item=>item.innerHTML)
    }))

    if(workspaceId===activeWorkspace)
      kanban.append(...items)
    else{
      items.forEach(item=>item.remove())
      targetWorkspace.board.push(...contents)
      workspaceBoards.delete(workspaceId)
    }
  }

  limpiarSeleccion()
  guardar()
}


moveContext.onclick=()=>{

  if(!contextTarget)
    return

  if(moveMenu.hidden)
    crearOpcionesMover(contextTarget)

  moveMenu.hidden=!moveMenu.hidden
}


moveMenu.onclick=e=>{

  let trigger=e.target.closest('.move-workspace-trigger')

  if(trigger){
    let option=trigger.closest('.move-workspace-option')

    moveMenu.querySelectorAll('.move-workspace-option.open')
      .forEach(item=>{
        if(item!==option)
          item.classList.remove('open')
      })
    option.classList.toggle('open')
    return
  }

  let option=e.target.closest(
    'button[data-workspace]'
  )

  if(!option)
    return

  let workspaceId=option.dataset.workspace
  let columnIndex=option.dataset.column===undefined
    ? undefined
    : Number(option.dataset.column)

  moverSeleccionA(workspaceId,columnIndex)
  cerrarMenuContextual()
}


pasteContext.onclick=()=>{

  let target=contextTarget
  let clipboard=internalClipboard
  cerrarMenuContextual()

  if(!target || !clipboard)
    return

  if(
    clipboard.type==='column' &&
    target===kanban
  ){
    let columns=clipboard.items.map(item=>
      crearColumna(structuredClone(item))
    )

    kanban.append(...columns)
    seleccionarColumnas(columns)
    ajustarColumnas()
    guardar()
    return
  }

  if(clipboard.type!=='card')
    return

  let column=target.closest('.column')

  if(!column)
    return

  let cards=clipboard.items.map(crearTarjeta)
  let reference=target.matches('.card')
    ? target.nextSibling
    : null
  let container=column.querySelector('.cards')

  cards.forEach(card=>container.insertBefore(card,reference))
  seleccionarTarjetas(cards)
  guardar()
}


duplicateContext.onclick=()=>{

  let target=contextTarget
  cerrarMenuContextual()

  if(
    !target ||
    target.matches('.workspace-tab,.overview-workspace')
  )
    return

  let duplicate=target.cloneNode(true)
  let card=target.matches('.card')

  duplicate.classList.remove('dragging','selected')
  duplicate.contentEditable=false
  duplicate.draggable=card

  duplicate.querySelectorAll('.card,h3')
    .forEach(item=>{
      item.classList.remove('dragging','selected')
      item.contentEditable=false
      item.draggable=true
    })

  target.after(duplicate)

  if(card)
    seleccionarTarjetas([duplicate])
  else
    seleccionarColumna(duplicate)

  ajustarColumnas()
  guardar()
}


deleteContext.onclick=async()=>{

  let target=contextTarget
  let card=target?.matches('.card')
  let workspace=target?.matches(
    '.workspace-tab,.overview-workspace'
  )
  let column=target?.matches('.column')
  let cardTargets=card && selectedCards.has(target)
    ? [...kanban.querySelectorAll('.card')]
        .filter(item=>selectedCards.has(item))
    : card
      ? [target]
      : []
  let columnTargets=column && selectedColumns.has(target)
    ? [...kanban.querySelectorAll('.column')]
        .filter(item=>selectedColumns.has(item))
    : column
      ? [target]
      : []
  let multipleCards=cardTargets.length>1
  let multipleColumns=columnTargets.length>1
  let type=workspace
    ? 'tablero'
    : card
      ? multipleCards
        ? 'tarjetas'
        : 'tarjeta'
      : multipleColumns
        ? 'columnas'
        : 'columna'

  let label=workspace
    ? target.querySelector(
        '.overview-open,span'
      )
        ?.textContent.trim()
    : card
      ? multipleCards
        ? `${cardTargets.length} tarjetas seleccionadas`
        : target.textContent.trim()
      : multipleColumns
        ? `${columnTargets.length} columnas seleccionadas`
        : target?.querySelector('h3')
            ?.textContent.trim()

  cerrarMenuContextual()

  if(!target)
    return

  let accepted=await pedirConfirmacion(
    `Eliminar ${type}`,
    multipleCards || multipleColumns
      ? `Vas a eliminar ${label}. Esta accion no se puede deshacer.`
      : `Vas a eliminar ${type==='tablero' ? 'el' : 'la'} ${type} "${label || ''}". Esta accion no se puede deshacer.`
  )

  if(
    !accepted ||
    (card
      ? !cardTargets.some(item=>item.isConnected)
      : column
        ? !columnTargets.some(item=>item.isConnected)
        : !target.isConnected)
  )
    return

  if(workspace){
    let id=target.dataset.workspace
    let deletingActive=id===activeWorkspace
    let deletingFromOverview=overviewMode
    let index=workspaces.findIndex(
      item=>item.id===id
    )

    workspaces=workspaces.filter(
      item=>item.id!==id
    )
    views.forEach(viewItem=>{
      viewItem.workspaceIds=
        viewItem.workspaceIds.filter(
          workspaceId=>workspaceId!==id
        )
    })
    workspaceBoards.delete(id)

    if(!workspaces.length)
      workspaces.push({
        id:crypto.randomUUID?.() ||
          `workspace-${Date.now()}`,
        title:'Tablero 1',
        board:[{
          title:'Nueva columna 1',
          cards:[]
        }],
        settings:normalizarConfiguracion(),
        canvasLayout:normalizarDisenoLienzo({},0)
      })

    if(deletingFromOverview){
      if(deletingActive)
        activeWorkspace=workspaces[
          Math.min(
            Math.max(index,0),
            workspaces.length-1
          )
        ].id

      dibujarVistaGeneral()
    }else if(deletingActive){
      let next=workspaces[
        Math.min(
          Math.max(index,0),
          workspaces.length-1
        )
      ]

      mostrarTablero(
        next.id,
        {preservarActual:false}
      )
      aplicarConfiguracion(next.settings)
    }else{
      ajustarColumnas()
    }

    prepararTablerosRestantes()
    guardar()
    return
  }

  if(card){
    cardTargets.forEach(item=>item.remove())
    limpiarSeleccion()
    guardar()
    return
  }

  columnTargets.forEach(item=>item.remove())
  limpiarSeleccion()
  actualizarVaciosVistaGeneral()
  ajustarColumnas()
  guardar()
}


document.addEventListener(
  'click',
  e=>{

    if(!contextMenu.contains(e.target))
      cerrarMenuContextual()
  },
  true
)


document.addEventListener(
  'keydown',
  e=>{

    if(e.key==='Escape'){
      cerrarMenuContextual()
      dataMenu.hidden=true
      viewMenu.hidden=true

      if(!confirmModal.hidden)
        cerrarModal()
    }
  }
)


window.addEventListener(
  'scroll',
  cerrarMenuContextual,
  true
)


window.addEventListener(
  'resize',
  cerrarMenuContextual
)


function obtenerOrigenArrastre(target){

  let workspaceTab=target.closest?.('.workspace-tab')

  if(
    workspaceTab &&
    workspaceTabs.contains(workspaceTab)
  )
    return {element:workspaceTab,handle:workspaceTab}

  let card=target.closest?.('.card')

  if(card && kanban.contains(card))
    return {element:card,handle:card}

  let column=target.closest?.('.column')

  if(
    column &&
    kanban.contains(column) &&
    !target.closest?.('button,input,select,textarea,a')
  )
    return {
      element:column,
      handle:target.closest?.('h3') || column
    }

  let overviewWorkspace=
    target.closest?.('.overview-workspace')

  if(
    overviewMode &&
    !canvasMode &&
    overviewWorkspace &&
    kanban.contains(overviewWorkspace) &&
    (!target.closest?.('button,input,select,textarea,a') ||
      target.closest?.('.overview-open'))
  )
    return {
      element:overviewWorkspace,
      handle:overviewWorkspace
    }

  return null
}


function obtenerPuntoLienzo(clientX,clientY){

  let rect=kanban.getBoundingClientRect()
  let scale=rect.width/kanban.offsetWidth

  if(!Number.isFinite(scale) || scale<=0)
    scale=canvasPanzoom?.getScale() || 1

  return {
    x:(clientX-rect.left)/scale,
    y:(clientY-rect.top)/scale
  }
}


function iniciarGestoTableroLienzo(e){

  if(!canvasMode || e.button!==0)
    return false

  let workspace=e.target.closest?.('.overview-workspace')
  let resize=e.target.closest?.('.canvas-resize-handle')
  let header=e.target.closest?.('.overview-workspace-header')

  if(
    !workspace ||
    !kanban.contains(workspace) ||
    (!resize && !header) ||
    (!resize && e.target.closest?.(
      '[contenteditable="true"],button,input,select,textarea,a'
    ))
  )
    return false

  seleccionarTableroVista(workspace)

  let current=workspaces.find(
    item=>item.id===workspace.dataset.workspace
  )
  let layout=normalizarDisenoLienzo(
    current?.canvasLayout
  )
  let highest=workspaces.reduce(
    (maximum,item)=>Math.max(
      maximum,
      Number(item.canvasLayout?.z) || 0
    ),
    0
  )

  layout.z=highest+1

  if(current)
    current.canvasLayout=layout

  workspace.style.zIndex=layout.z
  workspace.classList.add(
    resize ? 'canvas-resizing' : 'canvas-moving'
  )
  let point=obtenerPuntoLienzo(
    e.clientX,
    e.clientY
  )

  canvasBoardGesture={
    pointerId:e.pointerId,
    workspace,
    current,
    resize:!!resize,
    startX:point.x,
    startY:point.y,
    x:parseFloat(workspace.style.left) || 0,
    y:parseFloat(workspace.style.top) || 0,
    width:workspace.offsetWidth,
    height:workspace.offsetHeight,
    grabX:point.x-(parseFloat(workspace.style.left) || 0),
    grabY:point.y-(parseFloat(workspace.style.top) || 0)
  }
  workspace.setPointerCapture?.(e.pointerId)
  e.preventDefault()
  return true
}


function moverTableroLienzo(e){

  let gesture=canvasBoardGesture

  if(
    !gesture ||
    gesture.pointerId!==e.pointerId
  )
    return false

  let point=obtenerPuntoLienzo(
    e.clientX,
    e.clientY
  )
  let deltaX=point.x-gesture.startX
  let deltaY=point.y-gesture.startY

  if(gesture.resize){
    gesture.workspace.style.width=
      `${Math.max(220,gesture.width+deltaX)}px`
    gesture.workspace.style.height=
      `${Math.max(160,gesture.height+deltaY)}px`
  }else{
    gesture.workspace.style.left=
      `${point.x-gesture.grabX}px`
    gesture.workspace.style.top=
      `${point.y-gesture.grabY}px`
  }

  e.preventDefault()
  return true
}


function terminarGestoTableroLienzo(e){

  let gesture=canvasBoardGesture

  if(
    !gesture ||
    gesture.pointerId!==e.pointerId
  )
    return false

  canvasBoardGesture=null
  gesture.workspace.classList.remove(
    'canvas-moving',
    'canvas-resizing'
  )

  if(gesture.current)
    gesture.current.canvasLayout=normalizarDisenoLienzo({
      x:parseFloat(gesture.workspace.style.left),
      y:parseFloat(gesture.workspace.style.top),
      width:gesture.workspace.offsetWidth,
      height:gesture.workspace.offsetHeight,
      z:parseFloat(gesture.workspace.style.zIndex)
    })

  guardarTransformLienzo()
  e.preventDefault()
  return true
}


function iniciarArrastre(element,e){

  if(drag)
    return false

  if(document.activeElement?.isContentEditable)
    document.activeElement.blur()

  if(element.matches('.overview-workspace'))
    seleccionarTableroVista(element)

  drag=element
  columnDropTarget=null
  columnPlaceholders=[]
  columnOriginalLayouts=[]
  columnOverPlaceholder=false
  overviewDropTarget=null
  overviewPlaceholder=null
  overviewOriginalOrder=[]
  overviewOverPlaceholder=false
  cardDropTarget=null
  cardPlaceholders=[]
  cardOriginalLayouts=[]
  cardOverPlaceholder=false
  cardPointerY=undefined
  cardPointerDirection=0
  cardPointerContainer=null
  workspaceDragMoved=false

  if(drag.matches('.card')){
    if(!selectedCards.has(drag))
      seleccionarTarjetas([drag])

    draggedCards=[...kanban.querySelectorAll('.card')]
      .filter(card=>selectedCards.has(card))
  }else{
    draggedCards=[]

    if(drag.matches('.column')){
      if(!selectedColumns.has(drag))
        seleccionarColumnas([drag])

      draggedColumns=[...kanban.querySelectorAll('.column')]
        .filter(column=>selectedColumns.has(column))
    }else{
      draggedColumns=[]
    }
  }

  document.documentElement.classList.add('is-dragging')
  crearDragImage(drag,e)

  ;(draggedCards.length
      ? draggedCards
      : draggedColumns.length
        ? draggedColumns
        : [drag])
    .forEach(item=>item.classList.add('dragging'))

  if(drag.matches('.column'))
    prepararArrastreColumnas()
  else if(drag.matches('.card'))
    prepararArrastreTarjetas()
  else if(drag.matches('.overview-workspace'))
    prepararArrastreVistaGeneral()

  return true
}


function programarArrastre(target,x,y){

  pendingDragPoint={target,x,y}

  if(dragFrame)
    return

  dragFrame=requestAnimationFrame(()=>{
    dragFrame=null

    let point=pendingDragPoint
    pendingDragPoint=null

    if(point)
      procesarArrastre(
        point.target,
        point.x,
        point.y
      )
  })
}


function prepararArrastreColumnas(){

  let containers=overviewMode
    ? [...kanban.querySelectorAll('.overview-columns')]
    : [kanban]

  columnOriginalLayouts=containers.map(container=>({
    container,
    children:[...container.children]
  }))

  let first=draggedColumns[0]
  let fragment=document.createDocumentFragment()

  draggedColumns.forEach(column=>{
    let placeholder=document.createElement('section')

    placeholder.className='column-placeholder'
    placeholder.setAttribute('aria-hidden','true')
    placeholder.style.height=
      `${column.offsetHeight}px`
    columnPlaceholders.push(placeholder)
    fragment.append(placeholder)
    column.classList.add('column-drag-source')
  })

  first.before(fragment)
}


function prepararArrastreVistaGeneral(){

  overviewOriginalOrder=[...kanban.children]
  overviewPlaceholder=document.createElement('section')
  overviewPlaceholder.className=
    'overview-workspace-placeholder'
  overviewPlaceholder.setAttribute('aria-hidden','true')
  overviewPlaceholder.style.height=
    `${drag.offsetHeight}px`
  drag.before(overviewPlaceholder)
  drag.classList.add('overview-workspace-drag-source')
}


function puntoSobreMarcadorVistaGeneral(x,y){

  if(!overviewPlaceholder?.isConnected)
    return false

  let rect=overviewPlaceholder.getBoundingClientRect()

  return (
    x>=rect.left &&
    x<=rect.right &&
    y>=rect.top &&
    y<=rect.bottom
  )
}


function actualizarDestinoVistaGeneral(target,x,y){

  if(!target){
    overviewOverPlaceholder=
      puntoSobreMarcadorVistaGeneral(x,y)

    if(!overviewOverPlaceholder)
      overviewDropTarget=null

    return
  }

  if(
    overviewDropTarget===target &&
    !overviewOverPlaceholder
  )
    return

  let layout=[...kanban.children]
    .filter(item=>
      !item.classList.contains(
        'overview-workspace-drag-source'
      )
    )
  let targetIndex=layout.indexOf(target)
  let placeholderIndex=layout.indexOf(overviewPlaceholder)

  if(placeholderIndex < targetIndex)
    target.after(overviewPlaceholder)
  else
    target.before(overviewPlaceholder)

  overviewDropTarget=target
  overviewOverPlaceholder=false
}


function resolverArrastreVistaGeneral(cancelado){

  let aplicar=
    !cancelado &&
    overviewDropTarget?.isConnected

  drag.classList.remove('overview-workspace-drag-source')

  if(aplicar)
    overviewPlaceholder.replaceWith(drag)
  else{
    overviewPlaceholder?.remove()
    kanban.replaceChildren(...overviewOriginalOrder)
  }

  let byId=new Map(
    workspaces.map(workspace=>[workspace.id,workspace])
  )

  let ordered=[...kanban.querySelectorAll('.overview-workspace')]
    .map(section=>byId.get(section.dataset.workspace))
    .filter(Boolean)
  let visibleIds=new Set(
    ordered.map(workspace=>workspace.id)
  )
  let nextIndex=0

  workspaces=workspaces.map(workspace=>
    visibleIds.has(workspace.id)
      ? ordered[nextIndex++]
      : workspace
  )
  dibujarWorkspaces()
}


function prepararArrastreTarjetas(){

  cardOriginalLayouts=[
    ...kanban.querySelectorAll('.cards')
  ].map(container=>({
    container,
    cards:[...container.querySelectorAll('.card')]
  }))

  let first=draggedCards[0]
  let fragment=document.createDocumentFragment()

  draggedCards.forEach(card=>{
    let placeholder=document.createElement('div')

    placeholder.className='card-placeholder'
    placeholder.setAttribute('aria-hidden','true')
    placeholder.style.height=
      `${card.offsetHeight}px`
    cardPlaceholders.push(placeholder)
    fragment.append(placeholder)
    card.classList.add('card-drag-source')
  })

  first.before(fragment)
}


function puntoSobreMarcadorTarjetas(x,y){

  return cardPlaceholders.some(placeholder=>{
    let rect=placeholder.getBoundingClientRect()

    return (
      x>=rect.left &&
      x<=rect.right &&
      y>=rect.top &&
      y<=rect.bottom
    )
  })
}


function actualizarDestinoTarjetas(container,next,x,y){

  if(!container){
    cardDropTarget=null
    cardOverPlaceholder=false
    return
  }

  cardOverPlaceholder=
    puntoSobreMarcadorTarjetas(x,y)

  if(
    cardOverPlaceholder &&
    cardDropTarget?.container===container
  )
    return

  if(
    cardDropTarget?.container===container &&
    cardDropTarget?.next===next
  )
    return

  let fragment=document.createDocumentFragment()

  cardPlaceholders.forEach(
    placeholder=>fragment.append(placeholder)
  )
  container.insertBefore(fragment,next || null)
  cardDropTarget={container,next}
  cardOverPlaceholder=false
}


function resolverArrastreTarjetas(cancelado){

  let aplicar=
    !cancelado &&
    cardDropTarget?.container?.isConnected

  if(aplicar){
    cardPlaceholders.forEach((placeholder,index)=>{
      let card=draggedCards[index]

      card.classList.remove('card-drag-source')
      placeholder.replaceWith(card)
    })
  }else{
    cardPlaceholders.forEach(
      placeholder=>placeholder.remove()
    )
    draggedCards.forEach(
      card=>card.classList.remove('card-drag-source')
    )
    cardOriginalLayouts.forEach(({container,cards})=>{
      container.replaceChildren(...cards)
    })
  }

  actualizarContadoresColumnas()
}


function obtenerSiguienteTarjeta(container,y,direction){

  let cards=[
    ...container.querySelectorAll(
      '.card:not(.dragging)'
    )
  ]

  if(!cards.length)
    return null

  let positions=cards.map(card=>({
    card,
    rect:card.getBoundingClientRect()
  }))
  let hoveredIndex=positions.findIndex(({rect})=>
    y>=rect.top && y<=rect.bottom
  )

  if(hoveredIndex>=0){
    let hovered=positions[hoveredIndex]

    if(direction<0)
      return hovered.card

    if(direction>0)
      return positions[hoveredIndex+1]?.card || null

    return y < hovered.rect.top+hovered.rect.height/2
      ? hovered.card
      : positions[hoveredIndex+1]?.card || null
  }

  return positions.find(({rect})=>
    y < rect.top + rect.height/2
  )?.card || null
}


function puntoSobreMarcadorColumnas(x,y){

  return columnPlaceholders.some(placeholder=>{
    let rect=placeholder.getBoundingClientRect()

    return (
      x>=rect.left &&
      x<=rect.right &&
      y>=rect.top &&
      y<=rect.bottom
    )
  })
}


function actualizarDestinoColumnas(container,target,x,y){

  if(!container){
    columnDropTarget=null
    columnOverPlaceholder=false
    return
  }

  if(!target){
    columnOverPlaceholder=
      puntoSobreMarcadorColumnas(x,y)

    if(columnOverPlaceholder)
      return

    if(
      columnDropTarget?.container===container &&
      columnDropTarget?.target===null
    )
      return

    container.querySelector('.overview-empty')?.remove()

    let fragment=document.createDocumentFragment()

    columnPlaceholders.forEach(
      placeholder=>fragment.append(placeholder)
    )
    container.append(fragment)
    columnDropTarget={container,target:null}
    return
  }

  if(
    columnDropTarget?.container===container &&
    columnDropTarget?.target===target &&
    !columnOverPlaceholder
  )
    return

  let layout=[
    ...kanban.querySelectorAll(
      '.column,.column-placeholder'
    )
  ].filter(item=>
    !item.classList.contains('column-drag-source')
  )
  let targetIndex=layout.indexOf(target)
  let placeholderIndex=Math.min(
    ...columnPlaceholders.map(
      placeholder=>layout.indexOf(placeholder)
    )
  )
  let fragment=document.createDocumentFragment()

  columnPlaceholders.forEach(
    placeholder=>fragment.append(placeholder)
  )

  if(placeholderIndex < targetIndex)
    target.after(fragment)
  else
    target.before(fragment)

  container.querySelector('.overview-empty')?.remove()
  columnDropTarget={container,target}
  columnOverPlaceholder=false
}


function actualizarVaciosVistaGeneral(){

  if(!overviewMode)
    return

  kanban.querySelectorAll('.overview-columns')
    .forEach(container=>{
      let empty=container.querySelector('.overview-empty')

      if(container.querySelector('.column')){
        empty?.remove()
        return
      }

      if(!empty){
        empty=document.createElement('div')
        empty.className='overview-empty'
        empty.textContent='Sin columnas'
        container.append(empty)
      }
    })
}


function resolverArrastreColumnas(cancelado){

  let aplicar=
    !cancelado &&
    columnDropTarget?.container?.isConnected

  if(aplicar){
    columnPlaceholders.forEach((placeholder,index)=>{
      let column=draggedColumns[index]

      column.classList.remove('column-drag-source')
      placeholder.replaceWith(column)
    })
  }else{
    columnPlaceholders.forEach(
      placeholder=>placeholder.remove()
    )
    draggedColumns.forEach(
      column=>column.classList.remove('column-drag-source')
    )
    columnOriginalLayouts.forEach(({container,children})=>{
      container.replaceChildren(...children)
    })
  }

  actualizarVaciosVistaGeneral()
}


function finalizarArrastre({cancelado=false}={}){

  if(!drag)
    return

    if(dragFrame){
      cancelAnimationFrame(dragFrame)
      dragFrame=null
    }

    if(pendingDragPoint){
      let point=pendingDragPoint
      pendingDragPoint=null
      procesarArrastre(
        point.target,
        point.x,
        point.y
      )
    }

    let completedDrag=drag

    if(completedDrag?.matches('.card'))
      resolverArrastreTarjetas(cancelado)

    if(completedDrag?.matches('.column'))
      resolverArrastreColumnas(cancelado)

    if(completedDrag?.matches('.overview-workspace'))
      resolverArrastreVistaGeneral(cancelado)

    if(completedDrag?.matches('.workspace-tab')){
      let byId=new Map(
        workspaces.map(workspace=>[workspace.id,workspace])
      )

      workspaces=[
        ...workspaceTabs.querySelectorAll('.workspace-tab')
      ].map(tab=>byId.get(tab.dataset.workspace))
        .filter(Boolean)

      if(overviewMode){
        let sections=new Map(
          [...kanban.querySelectorAll('.overview-workspace')]
            .map(section=>[section.dataset.workspace,section])
        )

        kanban.replaceChildren(
          ...workspaces.map(workspace=>sections.get(workspace.id))
            .filter(Boolean)
        )
      }

      if(workspaceDragMoved)
        workspaceClickBlockedUntil=performance.now()+200
    }

    ;(draggedCards.length
        ? draggedCards
        : draggedColumns.length
          ? draggedColumns
          : [drag])
      .forEach(item=>item?.classList.remove('dragging'))
    document.documentElement.classList.remove('is-dragging')
    eliminarDragImage()

    drag=null
    draggedCards=[]
    draggedColumns=[]
    cardDropTarget=null
    cardPlaceholders=[]
    cardOriginalLayouts=[]
    cardOverPlaceholder=false
    cardPointerY=undefined
    cardPointerDirection=0
    cardPointerContainer=null
    columnDropTarget=null
    columnPlaceholders=[]
    columnOriginalLayouts=[]
    columnOverPlaceholder=false
    overviewDropTarget=null
    overviewPlaceholder=null
    overviewOriginalOrder=[]
    overviewOverPlaceholder=false

    if(completedDrag?.matches('.workspace-tab'))
      guardar({tablero:false,configuracion:false})
    else
      guardar()
}


document.addEventListener(
  'dragstart',
  e=>{

    let origin=obtenerOrigenArrastre(e.target)

    if(origin)
      iniciarArrastre(origin.element,e)
  }
)


document.addEventListener(
  'drag',
  e=>{

    if(
      dragImage &&
      (e.clientX || e.clientY)
    )
      moverDragImage(e.clientX,e.clientY)
  }
)


document.addEventListener(
  'dragend',
  finalizarArrastre
)


function procesarArrastre(eventTarget,clientX,clientY){

  if(!drag)
    return

  if(drag.matches('.workspace-tab')){

    if(!workspaceTabs.contains(eventTarget))
      return

    let next=[
      ...workspaceTabs.querySelectorAll(
        '.workspace-tab:not(.dragging)'
      )
    ].find(tab=>{
      let rect=tab.getBoundingClientRect()
      return clientX < rect.left + rect.width/2
    })

    if(drag.nextElementSibling===(next || null))
      return

    workspaceTabs.insertBefore(drag,next || null)
    workspaceDragMoved=true
    return
  }

  if(drag.matches('.overview-workspace')){
    let hovered=eventTarget.closest('.overview-workspace')

    actualizarDestinoVistaGeneral(
      hovered?.classList.contains(
        'overview-workspace-drag-source'
      )
        ? null
        : hovered,
      clientX,
      clientY
    )
    return
  }

  if(drag.matches('.card')){

      let column=
        eventTarget.closest('.column')

      if(!column){
        cardPointerY=undefined
        cardPointerDirection=0
        cardPointerContainer=null
        actualizarDestinoTarjetas(
          null,
          null,
          clientX,
          clientY
        )
        return
      }

      let cards=
        column.querySelector('.cards')

      if(cardPointerContainer!==cards){
        cardPointerContainer=cards
        cardPointerY=clientY
        cardPointerDirection=0
      }else{
        let delta=clientY-cardPointerY

        if(Math.abs(delta)>=1)
          cardPointerDirection=Math.sign(delta)

        cardPointerY=clientY
      }

      let next=obtenerSiguienteTarjeta(
        cards,
        clientY,
        cardPointerDirection
      )

      actualizarDestinoTarjetas(
        cards,
        next,
        clientX,
        clientY
      )

      return
  }


  if(drag.matches('.column')){

      let hovered=
        eventTarget.closest('.column')
      let container=hovered
        ? hovered.parentElement
        : eventTarget.closest('.overview-columns') ||
          (kanban.contains(eventTarget) && !overviewMode
            ? kanban
            : null)

      actualizarDestinoColumnas(
        container,
        hovered?.classList.contains('dragging')
          ? null
          : hovered,
        clientX,
        clientY
      )
  }
}


document.addEventListener(
  'dragover',
  e=>{

    e.preventDefault()

    if(dragImage)
      moverDragImage(e.clientX,e.clientY)

    if(!drag)
      return

    programarArrastre(
      e.target,
      e.clientX,
      e.clientY
    )
  }
)


document.addEventListener(
  'pointerdown',
  e=>{

    if(iniciarGestoTableroLienzo(e))
      return

    if(
      e.button!==0 ||
      pointerGesture ||
      canvasBoardGesture ||
      e.target.closest?.('[contenteditable="true"]')
    )
      return

    let origin=obtenerOrigenArrastre(e.target)

    if(!origin){
      if(!e.target.closest?.('.context-menu,.modal-backdrop'))
        limpiarSeleccion()
      return
    }

    let collapseOnClick=false

    if(origin.element.matches('.card')){
      collapseOnClick=
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        selectedCards.has(origin.element) &&
        selectedCards.size>1

      if(!collapseOnClick)
        seleccionarTarjeta(origin.element,e)
    }else if(origin.element.matches('.column')){
      collapseOnClick=
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        selectedColumns.has(origin.element) &&
        selectedColumns.size>1

      if(!collapseOnClick)
        seleccionarColumna(origin.element,e)
    }else if(origin.element.matches('.overview-workspace')){
      seleccionarTableroVista(origin.element)
    }else{
      limpiarSeleccion()
    }

    pointerGesture={
      pointerId:e.pointerId,
      origin,
      x:e.clientX,
      y:e.clientY,
      started:false,
      collapseOnClick,
      draggable:origin.handle.draggable
    }

    origin.handle.draggable=false
    origin.handle.setPointerCapture?.(e.pointerId)
    document.documentElement.classList.add('is-dragging')
  }
)


document.addEventListener(
  'pointermove',
  e=>{

    if(moverTableroLienzo(e))
      return

    let gesture=pointerGesture

    if(
      !gesture ||
      gesture.pointerId!==e.pointerId
    )
      return

    if(!gesture.started){
      if(
        Math.hypot(
          e.clientX-gesture.x,
          e.clientY-gesture.y
        ) < 5
      )
        return

      gesture.started=iniciarArrastre(
        gesture.origin.element,
        e
      )

      if(!gesture.started)
        return
    }

    e.preventDefault()
    moverDragImage(e.clientX,e.clientY)

    let target=document.elementFromPoint(
      e.clientX,
      e.clientY
    ) || e.target

    programarArrastre(
      target,
      e.clientX,
      e.clientY
    )
  },
  {passive:false}
)


function terminarGestoPuntero(e){

  if(terminarGestoTableroLienzo(e))
    return

  let gesture=pointerGesture

  if(
    !gesture ||
    gesture.pointerId!==e.pointerId
  )
    return

  pointerGesture=null
  gesture.origin.handle.draggable=gesture.draggable

  if(!gesture.started){
    document.documentElement.classList.remove('is-dragging')

    if(gesture.collapseOnClick)
      if(gesture.origin.element.matches('.card'))
        seleccionarTarjetas([gesture.origin.element])
      else
        seleccionarColumnas([gesture.origin.element])

    return
  }

  e.preventDefault()

  if(e.type!=='pointercancel'){
    let target=document.elementFromPoint(
      e.clientX,
      e.clientY
    ) || e.target

    pendingDragPoint={
      target,
      x:e.clientX,
      y:e.clientY
    }
  }

  finalizarArrastre({
    cancelado:e.type==='pointercancel'
  })
}


document.addEventListener(
  'pointerup',
  terminarGestoPuntero
)


document.addEventListener(
  'pointercancel',
  terminarGestoPuntero
)


document.addEventListener(
  'dblclick',
  e=>{

    if(
      !e.target.matches('.card,h3')
    )
      return

    editar(e.target)
  }
)


document.addEventListener(
  'keydown',
  e=>{

    if(
      !e.target.isContentEditable
    )
      return


    if(
      e.key==='Enter' &&
      e.shiftKey
    ){

      if(e.target.matches('h3')){

        e.preventDefault()
        e.target.blur()
      }

      return
    }


    if(e.key==='Enter'){

      e.preventDefault()
      e.target.blur()
    }
  }
)


document.addEventListener(
  'blur',
  e=>{

    if(
      !e.target.isContentEditable
    )
      return

    e.target.contentEditable=false
    e.target.draggable=true

    guardar()
  },
  true
)


document.addEventListener(
  'click',
  e=>{

    if(
      !e.target.matches('.add-card')
    )
      return

    let cards=
      e.target
        .closest('.column')
        .querySelector('.cards')

    let card=crearTarjeta(
      `Nueva tarjeta ${cards.querySelectorAll('.card').length+1}`
    )

    cards.append(card)

    cards.scrollTop=
      cards.scrollHeight

    guardar()

    editar(
      card,
      true
    )
  }
)


workspaceTabs.addEventListener(
  'click',
  e=>{

    if(performance.now() < workspaceClickBlockedUntil){
      e.preventDefault()
      return
    }

    let tab=
      e.target.closest('.workspace-tab')

    if(
      !tab ||
      (!overviewMode &&
        tab.dataset.workspace===activeWorkspace)
    )
      return

    guardar()

    let workspace=mostrarTablero(
      tab.dataset.workspace,
      {preservarActual:!overviewMode}
    )

    aplicarConfiguracion(workspace.settings)
    prepararTablerosRestantes()
    guardar()
  }
)


workspaceTabs.addEventListener(
  'wheel',
  e=>{

    if(
      workspaceTabs.scrollWidth <=
      workspaceTabs.clientWidth
    )
      return

    e.preventDefault()
    workspaceTabs.scrollLeft+=
      e.deltaY || e.deltaX
  },
  {passive:false}
)


dataButton.onclick=()=>{

  dataMenu.hidden=!dataMenu.hidden
}


viewButton.onclick=()=>{

  viewMenu.hidden=!viewMenu.hidden
}


document.addEventListener(
  'keydown',
  e=>{

    if(
      e.code!=='Space' ||
      e.repeat ||
      !canvasMode ||
      pointerGesture ||
      canvasBoardGesture ||
      drag ||
      e.target.closest?.(
        'input,textarea,select,[contenteditable="true"]'
      )
    )
      return

    e.preventDefault()
    establecerPaneoConEspacio(true)
  }
)


document.addEventListener(
  'keyup',
  e=>{

    if(e.code!=='Space' || !canvasSpacePressed)
      return

    e.preventDefault()
    establecerPaneoConEspacio(false)
  }
)


window.addEventListener(
  'blur',
  ()=>establecerPaneoConEspacio(false)
)


kanban.addEventListener(
  'panzoomchange',
  e=>{

    if(!canvasMode)
      return

    canvasTransform=normalizarTransformLienzo(
      e.detail
    )
    actualizarEscalaLienzo()
    guardarTransformLienzo()
  }
)


kanban.addEventListener(
  'panzoomstart',
  ()=>canvasViewport.classList.add('is-panning')
)


kanban.addEventListener(
  'panzoomend',
  ()=>canvasViewport.classList.remove('is-panning')
)


canvasViewport.addEventListener(
  'wheel',
  e=>{

    if(!canvasMode || !canvasPanzoom)
      return

    let overBoard=e.target.closest('.overview-workspace')

    if(overBoard && !e.ctrlKey && !e.metaKey)
      return

    e.preventDefault()
    canvasPanzoom.zoomWithWheel(e)
  },
  {passive:false}
)


canvasZoomOut.onclick=()=>{
  canvasPanzoom?.zoomOut({animate:true})
}


canvasZoomIn.onclick=()=>{
  canvasPanzoom?.zoomIn({animate:true})
}


canvasScale.onclick=()=>{
  canvasPanzoom?.zoom(1,{animate:true})
}


canvasFit.onclick=()=>{

  if(!canvasPanzoom)
    return

  let horizontalPadding=40
  let verticalPadding=40
  let width=Math.max(1,kanban.scrollWidth)
  let heightValue=Math.max(1,kanban.scrollHeight)
  let scale=Math.min(
    (canvasViewport.clientWidth-horizontalPadding)/width,
    (canvasViewport.clientHeight-verticalPadding)/heightValue,
    1
  )

  canvasPanzoom.zoom(
    Math.max(.35,scale),
    {animate:true}
  )
  requestAnimationFrame(()=>{
    canvasPanzoom?.pan(0,0,{animate:true})
  })
}


showOverview.onclick=()=>{

  viewMenu.hidden=true

  if(
    overviewMode &&
    !canvasMode &&
    activeViewId==='all'
  )
    return

  guardar()
  dibujarVistaGeneral('all',{lienzo:false})
  prepararTablerosRestantes()
  guardar({tablero:false})
}


showCanvas.onclick=()=>{

  viewMenu.hidden=true

  if(canvasMode && activeViewId==='all')
    return

  guardar()
  dibujarVistaGeneral('all',{lienzo:true})
  prepararTablerosRestantes()
  guardar({tablero:false})
}


savedViews.onclick=e=>{

  let button=e.target.closest('button[data-view]')

  if(!button)
    return

  viewMenu.hidden=true

  if(
    overviewMode &&
    !canvasMode &&
    activeViewId===button.dataset.view
  )
    return

  guardar()
  dibujarVistaGeneral(
    button.dataset.view,
    {lienzo:false}
  )
  prepararTablerosRestantes()
  guardar({tablero:false})
}


newView.onclick=async()=>{

  viewMenu.hidden=true

  let result=await pedirVista()

  if(!result)
    return

  guardar()

  let viewItem=normalizarVista({
    id:crypto.randomUUID?.() || `view-${Date.now()}`,
    title:result.title,
    workspaceIds:result.workspaceIds,
    settings:normalizarConfiguracion(),
    canvasLayout:normalizarDisenoLienzo(
      {},
      workspaces.length
    )
  },views.length)

  views.push(viewItem)
  dibujarMenuVistas()
  dibujarVistaGeneral(viewItem.id)
  prepararTablerosRestantes()
  guardar({tablero:false})
}


exportData.onclick=async()=>{

  dataMenu.hidden=true
  await exportarDatos()
}


importData.onclick=async()=>{

  dataMenu.hidden=true

  let file=await pedirArchivo()

  if(!file)
    return

  try{
    let data=JSON.parse(await file.text())
    await importarDatos(data)
  }catch{
    await mostrarMensaje(
      'No se pudo importar',
      'El archivo seleccionado no contiene datos válidos del Kanban.'
    )
  }
}


document.addEventListener(
  'click',
  e=>{

    if(!dataControl.contains(e.target))
      dataMenu.hidden=true

    if(!viewControl.contains(e.target))
      viewMenu.hidden=true
  }
)


document.querySelector('.add-workspace')
.onclick=async()=>{

  let suggested=
    `Tablero ${workspaces.length+1}`

  let title=await pedirNombre(
    'Agregar tablero',
    'Escribe el nombre del nuevo tablero.',
    suggested
  )

  if(title===null)
    return

  guardar()

  let id=
    crypto.randomUUID?.() ||
    `workspace-${Date.now()}`

  workspaces.push({
    id,
    title:title.trim() || suggested,
    board:[{
      title:'Nueva columna 1',
      cards:[]
    }],
    settings:normalizarConfiguracion()
  })

  let workspace=mostrarTablero(id)

  aplicarConfiguracion(
    workspace.settings
  )
  prepararTablerosRestantes()
  guardar()
}


document.querySelector('.add-column')
.onclick=()=>{

  let column=crearColumna({
    title:`Nueva columna ${kanban.querySelectorAll('.column').length+1}`
  })

  kanban.append(column)

  ajustarColumnas()
  guardar()

  editar(
    column.querySelector('h3'),
    true
  )
}


window.addEventListener(
  'pagehide',
  ()=>guardar({inmediato:true})
)


void cargar()
