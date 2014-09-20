/**
 * server.js
 * version: 0.0.1 (2014/08/24)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2013, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
'use strict';

var WebSocketServer = require('ws').Server,
    http = require('http'),
    express = require('express'),
    app = express(),
    pg = require('pg'),
    sha1 = require('sha1'),
    port = process.env.PORT || 9224;

var connections = [];
var authenticated = {};
var appConst = {
    device: {
        android: 1, browser: 2
    }
};

app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/'));

var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({
    extended: true
}));

// HTTP Server
var httpServer = http.createServer(app);
httpServer.listen(port);
console.log('http server listening on %d', port);

// WebScoket Server
var wsServer = new WebSocketServer({
    server: httpServer
});

// WebSocket Connection
var startWebSocketServer = function() {
    wsServer.on('connection', function(ws) {
        var authKey = ws.upgradeReq.headers['x-imadoko-authkey'];
        // Android側からの接続は認証情報を格納する
        // 認証情報が取れない場合は、ブラウザからの閲覧専用ユーザとする
        if (authKey) {
            ws._authKey = authKey;
            ws._userId = authenticated[authKey];
            ws._clientId = appConst.device.android;
        }
        else {
            ws._clientId = appConst.device.browser;
        }

        connections.push(ws);

        var close = function() {
            console.log("websocket connection close.");
            connections = connections.filter(function (conn, index) {
                return conn !== ws;
            });
        };

        var pollingFromAndroid = function(authKey) {
            if (!authenticated[authKey]) {
                close();
            }
        };

        var pollingFromBrowser = function() {
        };

        var sendRequestAndroid = function(json) {
            if (!json.userId) {
                return;
            }
            connections.forEach(function(connection) {
                if (connection._clientId === appConst.device.android && connection._userId === json.userId) {
                    if (!ws.hasOwnProperty("_senderId") || ws._senderId === null) {
                        ws._senderId = sha1(Math.random().toString(36));
                    }
                    ws._userId = json.userId;
                    // 位置情報取得リクエストをAndroid端末に送信
                    connection.send(JSON.stringify({authKey: connection._authKey, senderId: ws._senderId}));
                    return;
                }
            });

            // TODO ブラウザから宛先のAndroidに到達出来なかった場合の処理
        };

        var sendRequestBrowser = function(json) {
            connections.forEach(function(connection) {
                if (connection._clientId === appConst.device.browser && connection._senderId === json.senderId) {
                    // 位置情報取得リクエストをブラウザに送信
                    connection.send(JSON.stringify({lng: json.lng, lat: json.lat, userId: connection._userId}));
                    connection._senderId = null;
                    connection._userId = null;
                    return;
                }
            });
        };

        ws.on('message', function(data) {
            var json = JSON.parse(data);
            console.log(json.requestId);
            switch (json.requestId) {
            case 'polling_from_android':
                pollingFromAndroid(json.authKey);
                break;
            case 'polling_from_browser':
                pollingFromBrowser();
                break;
            case 'send_request_android':
                sendRequestAndroid(json);
                break;
            case 'send_request_browser':
                sendRequestBrowser(json);
                break;
            }
        });

        ws.on('close', close);
    });
};

// PostgreSQL
var conString = process.env.DATABASE_URL;
pg.connect(conString, function(err, client, done) {
    if (err) {
        httpServer.close();
        return;
    }

    var sql = "SELECT UserID, AuthKey FROM M_Auth";
    client.query(sql, "", function(err, result) {
        done();
        if (err) {
            httpServer.close();
            return;
        }
        for (var i = 0, len = result.rows.length; i < len; i++) {
            authenticated[result.rows[i].authkey] = result.rows[i].userid;
        }

        startWebSocketServer();
    });
});

// WebSocket send
var broadcast = function(message) {
    connections.forEach(function (connection, index) {
        connection.send(message);
    });
};

app.get('/', function(req, res) {
    res.render('index');
});

app.get("/auth", function(req, res) {
    var authKey = req.query.authKey;

    if (authenticated[authKey]) {
        console.log("authenticate ok");
        res.status(200).end();
    } else {
        console.log("authenticate ng");
        res.status(403).end();
    }
});
