var dgram = require('dgram'),
    unixDgram = require('unix-dgram'),
    Buffer = require('buffer').Buffer;

var Facility = {
    kern:   0,
    user:   1,
    mail:   2,
    daemon: 3,
    auth:   4,
    syslog: 5,
    lpr:    6,
    news:   7,
    uucp:   8,
    local0: 16,
    local1: 17,
    local2: 18,
    local3: 19,
    local4: 20,
    local5: 21,
    local6: 22,
    local7: 23
};

var Severity = {
    emerg:  0,
    alert:  1,
    crit:   2,
    err:    3,
    error:  3,
    warn:   4,
    notice: 5,
    info:   6,
    debug:  7
};

// Format RegExp
var formatRegExp = /%[sdj]/g;
/**
 * Just copy from node.js console
 * @param f
 * @returns
 */
function format(f) {
  if (typeof f !== 'string') {
    var objects = [], util = require('util');
    for (var i = 0; i < arguments.length; i++) {
      objects.push(util.inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var str = String(f).replace(formatRegExp, function(x) {
    switch (x) {
      case '%s': return args[i++];
      case '%d': return +args[i++];
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for (var len = args.length; i < len; ++i) {
    str += ' ' + args[i];
  }
  return str;
}

function leadZero(n) {
    if (n < 10) {
        return '0' + n;
    } else {
        return n;
    }
}


var monthNames = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
                   'Sep', 'Oct', 'Nov', 'Dec' ];

/**
 * Get current date and time (UTC) in syslog format. Thanks https://github.com/kordless/lodge
 * @returns {String}
 */
function getSyslogFormattedUTCTimestamp() {
    var date = new Date();
    var hours = leadZero(date.getUTCHours());
    var minutes = leadZero(date.getUTCMinutes());
    var seconds = leadZero(date.getUTCSeconds());
    var month = date.getUTCMonth();
    var day = date.getUTCDate();
    (day < 10) && (day = ' ' + day);
    return monthNames[month] + " " + day + " " + hours + ":" + minutes
            + ":" + seconds + 'Z';
}

/**
 * Syslog logger
 * @constructor
 * @returns {SysLogger}
 */
function SysLogger() {
    this._times = {};
}

/**
 * Init function. All arguments are optional
 * @param {String} tag By default is __filename
 * @param {Facility|Number|String} By default is "user"
 * @param {String} socketType Either "udp" (the default) or "unixDatagramSocket"
 * @param {Number|String} severityThreshold The lowest severity level
 * of messages that should actually be sent to syslog. Defaults to 'debug'
 * (everything is let through).
 * @param {String} hostnameOrPath The hostname if the socket type is
 * "udp" (defaults to "localhost"), or the path to the socket if the
 * socket type is "unixDatagramSocket" (defaults to 514).
 * @param {String} port The port, only used if the socket type is "udp"
 */
SysLogger.prototype.set = function(tag, facility, severityThreshold, socketType, hostnameOrPath, port) {
    this.setTag(tag);
    this.setFacility(facility);
    this.setSeverityThreshold(severityThreshold);
    this.setSocketType(socketType);
    if (socketType === 'unixDatagramSocket') {
        this.setPath(hostnameOrPath);
    } else if (socketType === 'udp') {
        this.setHostname(hostnameOrPath);
        this.setPort(port);
    }

    return this;
};

SysLogger.prototype.setSocketType = function(socketType) {
    this.socketType = socketType || 'udp';
    return this;
};
SysLogger.prototype.setTag = function(tag) {
    this.tag = tag || __filename;
    return this;
};
SysLogger.prototype.setFacility = function(facility) {
    this.facility = facility || Facility.user;
    if (typeof this.facility == 'string')
        this.facility = Facility[this.facility];
    return this;
};
SysLogger.prototype.setHostname = function(hostname) {
    this.hostname = hostname || 'localhost';
    return this;
};

SysLogger.prototype.setPort = function(port) {
    this.port = port || 514;
    return this;
};

SysLogger.prototype.setPath = function(path) {
    this.path = path || '/dev/log';
};

SysLogger.prototype.setSeverityThreshold = function(severityThreshold) {
    if (typeof severityThreshold === 'string') {
        if (severityThreshold in Severity) {
            severityThreshold = Severity[severityThreshold];
        } else {
            throw new Error("setSeverityThreshold: Invalid severity threshold: " + severityThreshold);
        }
    }
    if (typeof severityThreshold !== 'undefined') {
        this.severityThreshold = severityThreshold;
    } else {
        this.severityThreshold = Severity.debug;
    }
    return this;
};

/**
 * Get new instance of SysLogger. All arguments is similar as `set`
 * @returns {SysLogger}
 */
SysLogger.prototype.get = function() {
    var newLogger = new SysLogger();
    newLogger.set.apply(newLogger, arguments);
    return newLogger;
};
/**
 * Send message
 * @param {String} message
 * @param {Severity} severity
 */
SysLogger.prototype._send = function(message, severity) {
    if (severity <= this.severityThreshold) {
        var messageBuffer = new Buffer('<' + (this.facility * 8 + severity) + '>' +
            getSyslogFormattedUTCTimestamp() + ' ' +
            (this.hostname ? this.hostname + ' ' : '') +
            this.tag + '[' + process.pid + ']:' + message);
        if (this.socketType === 'udp') {
            var socket = dgram.createSocket('udp4');
            socket.send(messageBuffer,
                        0,
                        messageBuffer.length,
                        this.port,
                        this.hostname,
                        function(err) {
                            if (err){
                                console.error('Cannot connect to %s:%d', this.hostname, this.port);
                            }
                        });
            socket.close();
        } else {
            // Assume "unixDatagramSocket"
            if (!this.unixDatagramSocket) {
                this.unixDatagramSocket = unixDgram.createSocket('unix_dgram');
            }
            this.unixDatagramSocket.send(messageBuffer,
                                         0,
                                         messageBuffer.length,
                                         this.path,
                                         function (err) {
                                             if (err) {
                                                 console.error("Couldn't send message to /dev/log: " + err);
                                             }
                                         });
        }
    }
};

/**
 * Send formatted message to syslog
 * @param {String} message
 * @param {Number|String} severity
 */
SysLogger.prototype.send = function(message, severity) {
    severity = severity || Severity.notice;
    if (typeof severity == 'string') severity = Severity[severity];
    this._send(message, severity);
};

/**
 * Send log message with notice severity.
 */
SysLogger.prototype.log = function() {
    this._send(format.apply(this, arguments), Severity.notice);
};
/**
 * Send log message with info severity.
 */
SysLogger.prototype.info = function() {
    this._send(format.apply(this, arguments), Severity.info);
};
/**
 * Send log message with warn severity.
 */
SysLogger.prototype.warn = function() {
    this._send(format.apply(this, arguments), Severity.warn);
};
/**
 * Send log message with err severity.
 */
SysLogger.prototype.error = function() {
    this._send(format.apply(this, arguments), Severity.err);
};
/**
 * Send log message with debug severity.
 */
SysLogger.prototype.debug = function() {
    this._send(format.apply(this, arguments), Severity.debug);
};

/**
 * Log object with `util.inspect` with notice severity
 */
SysLogger.prototype.dir = function(object) {
    var util = require('util');
    this._send(util.inspect(object) + '\n', Severity.notice);
};

SysLogger.prototype.time = function(label) {
    this._times[label] = Date.now();
};
SysLogger.prototype.timeEnd = function(label) {
    var duration = Date.now() - this._times[label];
    this.log('%s: %dms', label, duration);
};

SysLogger.prototype.trace = function(label) {
    var err = new Error;
    err.name = 'Trace';
    err.message = label || '';
    Error.captureStackTrace(err, arguments.callee);
    this.error(err.stack);
};

SysLogger.prototype.assert = function(expression) {
    if (!expression) {
        var arr = Array.prototype.slice.call(arguments, 1);
        this._send(format.apply(this, arr), Severity.err);
    }
};

var logger = new SysLogger();
logger.set();
module.exports = logger;
