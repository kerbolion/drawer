const STORAGE='kanban-data'
const THEME_STORAGE='minimal-builder-theme'
const COLUMN_MOVE_MARGIN=16
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

const cancelConfirm=
  document.querySelector('#cancel-confirm')

const acceptConfirm=
  document.querySelector('#accept-confirm')

const contextMenu=
  document.querySelector('#context-menu')

const copyContext=
  document.querySelector('#copy-context')

const duplicateContext=
  document.querySelector('#duplicate-context')

const deleteContext=
  document.querySelector('#delete-context')

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


function cerrarModal(value=null){

  confirmModal.hidden=true
  confirmFile.value=''
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


function cerrarMenuContextual(){

  contextMenu.hidden=true
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


cancelConfirm.onclick=()=>cerrarModal()

acceptConfirm.onclick=()=>{

  if(modalMode==='file'){
    let file=confirmFile.files[0]

    if(!file)
      return

    cerrarModal(file)
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

  if(e.key==='Enter')
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
let columnMoveAnchor
let workspaces=[]
let activeWorkspace=''
let saveQueue=Promise.resolve()


function moverDragImage(x,y){

  if(!dragImage)
    return

  dragImage.style.transform=
    `translate3d(${x-dragImageOffset.x}px,${y-dragImageOffset.y}px,0)`
}


function crearDragImage(element,e){

  let rect=element.getBoundingClientRect()

  dragImage?.remove()
  dragImage=element.cloneNode(true)
  dragImage.classList.remove('dragging')
  dragImage.classList.add('drag-image')
  dragImage.setAttribute('aria-hidden','true')
  dragImage.style.width=rect.width+'px'
  dragImage.style.height=rect.height+'px'

  dragImage
    .querySelectorAll('[draggable]')
    .forEach(item=>item.draggable=false)

  dragImage.draggable=false
  dragImageOffset={
    x:e.clientX-rect.left,
    y:e.clientY-rect.top
  }

  document.body.append(dragImage)

  let sourceCards=
    element.querySelector?.('.cards')

  let previewCards=
    dragImage.querySelector?.('.cards')

  if(sourceCards && previewCards)
    previewCards.scrollTop=sourceCards.scrollTop

  moverDragImage(e.clientX,e.clientY)

  let transparent=
    document.createElement('canvas')

  transparent.width=1
  transparent.height=1

  e.dataTransfer.effectAllowed='move'
  e.dataTransfer.setData('text/plain','')
  e.dataTransfer.setDragImage(transparent,0,0)
}


function eliminarDragImage(){

  dragImage?.remove()
  dragImage=null
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

  return [
    ...kanban.querySelectorAll('.column')
  ].map(column=>({

    title:
      column.querySelector('h3').innerHTML,

    cards:[
      ...column.querySelectorAll('.card')
    ].map(card=>card.innerHTML)
  }))
}


function crearColumna(item={}){

  let column=
    document.createElement('section')

  column.className='column'

  column.innerHTML=`
    <h3 draggable="true"></h3>
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

    let card=
      document.createElement('div')

    card.className='card'
    card.draggable=true
    card.innerHTML=text

    cards.append(card)
  })

  return column
}


function dibujarTablero(board){

  kanban.replaceChildren(
    ...(board || []).map(crearColumna)
  )
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
        (workspace.id===activeWorkspace
          ? ' active'
          : '')

      button.dataset.workspace=workspace.id
      button.type='button'

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


function guardar(){

  let current=
    workspaces.find(
      workspace=>workspace.id===activeWorkspace
    )

  if(current){
    current.board=leerTablero()
    current.settings=leerConfiguracion()
  }

  let data=structuredClone({

    activeWorkspace,
    workspaces
  })

  saveQueue=saveQueue
    .catch(()=>{})
    .then(()=>chrome.storage.local.set({
      [STORAGE]:data
    }))

  dibujarWorkspaces()

  return saveQueue
}


async function exportarDatos(){

  await guardar()

  let data=JSON.stringify({
    version:1,
    activeWorkspace,
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
    )
  }))

  activeWorkspace=workspaces.some(
    workspace=>workspace.id===String(data.activeWorkspace)
  )
    ? String(data.activeWorkspace)
    : workspaces[0].id

  let current=workspaces.find(
    workspace=>workspace.id===activeWorkspace
  )

  dibujarTablero(current.board)
  aplicarConfiguracion(current.settings)
  await guardar()
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
          )
        }))
      : [{
          id:'workspace-1',
          title:'Tablero 1',
          board:Array.isArray(data.board)
            ? data.board
            : initialBoard,
          settings:normalizarConfiguracion(legacySettings)
        }]

  activeWorkspace=workspaces.some(
    workspace=>workspace.id===data.activeWorkspace
  )
    ? data.activeWorkspace
    : workspaces[0].id

  let current=workspaces.find(
    workspace=>workspace.id===activeWorkspace
  )

  dibujarTablero(current.board)
  aplicarConfiguracion(current.settings)
  guardar()
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
  guardar()
}


view.onchange=()=>{

  ajustarColumnas()
  guardar()
}


height.oninput=()=>{

  document.documentElement.style
    .setProperty(
      '--height',
      height.value+'px'
    )

  guardar()
}


minWidth.oninput=()=>{

  ajustarColumnas()
  guardar()
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

    if(
      workspaceTab &&
      workspaceTabs.contains(workspaceTab)
    ){
      e.preventDefault()
      contextTarget=workspaceTab
      copyContext.hidden=true
      duplicateContext.hidden=true
      deleteContext.textContent='Eliminar tablero'
    }else if(
      column &&
      kanban.contains(column)
    ){
      e.preventDefault()
      contextTarget=card || column
      copyContext.hidden=false
      duplicateContext.hidden=false

      deleteContext.textContent=
        card
          ? 'Eliminar tarjeta'
          : 'Eliminar columna'
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
  }
)


copyContext.onclick=async()=>{

  let target=contextTarget
  cerrarMenuContextual()

  if(!target || target.matches('.workspace-tab'))
    return

  let text=target.matches('.card')
    ? target.textContent.trim()
    : [
        target.querySelector('h3')
          ?.textContent.trim(),
        ...[
          ...target.querySelectorAll('.card')
        ].map(card=>card.textContent.trim())
      ].filter(Boolean).join('\n')

  await copiarAlPortapapeles(text)
}


duplicateContext.onclick=()=>{

  let target=contextTarget
  cerrarMenuContextual()

  if(!target || target.matches('.workspace-tab'))
    return

  let duplicate=target.cloneNode(true)
  let card=target.matches('.card')

  duplicate.classList.remove('dragging')
  duplicate.contentEditable=false
  duplicate.draggable=card

  duplicate.querySelectorAll('.card,h3')
    .forEach(item=>{
      item.classList.remove('dragging')
      item.contentEditable=false
      item.draggable=true
    })

  target.after(duplicate)
  ajustarColumnas()
  guardar()
}


deleteContext.onclick=async()=>{

  let target=contextTarget
  let card=target?.matches('.card')
  let workspace=target?.matches('.workspace-tab')
  let type=workspace
    ? 'tablero'
    : card
      ? 'tarjeta'
      : 'columna'

  let label=workspace
    ? target.querySelector('span')
        ?.textContent.trim()
    : card
      ? target.textContent.trim()
      : target?.querySelector('h3')
          ?.textContent.trim()

  cerrarMenuContextual()

  if(!target)
    return

  let accepted=await pedirConfirmacion(
    `Eliminar ${type}`,
    `Vas a eliminar ${type==='tablero' ? 'el' : 'la'} ${type} "${label || ''}". Esta accion no se puede deshacer.`
  )

  if(!accepted || !target.isConnected)
    return

  if(workspace){
    let id=target.dataset.workspace
    let deletingActive=id===activeWorkspace
    let index=workspaces.findIndex(
      item=>item.id===id
    )

    workspaces=workspaces.filter(
      item=>item.id!==id
    )

    if(!workspaces.length)
      workspaces.push({
        id:crypto.randomUUID?.() ||
          `workspace-${Date.now()}`,
        title:'Tablero 1',
        board:[{
          title:'Nueva columna 1',
          cards:[]
        }],
        settings:normalizarConfiguracion()
      })

    if(deletingActive){
      let next=workspaces[
        Math.min(
          Math.max(index,0),
          workspaces.length-1
        )
      ]

      activeWorkspace=next.id
      dibujarTablero(next.board)
      aplicarConfiguracion(next.settings)
    }else{
      ajustarColumnas()
    }

    guardar()
    return
  }

  target.remove()
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


document.addEventListener(
  'dragstart',
  e=>{

    if(document.activeElement?.isContentEditable)
      document.activeElement.blur()

    if(e.target.matches('.card'))
      drag=e.target

    if(e.target.matches('h3'))
      drag=e.target.parentElement

    if(!drag)
      return

    columnMoveAnchor=null
    crearDragImage(drag,e)
    drag.classList.add('dragging')
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
  ()=>{

    drag?.classList.remove('dragging')
    eliminarDragImage()

    drag=null
    columnMoveAnchor=null

    guardar()
  }
)


document.addEventListener(
  'dragover',
  e=>{

    e.preventDefault()

    if(dragImage)
      moverDragImage(e.clientX,e.clientY)

    if(!drag)
      return


    if(drag.matches('.card')){

      let column=
        e.target.closest('.column')

      if(!column)
        return

      let cards=
        column.querySelector('.cards')

      let next=[
        ...cards.querySelectorAll(
          '.card:not(.dragging)'
        )
      ].find(card=>{

        let rect=
          card.getBoundingClientRect()

        return e.clientY <
          rect.top +
          rect.height/2
      })

      cards.insertBefore(
        drag,
        next || null
      )

      return
    }


    if(drag.matches('.column')){

      if(
        columnMoveAnchor &&
        Math.hypot(
          e.clientX-columnMoveAnchor.x,
          e.clientY-columnMoveAnchor.y
        ) < COLUMN_MOVE_MARGIN
      )
        return

      let hovered=
        e.target.closest('.column')

      if(hovered===drag)
        return

      let candidates=[
        ...kanban.querySelectorAll(
          '.column:not(.dragging)'
        )
      ]

      if(!candidates.length){
        kanban.append(drag)
        return
      }

      let target=hovered ||
        candidates.reduce(
          (nearest,column)=>{

            let rect=
              column.getBoundingClientRect()

            let dx=
              e.clientX < rect.left
                ? rect.left-e.clientX
                : e.clientX > rect.right
                  ? e.clientX-rect.right
                  : 0

            let dy=
              e.clientY < rect.top
                ? rect.top-e.clientY
                : e.clientY > rect.bottom
                  ? e.clientY-rect.bottom
                  : 0

            let distance=
              dx*dx + dy*dy

            return !nearest ||
              distance < nearest.distance
                ? {column,distance}
                : nearest
          },
          null
        ).column

      let ordered=[
        ...kanban.querySelectorAll('.column')
      ]

      if(
        ordered.indexOf(drag) <
        ordered.indexOf(target)
      )
        target.after(drag)
      else
        target.before(drag)

      columnMoveAnchor={
        x:e.clientX,
        y:e.clientY
      }
    }
  }
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

    let card=
      document.createElement('div')

    card.className='card'
    card.draggable=true
    card.textContent=
      `Nueva tarjeta ${cards.querySelectorAll('.card').length+1}`

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

    let tab=
      e.target.closest('.workspace-tab')

    if(
      !tab ||
      tab.dataset.workspace===activeWorkspace
    )
      return

    guardar()

    activeWorkspace=
      tab.dataset.workspace

    let workspace=workspaces.find(
      item=>item.id===activeWorkspace
    )

    dibujarTablero(workspace.board)
    aplicarConfiguracion(workspace.settings)
    guardar()
  }
)


workspaceTabs.addEventListener(
  'dblclick',
  async e=>{

    let tab=
      e.target.closest('.workspace-tab')

    if(!tab)
      return

    let workspace=
      workspaces.find(
        item=>item.id===tab.dataset.workspace
      )

    let title=await pedirNombre(
      'Renombrar tablero',
      'Escribe el nuevo nombre del tablero.',
      workspace.title
    )

    if(!title?.trim())
      return

    workspace.title=title.trim()
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

  activeWorkspace=id

  dibujarTablero(
    workspaces.at(-1).board
  )

  aplicarConfiguracion(
    workspaces.at(-1).settings
  )
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
  guardar
)


void cargar()
