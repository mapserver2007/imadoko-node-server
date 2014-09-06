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

// WebSocket Connection
var connections = [];
wsServer.on('connection', function(ws) {
    connections.push(ws);
    ws.on('close', function() {
        connections = connections.filter(function (conn, index) {
            return conn !== ws;
        });
    });
});

// WebSocket send
var broadcast = function(message) {
    connections.forEach(function (connection, index) {
        connection.send(message);
    });
};

var authenticated = {};
app.get("/auth", function(req, res) {
    var authKey = req.query.authKey;

    if (authenticated[authKey]) {
        console.log("already authenticated");
        res.status(200).end();
        return;
    }

    // PostgreSQL
    var pg = require('pg');
    var conString = process.env.DATABASE_URL;
    pg.connect(conString, function(err, client, done) {
        var sql = "SELECT UserID FROM M_Auth WHERE AuthKey = $1";
        var bind = [authKey];

        // DB接続失敗
        if (err) {
            res.status(500).end();
            console.log("database error");
        }

        client.query(sql, bind, function(err, result) {
            done();
            if (err) {
                res.status(403).end();
                console.log("authenticate ng");
            }
            if (result.rows.length === 0) {
                console.log("authenticate ng");
                res.status(403).end();
            } else {
                authenticated[authKey] = result.rows[0].userid;
                console.log("authenticate ok");
                res.status(200).end();
            }
        });
    });
});


app.post('/rest/location', function(req, res) {
    var data = {
        lng: req.body.lng,
        lat: req.body.lat
    };

    try {
        broadcast(JSON.stringify(data));
        res.status(200).end();
    }
    catch (e) {
        if (/Cannot call method 'send'/.test(e.message)) {
            console.error("WebSocket connection is required from client.");
            res.status(404).end();
        }
        else {
            console.error(e.stack);
            throw e;
        }
    }
});
