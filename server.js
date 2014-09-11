/**
 * server.js
 * version: 0.0.1 (2014/08/24)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2013, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
var WebSocketServer = require('ws').Server,
    http = require('http'),
    express = require('express'),
    app = express(),
    pg = require('pg'),
    port = process.env.PORT || 9224;

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

// load authkey list
var authenticated = {};

// PostgreSQL
var conString = process.env.DATABASE_URL;
pg.connect(conString, function(err, client, done) {
    var closeServer = function(err) {
        console.log(err);
        httpServer.close();
    };

    // DB接続失敗
    if (err) {
        closeServer(err);
        return;
    }

    var sql = "SELECT UserID, AuthKey FROM M_Auth";
    client.query(sql, "", function(err, result) {
        done();
        if (err) {
            closeServer(err);
            return;
        }

        for (var i = 0, len = result.rows.length; i < len; i++) {
            authenticated[result.rows[i].authkey] = result.rows[i].userid;
        }

        console.log(authenticated);
    });
});


// WebSocket Connection
var connections = [];
wsServer.on('connection', function(ws) {
    var authKey = ws.upgradeReq.headers['x-imadoko-authkey'];
    // Android側からの接続は認証情報を格納する
    // 認証情報が取れない場合は、ブラウザからの閲覧専用ユーザとする
    if (authKey) {
        ws._authKey = authKey;
        ws._userId = authenticated[authKey];
    }
    connections.push(ws);

    var close = function() {
        console.log("websocket connection close.");
        connections = connections.filter(function (conn, index) {
            return conn !== ws;
        });
    };

    ws.on('message', function(data) {
        var json = JSON.parse(data);
        // polling_from_android
        // Androidからのポーリングリクエストは認証キーが必須
        if (json.status === 'polling_from_android') {
            if (!authenticated[json.authKey]) {
                close();
            }
            console.log("polling request from android");
        }
        // polling
        // 閲覧ユーザ(ブラウザ)からのポーリングリクエストは認証キーを必要としない
        else if (json.status === 'polling') {
            console.log("polling request");
        } else if (json.status === 'getPosition') {
            // TODO 認証キーからどのクライアントに送るかを判断する必要がある
            // 全員の位置を≈更新したい場合のみbroadcastを使う
            var userId = json.userId;
            if (userId) {
                connections.forEach(function(connection) {
                    if (connection._userId === userId) {
                        // 位置情報取得リクエストをAndroid端末に送信

                        // TODO
                        connection.send("hogehoge");
                        return;
                    }
                });
            }
        }
    });

    ws.on('close', close);
});

// WebSocket send
var broadcast = function(message) {
    connections.forEach(function (connection, index) {
        connection.send(message);
    });
};

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
