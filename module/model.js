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
    query = require(__dirname + '/query.js');

var conString = process.env.DATABASE_URL || yaml.safeLoad(fs.readFileSync('config/config.yml', 'utf8')).conString;
var authenticated = [];
var appConst = {
    applicationType: {
        main: "1", watcher: "2"
    },
    request: {
        watcher: 1, geofence: 2, main: 3
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

var isAuthenticated = function(authKey) {
    return authKey in authenticated;
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

    isAuthenticated: function(authKey) {
        return authKey in authenticated;
    },

    salt: function(req, res) {
        var saltName = req.query.name;

        if (!/^[1-9a-zA-Z]+$/.test(saltName)) {
            writeResponse(res, 200, {'salt':''});
            return;
        }

        createResponse(query.salt, [saltName], function(status, result) {
            writeResponse(res, status, {'salt': result.rows.length === 1 ? result.rows[0].salt : ''});
        });
    },

    auth: function(req, res) {
        var authKey = req.body.authKey;
        if (isAuthenticated(authKey)) {
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

    updateSetting: function(req, res) {
        var authKey = req.body.authKey;
        var userName = req.body.userName;
        var locPermission = req.body.locPermission;

        if (!isAuthenticated(authKey)) {
            writeResponse(res, 403);
            return;
        }

        if (!/^[1-9a-zA-Z_-]{1,20}$/.test(userName) || !/^[0,1]$/.test(locPermission)) {
            writeResponse(res, 404);
            return;
        }

        createResponse(query.registerUserName, [userName, locPermission, authKey], function(status) {
            writeResponse(res, status);
        });
    },

    getGeofenceData: function(req, res) {
        var authKey = req.query.authKey;
        var json = {'data': ""};

        if (!isAuthenticated(authKey)) {
            writeResponse(res, 200, json);
            return;
        }

        createResponse(query.geofenceData, [authKey], function(status, result) {
            json['data'] = result.rows;
            writeResponse(res, status, json);
        });
    },

    getLocation: function(req, res, connections) {
        var userName = req.query.userName;

        if (!/^[1-9a-zA-Z_-]{1,20}$/.test(userName)) {
            writeResponse(res, 404);
            return;
        }

        createResponse(query.userInfo, [userName], function(status, result) {
            if (result.rows.length === 0) {
                writeResponse(res, 404);
                return;
            }

            var userInfo = result.rows[0];
            if (!isAuthenticated(userInfo.authkey)) {
                writeResponse(res, 403);
                return;
            }

            var connection = null;
            for (var i = 0; i < connections.length; i++) {
                if (connections[i]._authKey === userInfo.authkey && userInfo.locpermission === 1) {
                    connection = connections[i];
                    break;
                }
            }

            if (connection === null) {
                writeResponse(res, 404);
                return;
            }

            connection._geofenceCallback = function(location) {
                delete this._errorCallback;
                writeResponse(res, 200, {
                    'lng': location.lng,
                    'lat': location.lat
                });
            };

            connection._errorCallback = function(status) {
                writeResponse(res, status);
            };

            // 位置情報取得リクエストをAndroid端末に送信
            var json = {authKey: connection._authKey, requestId: appConst.request.geofence};
            connection.send(JSON.stringify(json));
        });
    },

    getGeofenceStatus: function(req, res) {
        var authKey = req.query.authKey;
        var transitionType = req.query.transitionType;

        if (!isAuthenticated(authKey)) {
            writeResponse(res, 403);
            return;
        }

        if (!/^(?:1|2|4)$/.test(transitionType)) {
            writeResponse(res, 404);
            return;
        }

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
                    'stay': result.rows[0].notifystay
                };
            }
            writeResponse(res, status, json);
        });
    },

    writeGeofenceLog: function(req, res) {
        var authKey = req.body.authKey;
        var placeId = req.body.placeId;
        var transitionType = req.body.transitionType;

        if (!isAuthenticated(authKey)) {
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
