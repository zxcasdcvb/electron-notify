'use strict'

const _ = require('lodash')
const path = require('path')
const async = require('async')
const electron = require('electron')
const screen = electron.screen
const BrowserWindow = electron.BrowserWindow
const ipc = electron.ipcMain
const shell = electron.shell

// One animation at a time
const AnimationQueue = function(options) {
  this.options = options
  this.queue = []
  this.running = false
}

AnimationQueue.prototype.push = function(object) {
  if (this.running) {
    this.queue.push(object)
  }
  else {
    this.running = true
    this.animate(object)
  }
}

AnimationQueue.prototype.animate = function(object) {
  let self = this
  object.func.apply(null, object.args)
  .then(function() {
    if (self.queue.length > 0) {
      // Run next animation
      self.animate.call(self, self.queue.shift())
    }
    else {
      self.running = false
    }
  })
  .catch(function(err) {
    log('node-desktop-notification encountered an error!')
    // log('Please submit the error stack and code samples to: https://github.com/cgrossde/node-desktop-notification/issues')
    log(err.stack)
  })
}

AnimationQueue.prototype.clear = function() {
  this.queue = []
}

var config = {
  width: 300,
  height: 65,
  padding: 10,
  borderRadius: 5,
  displayTime: 5000,
  animationSteps: 5,
  animationStepMs: 5,
  animateInParallel: true,
  appIcon: null,
  pathToModule: '',
  logging: true,
  defaultStyleContainer: {
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    padding: 8,
    border: '1px solid #CCC',
    fontFamily: 'Arial',
    fontSize: 12,
    position: 'relative',
    lineHeight: '15px'
  },
  defaultStyleAppIcon: {
    overflow: 'hidden',
    float: 'left',
    height: 40,
    width: 40,
    marginRight: 10,
  },
  defaultStyleImage: {
    overflow: 'hidden',
    float: 'right',
    height: 40,
    width: 40,
    marginLeft: 10,
  },
  defaultStyleClose: {
    position: 'absolute',
    top: 1,
    right: 3,
    fontSize: 11,
    color: '#CCC'
  },
  defaultStyleText: {
    margin: 0,
    overflow: 'hidden',
    cursor: 'default'
  },
  defaultWindow: {
    'alwaysOnTop': true,
    'skipTaskbar': process.platform == "darwin",
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      allowDisplayingInsecureContent: true
    }
  },
  htmlTemplate: '<html>\n'
  + '<head></head>\n'
  + '<body style="overflow: hidden; -webkit-user-select: none;">\n'
  + '<div id="container">\n'
  + ' <img src="" id="appIcon" />\n'
  + ' <img src="" id="image" />\n'
  + ' <div id="text">\n'
  + '   <b id="title"></b>\n'
  + '   <p id="message"></p>\n'
  + ' </div>\n'
  + ' <div id="close">X</div>\n'
  + '</div>\n'
  + '</body>\n'
  + '</html>'
}

function setConfig(customConfig) {
  config = _.defaults(customConfig, config)
  calcDimensions()
}

function updateTemplatePath() {
  var templatePath = path.join(__dirname, 'notification.html')
  // Tricky stuff, sometimes this doesn't work,
  // especially when webpack is involved.
  // Check if we have a file at that location
  try {
    require('fs').statSync(templatePath).isFile()
  }
  // No file => create our own temporary notification.html
  catch (err) {
    log('node-desktop-notification: Could not find template ("' + templatePath + '").')
    log('node-desktop-notification: To use a different template you need to correct the config.templatePath or simply adapt config.htmlTemplate')
  }
  config.templatePath = 'file://' + templatePath
  return config.templatePath
}

function getTemplatePath() {
  if (config.templatePath === undefined) {
    return updateTemplatePath()
  }
  return config.templatePath
}

function setTemplatePath(path) {
  config.templatePath = path
}

var nextInsertPos = {}
function calcDimensions() {
  // Calc totalHeight & totalWidth
  config.totalHeight = config.height + config.padding
  config.totalWidth = config.width + config.padding

  // Calc pos of first notification:
  config.firstPos = {
    x: config.lowerRightCorner.x - config.totalWidth,
    y: config.lowerRightCorner.y - config.totalHeight
  }

  // Set nextInsertPos
  nextInsertPos.x = config.firstPos.x
  nextInsertPos.y = config.firstPos.y
}

