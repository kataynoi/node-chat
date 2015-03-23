// Variables
var favicon = require('serve-favicon'),
    readline = require('readline'),
    express = require('express'),
    colors = require('colors'),
    sockjs = require('sockjs'),
    https = require('https'),
    path = require('path'),
    fs = require('fs'),
    app = express();

var config = {
    log: true,
    readline: true,
    logFile: 'none',
    ipadr: '127.0.0.1' || 'localhost',
    port: 3000,
    ssl: false
};

var styles = {
    info:    colors.bold.blue,
    error:   colors.bold.red.dim,
    socket:  colors.bold.magenta,
    stop:    colors.bold.red.dim,
    start:   colors.bold.green.dim,
    message: colors.bold.green.dim,
    pm:      colors.bold.yellow.dim,
}

if(config.ssl) {
    var options = {
        key: fs.readFileSync('/path/to/your/ssl.key'),
        cert: fs.readFileSync('/path/to/your/ssl.crt')
    },
    server = https.createServer(options);
}

var chat = sockjs.createServer(),
    clients = [],
    users = {},
    bans = [],
    uid = 1;

var alphanumeric = /^\w+$/,
    escapeHtml = function(e,t,n,r){var i=0,s=0,o=false;if(typeof t==="undefined"||t===null){t=2}e=e.toString();if(r!==false){e=e.replace(/&/g,"&")}e=e.replace(/</g,"&lt;").replace(/>/g,"&gt;");var u={ENT_NOQUOTES:0,ENT_HTML_QUOTE_SINGLE:1,ENT_HTML_QUOTE_DOUBLE:2,ENT_COMPAT:2,ENT_QUOTES:3,ENT_IGNORE:4};if(t===0){o=true}if(typeof t!=="number"){t=[].concat(t);for(s=0;s<t.length;s++){if(u[t[s]]===0){o=true}else if(u[t[s]]){i=i|u[t[s]]}}t=i}if(t&u.ENT_HTML_QUOTE_SINGLE){e=e.replace(/'/g,"&#039;")}if(!o){e=e.replace(/"/g,"&#34;")}return e};


// Config
if(config.readline) {
    var rl = readline.createInterface(process.stdin, process.stdout);
    rl.setPrompt('[--:--:--][CONSOLE] ');
    rl.prompt();
}


// Express
app.set('view engine', 'ejs');
app.use(favicon(__dirname + '/public/img/favicon.png'));
app.use('/chat', express.static(__dirname + '/public'));

app.get('/chat', function (req, res) {
    res.render('pages/index');
});


// Connections
var server = app.listen(config.port, config.ipadr, function() {
    var host = server.address().address,
        port = server.address().port;

    consoleLog('start', 'Listening at http://' + host + ':' + port);
});

var lastTime = [];
var currentTime = [];
var rateLimit = [];
var rateInterval = [];

chat.on('connection', function(conn) {
    consoleLog('socket', colors.underline(conn.id) +': connected');
    rateLimit[conn.id] = 1;
    lastTime[conn.id] = Date.now();
    currentTime[conn.id] = Date.now();

    clients[conn.id] = {
        id: uid,
        un: null,
        ip: conn.headers['x-forwarded-for'],
        role: 0,
        con: conn
    };

    users[uid] = {
        id: uid,
        oldun: null,
        un: null,
        role: 0
    };

    if(bans.indexOf(clients[conn.id].ip) > -1) {
        conn.write(JSON.stringify({type:'server', info:'rejected', reason:'banned'}));
        conn.close();
    }

    conn.write(JSON.stringify({type:'server', info:'clients', clients:users}));
    conn.write(JSON.stringify({type:'server', info:'user', client:users[uid]}));
    conn.on('data', function(message) {
        currentTime[conn.id] = Date.now();
        rateInterval[conn.id] = (currentTime[conn.id] - lastTime[conn.id]) / 1000;
        lastTime[conn.id] = currentTime[conn.id];
        rateLimit[conn.id] += rateInterval[conn.id];

        if(rateLimit[conn.id] > 1)
            rateLimit[conn.id] = 1;
        if(rateLimit[conn.id] < 1 && JSON.parse(message).type != 'delete')
            return conn.write(JSON.stringify({type:'server', info:'spam'}));
        else {
            try {
                var data = JSON.parse(message);

                if(data.type == 'ping') return false;
                if(data.type == 'delete' && clients[conn.id].role > 0) sendToAll({type:'server', info:'delete', mid:data.message})
                if(data.type == 'update') return updateUser(conn.id, data.user);
                if(data.type == 'pm') consoleLog('message', '[PM] ' + colors.underline(clients[conn.id].un) + ' to ' + colors.underline(data.extra) + ': ' + data.message);
                else consoleLog('message', '[' + data.type.charAt(0).toUpperCase() + data.type.substring(1) + '] ' + colors.underline(clients[conn.id].un) + ': ' + data.message);

        		if(typeof config.logFile != 'undefined' || config.logFile != 'none') {
                    var writeData = '[' + getTime() + '] [' + data.type.charAt(0).toUpperCase() + data.type.substring(1) + '] ' + clients[conn.id].un + ': ' + data.message+'\n';
                    fs.stat(config.logFile, function(err, stat) {
                        if(err == null) {
                            fs.appendFile(config.logFile, writeData);
                        } else if(err.code == 'ENOENT') {
                            fs.writeFile(config.logFile, writeData);
                        } else {
                            throw err;
                        }
                    });
        		}

                if(data.type != 'update') handleSocket(clients[conn.id], message);
            } catch(err) {
                return consoleLog('error', err);
            }
            rateLimit[conn.id] -= 1;
        }
    });

    conn.on('close', function() {
        consoleLog('socket', colors.underline(conn.id) + ': disconnected');
        sendToAll({type:'server', info:'disconnection', user:users[clients[conn.id].id]})
        delete users[clients[conn.id].id];
        delete clients[conn.id];
    });
});

chat.installHandlers(server, {prefix:'/socket',log:function(){}});


// Util
function updateUser(id, name) {
    if(name.length > 2 && name.length < 17 && name.indexOf(' ') < 0 && !checkUser(name) && name.match(alphanumeric) && name != 'Console' && name != 'System') {
        if(clients[id].un == null) {
            clients[id].con.write(JSON.stringify({type:'server', info:'success'}));
            uid++;
        }

        users[clients[id].id].un = name;
        sendToAll({
            type: 'server',
            info: clients[id].un == null ? 'connection' : 'update',
            user: {
                id: clients[id].id,
                oldun: clients[id].un,
                un: name,
                role: clients[id].role
            }
        });
        clients[id].un = name;
    } else {
        var motive = 'format',
            check = false;

        if(!name.match(alphanumeric)) motive = 'format';
        if(name.length < 3 || name.length > 16) motive = 'length';
        if(checkUser(name) ||  name == 'Console' || name == 'System') motive = 'taken';
        if(clients[id].un != null) check = true;

        clients[id].con.write(JSON.stringify({type:'server', info:'rejected', reason:motive, keep:check}));
        if(clients[id].un == null) clients[id].con.close();
    }
}

function sendToAll(data) {
    for(var client in clients)
        clients[client].con.write(JSON.stringify(data));
}

function sendToOne(data, user, type) {
    for(var client in clients) {
        if(clients[client].un == user) {
            if(type == 'message') clients[client].con.write(JSON.stringify(data));
            if(type == 'role') {
                clients[client].role = data.role;
                users[clients[client].id].role = data.role;
            }
        }
    }
}

function sendBack(data, user) {
    clients[user.con.id].con.write(JSON.stringify(data));
}

function checkUser(user) {
    for(var client in clients) {
        if(clients[client].un == user)
            return true;
    }
    return false;
}

function getUserByName(name) {
    for(client in clients)
        if(clients[client].un == name)
            return clients[client];
}

function handleSocket(user, message) {
    var data = JSON.parse(message);

    data.id = user.id;
    data.user = user.un;
    data.type = escapeHtml(data.type);
    data.message = escapeHtml(data.message);
    data.mid = (Math.random() + 1).toString(36).substr(2, 5);

    switch(data.type) {
        case 'pm':
            if(data.extra != data.user && checkUser(data.extra)) {
                sendToOne(data, data.extra, 'message');
                data.subtxt = 'PM to ' + data.extra;
                sendBack(data, user);
            } else {
                data.type = 'light';
                data.subtxt = null;
                data.message = checkUser(data.extra) ? 'You can\'t PM yourself' : 'User not found';
                sendBack(data, user);
            }
            break;

        case 'global': case 'kick': case 'ban': case 'role':
            if(user.role > 0) {
                if(data.type == 'global') {
                    if(user.role == 3) {
                        return sendToAll(data);
                    } else {
                        data.subtxt = null;
                        data.message = 'You don\'t have permission to do that';
                        return sendBack(data, user);
                    }
                } else {
                    data.subtxt = null;
                    if(data.message != data.user) {
                        if(checkUser(data.message)) {
                            switch(data.type) {
                                case 'ban':
                                    var time = parseInt(data.extra);

                                    if(!isNaN(time) && time > 0) {
                                        if(user.role > 1 && getUserByName(data.message).role == 0) {
                                            for(var client in clients) {
                                                if(clients[client].un == data.message)
                                                    bans.push(clients[client].ip);
                                            }
                                            data.extra = data.message;
                                            data.message = data.user + ' banned ' + data.message + ' from the server for ' + time + ' minutes';

                                            setTimeout(function() {
                                                bans.splice(bans.indexOf(clients[user.con.id].ip))
                                            }, time * 1000 * 60);

                                            return sendToAll(data);
                                        } else {
                                            data.message = 'You don\'t have permission to do that';
                                            return sendBack(data, user);
                                        }
                                    } else {
                                        data.type = 'light';
                                        data.message = 'Use /ban [user] [minutes]';
                                        return sendToOne(data, data.user, 'message')
                                    }
                                    break;

                                case 'role':
                                    if(data.extra > -1 && data.extra < 4) {
                                        if(user.role == 3) {
                                            var role;
                                            data.role = data.extra;
                                            data.extra = data.message;

                                            if(data.role == 0) role = 'User';
                                            if(data.role == 1) role = 'Helper';
                                            if(data.role == 2) role = 'Moderator';
                                            if(data.role == 3) role = 'Administrator';
                                            data.message = data.user + ' set ' + data.message + ' role to ' + role;
                                            sendToOne(data, JSON.parse(message).message, 'role');
                                            sendToAll({type:'server', info:'clients', clients:users});
                                        } else {
                                            data.message = 'You don\'t have permission to do that';
                                            return sendBack(data, user);
                                        }
                                    } else {
                                        data.type = 'light';
                                        data.message = 'Use /role [user] [0-3]';
                                        return sendToOne(data, data.user, 'message')
                                    }
                                    break;

                                case 'kick':
                                    if(user.role > 1 && getUserByName(data.message).role == 0) {
                                        data.extra = data.message;
                                        data.message = data.user + ' kicked ' + data.message + ' from the server';
                                    } else {
                                        data.message = 'You don\'t have permission to do that';
                                        return sendBack(data, user);
                                    }
                                    break;
                            }
                            sendToAll(data);
                        } else {
                            data.type = 'light';
                            data.message = 'User not found';
                            sendBack(data, user);
                        }
                    } else {
                        data.message = 'You can\'t do that to yourself';
                        sendBack(data, user);
                    }
                }
            } else {
                data.message = 'You don\'t have permission to do that';
                sendBack(data, user);
            }
            break;

        default:
            sendToAll(data);
            break;
    }
}

function getTime() {
    var now = new Date(),
        time = [now.getHours(), now.getMinutes(), now.getSeconds()];

    for(var i = 0; i < 3; i++) {
        if(time[i] < 10)
            time[i] = "0" + time[i];
    }

    return time.join(":");
}

function consoleLog(type, message) {
    if(config.log) {
        if(config.readline) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            console.log('[' + getTime() + '][' + styles[type](type.toUpperCase()) + '] ' + message);
            rl.prompt(true);
        } else {
            console.log('[' + getTime() + '][' + styles[type](type.toUpperCase()) + '] ' + message);
        }
    }
}


// Intern
if(config.readline) readLine();
function readLine() {
    rl.on('line', function(line) {
        var data = {};
        if(line.indexOf('/role') == 0) {
            var string = 'Console gave ' + line.substring(6) + ' administrator permissions';

            data.message = string;
            data.user = 'Console';
            data.type = 'role';
            data.extra = line.substring(6);
            data.role = 3;

            sendToAll(data);
            sendToOne(data, line.substring(6), data.type);
        }

        rl.prompt();
    }).on('close', function() {
        consoleLog('stop', 'Shutting down\n');
        process.exit(0);
    });
}
