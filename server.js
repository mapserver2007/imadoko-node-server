/**
 * server.js
 * version: 0.0.2 (2014/11/15)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2014, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
'use strict';

var WebSocketServer = require('ws').Server,
    https = require('http'),
    express = require('express'),
    fs = require('fs'),
    model = require(__dirname + '/module/model.js'),
    app = express(),
    cp = require('child_process'),
    sha1 = require('sha1'),
    //mailer = require('nodemailer'),
    //smtpPool = require('nodemailer-smtp-pool'),
    port = process.env.PORT || 9224;

var connections = [];
var httpOptions = {};
var appConst = model.appConst;
var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({
    extended: true
}));

var https;
var httpServer;

if (process.env.PRODUCTION) {
    // 本番環境ではhttpでhttps通信が可能
    https = require('http');
    httpServer = https.createServer(app);
} else { // 開発環境
    // 開発環境では自己署名証明書を使う
    https = require('https');
    var httpOptions = {
        key: fs.readFileSync(__dirname + '/cert/server.key'),
        cert: fs.readFileSync(__dirname + '/cert/server.crt'),
    };
    httpServer = https.createServer(httpOptions, app);
}

httpServer.listen(port);
console.log('https server listening on %d', port);

// WebScoket Server
var wsServer = new WebSocketServer({
    server: httpServer
});

// connection clean
cp.fork(__dirname + '/timer.js').on('message', function(time) {
    connections = connections.filter(function (conn) {
        console.log(conn._connectionId + " " + (time - conn._updatedAt));
        // 30秒以上pingが飛んできていないコネクションはゾンビ化とみなしkill
        return (time - conn._updatedAt < 30);
    });
});

// WebSocket Connection
var startWebSocketServer = function() {
    wsServer.on('connection', function(ws) {
        var authKey = ws.upgradeReq.headers['x-imadoko-authkey'];
        var applicationType = ws.upgradeReq.headers['x-imadoko-applicationtype'];
        var userId = model.getUserId(authKey);
        ws._updatedAt = parseInt(new Date() / 1000, 10);
        ws._connectionId = sha1(authKey + appConst.salt);

        if (!authKey || !userId) {
            console.log("websocket connection failure.");
            ws.close();
            return;
        }

        // 同じデバイスから接続要求があった場合、それまでのコネクションを切断し新たに接続する
        for (var index = 0; index < connections.length; index++) {
            if (connections[index]._authKey === authKey) {
                connections[index].close();
            }
        }
        ws._authKey = authKey;
        ws._userId = userId;
        ws._applicationType = applicationType;
        connections.push(ws);

        ws.on("ping", function(data, flags) {
            var isConnected = false;
            var authKey = this._authKey;

            connections.forEach(function(connection) {
                if (connection._authKey === authKey) {
                    isConnected = true;
                    return;
                }
            });

            if (isConnected) {
                this._updatedAt = parseInt(new Date() / 1000, 10);
                console.log("ping:" + this._connectionId);
                this.ping();
            } else {
                console.log("connection already closed:" + this._connectionId);
                this.close();
            }
        });

        ws.on('message', function(data) {
            var json = JSON.parse(data);

            switch (json.requestId) {
            case "1": // Watcher
                // TODO
                break;
            case "2": // Geofence
                this._geofenceCallback(json);
                break;
            }
        });

        ws.on('error', function(e) {
            console.log(e);
        });

        ws.on('close', function() {
            console.log("connection close:" + ws._connectionId);
            connections = connections.filter(function (conn, index) {
                return conn._connectionId !== ws._connectionId;
            });
        });
    });
};

model.initialize(function(isLoaded) {
    isLoaded ? startWebSocketServer() : httpServer.close();
});

// GET
app.get('/connections', function(req, res) {
    model.connections(req, res, connections);
});
app.get('/connections/:connectionId', function(req, res) {
    model.connections(req, res, connections);
});
app.get("/salt", model.salt);
app.get("/geofence/data", model.getGeofenceData);
app.get("/geofence/status", function(req, res) {
    model.getGeofenceStatus(req, res, connections);
});

// POST
app.post("/auth", model.auth);
app.post("/register/username", model.registerUserName);
app.post("/geofence/log", model.writeGeofenceLog);