// Use primary display only
var display = screen.getPrimaryDisplay()

// Display notifications starting from lower right corner
// Calc lower right corner
config.lowerRightCorner = {}
config.lowerRightCorner.x = display.bounds.x + display.workArea.x + display.workAreaSize.width
config.lowerRightCorner.y = display.bounds.y + display.workArea.y + display.workAreaSize.height

calcDimensions()

// Maximum amount of Notifications we can show:
config.maxVisibleNotifications = Math.floor(display.workAreaSize.height / (config.totalHeight))
config.maxVisibleNotifications = (config.maxVisibleNotifications > 7) ? 7 : config.maxVisibleNotifications

// Array of windows with currently showing notifications
var activeNotifications = []

// Recycle windows
var inactiveWindows = []

// If we cannot show all notifications, queue them
var notificationQueue = []

// To prevent executing mutliple animations at once
var animationQueue = new AnimationQueue()

// Give each notification a unique id
var latestID = 0

function notify(notification) {
  // Is it an object and only one argument?
  if (arguments.length === 1 && typeof notification === 'object') {
    // Use object instead of supplied parameters
    notification.id = latestID
    latestID++
    animationQueue.push({
      func: showNotification,
      args: [ notification ]
    })
    return notification.id
  }
  else {
    // Since 1.0.0 all notification parameters need to be passed
    // as object.
    log('node-desktop-notification: ERROR notify() only accepts a single object with notification parameters.')
  }
}

function showNotification(notificationObj) {
  return new Promise(function(resolve, reject) {
    // Can we show it?
    if (activeNotifications.length < config.maxVisibleNotifications) {
      // Get inactiveWindow or create new:
      getWindow().then(function(notificationWindow) {
        // Move window to position
        calcInsertPos()
        notificationWindow.setPosition(nextInsertPos.x, nextInsertPos.y)

        // Add to activeNotifications
        activeNotifications.push(notificationWindow)

        // Display time per notification basis.
        let displayTime = (notificationObj.displayTime ? notificationObj.displayTime : config.displayTime)

        // Set timeout to hide notification
        let timeoutId
        let closeFunc = buildCloseNotification(notificationWindow, notificationObj, function() {
          return timeoutId
        })
        let closeNotificationSafely = buildCloseNotificationSafely(closeFunc)
        timeoutId = setTimeout(function() {
          closeNotificationSafely('timeout')
        }, displayTime)

        // Trigger onShowFunc if existent
        if (notificationObj.onShowFunc) {
          notificationObj.onShowFunc({
            event: 'show',
            id: notificationObj.id,
            closeNotification: closeNotificationSafely
          })
        }

        // Set contents, ...
        notificationWindow.webContents.send('node-desktop-notification-set-contents', notificationObj)
        // Show window
        notificationWindow.showInactive()
        resolve(notificationWindow)
      })
    }
    // Add to notificationQueue
    else {
      notificationQueue.push(notificationObj)
      resolve()
    }
  })
}

// Close notification function
function buildCloseNotification(notificationWindow, notificationObj, getTimeoutId) {
  return function(event) {
    if (notificationObj.closed) {
      return new Promise(function(exitEarly) { exitEarly() })
    }
    else {
      notificationObj.closed = true
    }

    if (notificationObj.onCloseFunc) {
      notificationObj.onCloseFunc({
        event: event,
        id: notificationObj.id
      })
    }

    // reset content
    notificationWindow.webContents.send('node-desktop-notification-reset')
    if (getTimeoutId && typeof getTimeoutId === 'function') {
      let timeoutId = getTimeoutId()
      clearTimeout(timeoutId)
    }

    // Recycle window
    var pos = activeNotifications.indexOf(notificationWindow)
    activeNotifications.splice(pos, 1)
    inactiveWindows.push(notificationWindow)
    // Hide notification
    notificationWindow.hide()

    checkForQueuedNotifications()

    // Move notifications down
    return moveOneDown(pos)
  }
}

// Always add to animationQueue to prevent erros (e.g. notification
// got closed while it was moving will produce an error)
function buildCloseNotificationSafely(closeFunc) {
  return function(reason) {
    if (reason === undefined)
    reason = 'closedByAPI'
    animationQueue.push({
      func: closeFunc,
      args: [ reason ]
    })
  }
}

