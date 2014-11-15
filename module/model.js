/**
 * model.js
 * version: 0.0.1 (2014/11/15)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2014, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
'use strict';

var pg = require('pg'),
    fs = require('fs'),
    yaml = require('js-yaml'),
    sha1 = require('sha1'),
    query = require(__dirname + '/query.js');

var conString = process.env.DATABASE_URL || yaml.safeLoad(fs.readFileSync('config/config.yml', 'utf8')).conString;
var authenticated = [];
var appConst = {
    applicationType: {
        main: "1", watcher: "2"
    },
    request: {
        watcher: 1, geofence: 2
    },
    salt: "imadoko-salt"
};

var writeResponse = function(res, status, json) {
    if (json) {
        res.set('Content-Type', 'application/json')
            .status(status)
            .send(JSON.stringify(json))
            .end();
    } else {
        res.status(status).end();
    }
};

var createResponse = function(sql, bind, response) {
    pg.connect(conString, function(err, client, done) {
        if (err) {
            response(500);
            return;
        }

        client.query(sql, bind, function(err, result) {
            done();
            if (err) {
                response(500);
                return;
            }

            response(200, result);
        });
    });
};

module.exports = {
    initialize: function(callback) {
        pg.connect(conString, function(err, client, done) {
            if (err) {
                callback(false);
                return;
            }

            client.query(query.authMaster, [], function(err, result) {
                done();
                if (err) {
                    callback(false);
                    return;
                }
                for (var i = 0, len = result.rows.length; i < len; i++) {
                    authenticated[result.rows[i].authkey] = result.rows[i].username;
                }

                console.log("authenticated list loaded.");
                callback(true);
            });
        });
    },

    getUserId: function(authKey) {
        return authenticated[authKey];
    },

    appConst: function() {
        return appConst;
    },

    salt: function(req, res) {
        createResponse(query.salt, [], function(status, result) {
            writeResponse(res, status, {'salt': result.rows[0].salt});
        });
    },

    auth: function(req, res) {
        var authKey = req.body.authKey;
        if (authenticated[authKey]) {
            console.log("authenticate ok");
            res.status(200).end();
        } else {
            console.log("authenticate ng");
            res.status(403).end();
        }
    },

    connections: function(req, res, connections) {
        var connectionInfo = {connections: []};
        connections.forEach(function (connection) {
            connectionInfo.connections.push({
                applicationType: connection._applicationType,
                connectionId: connection._connectionId
            });
        });
        writeResponse(res, 200, connectionInfo);
    },

    connection: function(req, res, connections) {
        // 0: 切断、1: 接続
        var connectionInfo = {status: 0};
        connections.forEach(function (connection) {
            if (connection._connectionId === req.param("connectionId")) {
                connectionInfo.status = 1;
            }
        });
        writeResponse(res, 200, connectionInfo);
    },

    registerUserName: function(req, res) {
        var authKey = req.body.authKey;
        var userName = req.body.userName;

        if (!authenticated[authKey]) {
            writeResponse(res, 403);
            return;
        }

        if (!/^[1-9a-zA-Z_-]{1,20}$/.test(userName)) {
            writeResponse(res, 404);
            return;
        }

        createResponse(query.registerUserName, [userName, authKey], function(status) {
            writeResponse(res, status);
        });
    },

    getGeofenceData: function(req, res) {
        var authKey = req.query.authKey;
        var json = {'data': ""};

        if (!authenticated[authKey]) {
            writeResponse(res, 200, json);
            return;
        }

        createResponse(query.geofenceData, [authKey], function(status, result) {
            json['data'] = result.rows;
            writeResponse(res, status, json);
        });
    },

    getGeofenceStatus: function(req, res, connections) {
        var authKey = req.query.authKey;
        var transitionType = req.query.transitionType;

        if (!authenticated[authKey]) {
            writeResponse(res, 403);
            return;
        }

        var connection = null;
        for (var i = 0; i < connections.length; i++) {
            if (connections[i]._applicationType === appConst.applicationType.main && connections[i]._authKey === authKey) {
                connection = connections[i];
                if (!connection.hasOwnProperty("_senderId") || connection._senderId === null) {
                    connection._senderId = sha1(Math.random().toString(36));
                }
                break;
            }
        }

        if (connection === null) {
            writeResponse(res, 404);
            return;
        }

        connection._geofenceCallback = function(location) {
            createResponse(query.geofenceStatus, [authKey, transitionType, authKey], function(status, result) {
                var json = {};
                if (result.rows.length > 0) {
                    json = {
                        'prevPlaceId': result.rows[0].placeid,
                        'prevTransitionType': result.rows[0].prevtransitiontype,
                        'recentTransitionType': result.rows[0].recenttransitiontype,
                        'expired': result.rows[0].expired,
                        'in': result.rows[0].notifyin,
                        'out': result.rows[0].notifyout,
                        'stay': result.rows[0].notifystay,
                        'lng': location.lng,
                        'lat': location.lat
                    };
                }
                writeResponse(res, status, json);
            });
        };

        // 位置情報取得リクエストをAndroid端末に送信
        var json = {authKey: connection._authKey, senderId: connection._senderId, requestId: appConst.request.geofence};
        connection.send(JSON.stringify(json));
    },

    writeGeofenceLog: function(req, res) {
        var authKey = req.body.authKey;
        var placeId = req.body.placeId;
        var transitionType = req.body.transitionType;

        if (!authenticated[authKey]) {
            writeResponse(res, 403);
            return;
        }

        if (!(/^\d+$/.test(placeId) && /^[1-4]$/.test(transitionType))) {
            writeResponse(res, 404);
            return;
        }

        createResponse(query.writeGeofenceLog, [placeId, transitionType, authKey], function(status) {
            writeResponse(res, status);
        });
    }
};
