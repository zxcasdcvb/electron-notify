'use strict'

const electron = require('electron')
const ipc = electron.ipcRenderer
const winId = electron.remote.getCurrentWindow().id

function setStyle(config) {
  // Style it
  let notiDoc = window.document
  let container = notiDoc.getElementById('container')
  let appIcon = notiDoc.getElementById('appIcon')
  let image = notiDoc.getElementById('image')
  let close = notiDoc.getElementById('close')
  let message = notiDoc.getElementById('message')
  // Default style
  setStyleOnDomElement(config.defaultStyleContainer, container)
  // Size and radius
  let style = {
    height: config.height - 2*config.borderRadius - 2*config.defaultStyleContainer.padding,
    width: config.width - 2*config.borderRadius  - 2*config.defaultStyleContainer.padding,
    borderRadius: config.borderRadius + 'px'
  }
  setStyleOnDomElement(style, container)
  // Style appIcon or hide
  if (config.appIcon) {
    setStyleOnDomElement(config.defaultStyleAppIcon, appIcon)
    appIcon.src = config.appIcon
  }
  else {
    setStyleOnDomElement({
      display: 'none'
    }, appIcon)
  }
  // Style image
  setStyleOnDomElement(config.defaultStyleImage, image)
  // Style close button
  setStyleOnDomElement(config.defaultStyleClose, close)
  // Remove margin from text p
  setStyleOnDomElement(config.defaultStyleText, message)
}

function setContents(event, notificationObj) {
  // sound
  if (notificationObj.sound) {
    // Check if file is accessible
    try {
      // If it's a local file, check it's existence
      // Won't check remote files e.g. http://
      if (notificationObj.sound.match(/^file\:/) !== null
      || notificationObj.sound.match(/^\//) !== null) {
        let audio = new window.Audio(notificationObj.sound)
        audio.play()
      }
    }
    catch (e) {
      log('node-desktop-notification: ERROR could not find sound file: ' + notificationObj.sound.replace('file://', ''), e, e.stack)
    }
  }

  let notiDoc = window.document
  // Title
  let titleDoc = notiDoc.getElementById('title')
  titleDoc.innerHTML = notificationObj.title || ''
  // message
  let messageDoc = notiDoc.getElementById('message')
  messageDoc.innerHTML = notificationObj.text || ''
  // Image
  let imageDoc = notiDoc.getElementById('image')
  if (notificationObj.image) {
    imageDoc.src = notificationObj.image
  }
  else {
    setStyleOnDomElement({ display: 'none'}, imageDoc)
  }

  // Close button
  let closeButton = notiDoc.getElementById('close')
  closeButton.addEventListener('click', function(event) {
    event.stopPropagation()
    ipc.send('node-desktop-notification-close', winId, notificationObj)
  })

  // URL
  let container = notiDoc.getElementById('container')
  container.addEventListener('click', function() {
    ipc.send('node-desktop-notification-click', winId, notificationObj)
  })
}

function setStyleOnDomElement(styleObj, domElement) {
  try {
    for (let styleAttr in styleObj) {
      domElement.style[styleAttr] = styleObj[styleAttr]
    }
  }
  catch (e) {
    throw new Error('node-desktop-notification: Could not set style on domElement', styleObj, domElement)
  }
}

function loadConfig(event, conf) {
  setStyle(conf || {})
}

function reset(event) {
  let notiDoc = window.document
  let container = notiDoc.getElementById('container')
  let closeButton = notiDoc.getElementById('close')

  // Remove event listener
  let newContainer = container.cloneNode(true)
  container.parentNode.replaceChild(newContainer, container)
  let newCloseButton = closeButton.cloneNode(true)
  closeButton.parentNode.replaceChild(newCloseButton, closeButton)
}

ipc.on('node-desktop-notification-set-contents', setContents)
ipc.on('node-desktop-notification-load-config', loadConfig)
ipc.on('node-desktop-notification-reset', reset)

function log() {
  console.log.apply(console, arguments)
}

delete global.require
delete global.exports
delete global.module