ipc.on('node-desktop-notification-close', function (event, winId, notificationObj) {
  let closeFunc = buildCloseNotification(BrowserWindow.fromId(winId), notificationObj)
  buildCloseNotificationSafely(closeFunc)('close')
})

ipc.on('node-desktop-notification-click', function (event, winId, notificationObj) {
  if (notificationObj.url) {
    shell.openExternal(notificationObj.url)
  }
  if (notificationObj.onClickFunc) {
    let closeFunc = buildCloseNotification(BrowserWindow.fromId(winId), notificationObj)
    notificationObj.onClickFunc({
      event: 'click',
      id: notificationObj.id,
      closeNotification: buildCloseNotificationSafely(closeFunc)
    })
  }
})

/**
* Checks for queued notifications and add them
* to AnimationQueue if possible
*/
function checkForQueuedNotifications() {
  if (notificationQueue.length > 0 &&
    (activeNotifications.length < config.maxVisibleNotifications)) {
    // Add new notification to animationQueue
    animationQueue.push({
      func: showNotification,
      args: [ notificationQueue.shift() ]
    })
  }
}

/**
* Moves the notifications one position down,
* starting with notification at startPos
*
* @param  {int} startPos
*/
function moveOneDown(startPos) {
  return new Promise(function(resolve, reject) {
    if (startPos >= activeNotifications || startPos === -1) {
      resolve()
      return
    }
    // Build array with index of affected notifications
    var notificationPosArray = []
    for (var i = startPos; i < activeNotifications.length; i++) {
      notificationPosArray.push(i)
    }
    // Start to animate all notifications at once or in parallel
    var asyncFunc = async.map // Best performance
    if (config.animateInParallel === false) {
      asyncFunc = async.mapSeries // Sluggish
    }
    asyncFunc(notificationPosArray, moveNotificationAnimation, function() {
      resolve()
    })
  })
}

function moveNotificationAnimation(i, done) {
  // Get notification to move
  var notificationWindow = activeNotifications[i]
  // Calc new y position
  var newY = config.lowerRightCorner.y - config.totalHeight * (i + 1)
  // Get startPos, calc step size and start animationInterval
  var startY = notificationWindow.getPosition()[1]
  var step = (newY - startY) / config.animationSteps
  var curStep = 1
  var animationInterval = setInterval(function() {
    // Abort condition
    if (curStep === config.animationSteps) {
      notificationWindow.setPosition(config.firstPos.x, newY)
      clearInterval(animationInterval)
      return done(null, 'done')
    }
    // Move one step down
    notificationWindow.setPosition(config.firstPos.x, startY + curStep * step)
    curStep++
  }, config.animationStepMs)
}

/**
* Find next possible insert position (on top)
*/
function calcInsertPos() {
  if (activeNotifications.length < config.maxVisibleNotifications) {
    nextInsertPos.y = config.lowerRightCorner.y - config.totalHeight * (activeNotifications.length + 1)
  }
}

/**
* Get a window to display a notification. Use inactiveWindows or
* create a new window
* @return {Window}
*/
function getWindow() {
  return new Promise(function(resolve, reject) {
    var notificationWindow
    // Are there still inactiveWindows?
    if (inactiveWindows.length > 0) {
      notificationWindow = inactiveWindows.pop()
      resolve(notificationWindow)
    }
    // Or create a new window
    else {
      var windowProperties = config.defaultWindow
      windowProperties.width = config.width
      windowProperties.height = config.height
      notificationWindow = new BrowserWindow(windowProperties)
      notificationWindow.setVisibleOnAllWorkspaces(true)
      notificationWindow.loadURL(getTemplatePath())
      notificationWindow.webContents.on('did-finish-load', function() {
        // Done
        notificationWindow.webContents.send('node-desktop-notification-load-config', config)
        resolve(notificationWindow)
      })
    }
  })
}

function closeAll() {
  // Clear out animation Queue and close windows
  animationQueue.clear()
  _.forEach(activeNotifications, function(window) {
    window.close()
  })
  _.forEach(inactiveWindows, function(window) {
    window.close()
  })
  // Reset certain vars
  nextInsertPos = {}
  activeNotifications = []
  inactiveWindows = []
}

function log(){
  if (config.logging === true){
    console.log.apply(console, arguments)
  }
}

module.exports.notify = notify
module.exports.setConfig = setConfig
module.exports.getTemplatePath = getTemplatePath
module.exports.setTemplatePath = setTemplatePath
module.exports.closeAll = closeAll
