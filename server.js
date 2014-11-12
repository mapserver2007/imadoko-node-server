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
    fs = require('fs'),
    yaml = require('js-yaml'),
    mailer = require('nodemailer'),
    smtpPool = require('nodemailer-smtp-pool'),
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

// connection clean
var cp = require('child_process');
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
        ws._updatedAt = parseInt(new Date() / 1000, 10);
        ws._connectionId = sha1(authKey + "imadoko-salt");

        // Android側からの接続は認証情報を格納する
        // 認証情報が取れない場合は、ブラウザからの閲覧専用ユーザとする
        if (authKey) {
            var userId = authenticated[authKey];
            if (!userId) {
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
            ws._deviceType = appConst.device.android;
        }
        else {
            ws._deviceType = appConst.device.browser;
        }

        connections.push(ws);

        var sendRequestAndroid = function(json) {
            if (!json.userId) {
                return;
            }

            connections.forEach(function(connection) {
                if (connection._deviceType === appConst.device.android && connection._userId === json.userId) {
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
                if (connection._deviceType === appConst.device.browser && connection._senderId === json.senderId) {
                    // 位置情報取得リクエストをブラウザに送信
                    connection.send(JSON.stringify({lng: json.lng, lat: json.lat, userId: connection._userId}));
                    connection._senderId = null;
                    connection._userId = null;
                    return;
                }
            });
        };

        ws.on("ping", function(data, flags) {
            var isConnected = false;
            var authKey = this._authKey;
            connections.forEach(function(connection) {
                if (connection._authKey == authKey) {
                    isConnected = true;
                    return;
                }
            });

            if (isConnected) {
                this._updatedAt = parseInt(new Date() / 1000, 10);
                console.log("ping from android");
                this.ping();
            } else {
                console.log("connection already closed");
                this.close();
            }
        });

        ws.on('message', function(data) {
            var json = JSON.parse(data);

            if (json.__ping__) {
                console.log("ping from browser");
                this.send(data);
                return;
            }

            console.log(json.requestId);
            switch (json.requestId) {
            case 'send_request_android':
                sendRequestAndroid(json);
                break;
            case 'send_request_browser':
                sendRequestBrowser(json);
                break;
            }
        });

        ws.on('error', function(e) {
            console.log(e);
        });

        ws.on('close', function() {
            console.log("websocket connection close:" + ws._connectionId);
            connections = connections.filter(function (conn, index) {
                return conn._connectionId !== ws._connectionId;
            });
        });
    });
};

// PostgreSQL
// var config = yaml.safeLoad(fs.readFileSync('config/config.yml', 'utf8'));
// var conString = config.debug ? config.conString : process.env.DATABASE_URL;
var conString = process.env.DATABASE_URL;
pg.connect(conString, function(err, client, done) {
    if (err) {
        httpServer.close();
        return;
    }

    var sql = "SELECT UserName, AuthKey FROM M_Auth";
    client.query(sql, "", function(err, result) {
        done();
        if (err) {
            httpServer.close();
            return;
        }
        for (var i = 0, len = result.rows.length; i < len; i++) {
            authenticated[result.rows[i].authkey] = result.rows[i].username;
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

// app.get('/', function(req, res) {
//     res.render('index');
// });

app.get('/connections', function(req, res) {
    var connectionInfo = {connections: []};
    connections.forEach(function (connection) {
        connectionInfo.connections.push({
            deviceType: connection._deviceType,
            connectionId: connection._connectionId
        });
    });
    res.set('Content-Type', 'application/json')
        .status(200)
        .send(JSON.stringify(connectionInfo))
        .end();
});

app.get('/connections/:connectionId', function(req, res) {
    // 0: 切断、1: 接続
    var connectionInfo = {status: 0};
    connections.forEach(function (connection) {
        console.log(req.query.connectionId);
        if (connection._connectionId === req.param("connectionId")) {
            connectionInfo.status = 1;
        }
    });
    res.set('Content-Type', 'application/json')
        .status(200)
        .send(JSON.stringify(connectionInfo))
        .end();
});

app.get("/salt", function(req, res) {
    pg.connect(conString, function(err, client, done) {
        if (err) {
            res.status(500).end();
            return;
        }

        var sql = "SELECT Salt FROM M_AuthSalt";
        client.query(sql, [], function(err, result) {
            done();
            if (err) {
                res.status(500).end();
                return;
            }

            var json = {'salt': result.rows[0].salt};
            res.set('Content-Type', 'application/json')
                .status(200)
                .send(JSON.stringify(json))
                .end();
        });
    });
});

app.post("/auth", function(req, res) {
    var authKey = req.body.authKey;

    if (authenticated[authKey]) {
        console.log("authenticate ok");
        res.status(200).end();
    } else {
        console.log("authenticate ng");
        res.status(403).end();
    }
});

app.get("/geofence/data", function(req, res) {
    var authKey = req.query.authKey;
    var json = {'data': ""};

    if (authenticated[authKey]) {
        pg.connect(conString, function(err, client, done) {
            if (err) {
                res.status(500).end();
                return;
            }

            var sql = "SELECT G.Id, Longitude AS Lng, Latitude AS Lat, Radius, Address, LandmarkName AS Landmark, A.UserName FROM M_Geofence AS G " +
                      "INNER JOIN M_Auth AS A ON G.UserId = A.Id WHERE A.AuthKey = $1";
            var bind = [authKey];
            client.query(sql, bind, function(err, result) {
                done();
                if (err) {
                    res.status(500).end();
                    return;
                }

                json['data'] = result.rows;
                res.set('Content-Type', 'application/json')
                    .status(200)
                    .send(JSON.stringify(json))
                    .end();
            });
        });
    } else {
        res.set('Content-Type', 'application/json')
            .status(200)
            .send(JSON.stringify(json))
            .end();
    }
});

app.get("/geofence/status", function(req, res) {
    var authKey = req.query.authKey;
    var transitionType = req.query.transitionType;

    if (authenticated[authKey]) {
        pg.connect(conString, function(err, client, done) {
            if (err) {
                res.status(500).end();
                return;
            }

            var sql = "SELECT * FROM (" +
                      "    SELECT LG.Id, MG.NotifyIn, MG.NotifyOut, MG.NotifyStay, " +
                      "    (CASE WHEN LG.CreatedAt + interval '120 minutes' > now() AT TIME ZONE 'Asia/Tokyo' THEN 0 ELSE 1 END) AS Expired " + // 前回の同一ステータスから一定時間経過
                      "    FROM M_Geofence AS MG " +
                      "    INNER JOIN M_Auth AS A ON MG.UserId = A.Id " +
                      "    LEFT JOIN L_Geofence AS LG ON MG.UserId = LG.UserId " +
                      "    WHERE A.AuthKey = $1 " +
                      "    AND (LG.TransitionType IS NULL OR LG.TransitionType = $2) " +
                      "    ORDER BY LG.Id DESC LIMIT 1 OFFSET 0" +
                      ") AS T1 " +
                      "CROSS JOIN (" +
                      "    SELECT (CASE WHEN LG2.TransitionType IS NULL THEN 0 ELSE LG2.TransitionType END) AS PrevTransitionType, " +
                      "    (CASE WHEN LG2.PlaceId IS NULL THEN 0 ELSE LG2.PlaceId END) AS PlaceId " +
                      "    FROM M_Geofence AS MG2 " +
                      "    INNER JOIN M_Auth AS A2 ON MG2.UserId = A2.Id " +
                      "    LEFT JOIN L_Geofence AS LG2 ON MG2.UserId = LG2.UserId " +
                      "    WHERE A2.AuthKey = $3 " +
                      "    ORDER BY LG2.Id DESC LIMIT 1 OFFSET 0" +
                      ") AS T2";
            var bind = [authKey, transitionType, authKey];
            client.query(sql, bind, function(err, result) {
                done();
                if (err) {
                    res.status(500).end();
                    return;
                }

                var json = {};
                if (result.rows.length > 0) {
                    json = {
                        'prevPlaceId': result.rows[0].placeid,
                        'prevTransitionType': result.rows[0].prevtransitiontype,
                        'recentTransitionType': result.rows[0].recenttransitiontype,
                        'expired': result.rows[0].expired,
                        'in': result.rows[0].notifyin,
                        'out': result.rows[0].notifyout,
                        'stay': result.rows[0].notifystay
                    };
                }

                res.set('Content-Type', 'application/json')
                    .status(200)
                    .send(JSON.stringify(json))
                    .end();
            });
        });
    } else {
        res.status(403).end();
    }
});

app.post("/geofence/log", function(req, res) {
    var authKey = req.body.authKey;
    var placeId = req.body.placeId;
    var transitionType = req.body.transitionType;

    if (authenticated[authKey] && /^\d+$/.test(placeId) && /^[1-4]$/.test(transitionType)) {
        pg.connect(conString, function(err, client, done) {
            if (err) {
                res.status(500).end();
                return;
            }

            var sql = "INSERT INTO L_Geofence (UserId, PlaceId, CreatedAt, TransitionType) " +
                      "SELECT A.Id, $1, now() AT TIME ZONE 'Asia/Tokyo', $2 FROM M_Auth AS A " +
                      "WHERE A.AuthKey = $3";
            var bind = [placeId, transitionType, authKey];
            client.query(sql, bind, function(err, result) {
                done();
                if (err) {
                    res.status(500).end();
                    return;
                }

                res.status(200).end();
            });
        });
    } else {
        res.status(403).end();
    }
});

app.post("/register/username", function(req, res) {
    var authKey = req.body.authKey;
    var userName = req.body.userName;
    if (authenticated[authKey] && /^[1-9a-zA-Z_-]{1,20}$/.test(userName)) {
        pg.connect(conString, function(err, client, done) {
            if (err) {
                res.status(500).end();
                return;
            }

            var sql = "UPDATE M_Auth SET UserName = $1 WHERE AuthKey = $2";
            var bind = [userName, authKey];
            client.query(sql, bind, function(err, result) {
                done();
                if (err) {
                    res.status(500).end();
                    return;
                }

                res.status(200).end();
            });
        });
    } else {
        res.status(403).end();
    }
});
