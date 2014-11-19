/**
 * query.js
 * version: 0.0.1 (2014/11/15)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2014, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
'use strict';

var h = require('here').here;

module.exports = {
    authMaster: h(/*
        SELECT UserName, AuthKey FROM M_User
    */).unindent(),

    salt: h(/*
        SELECT Salt FROM M_AuthSalt
    */).unindent(),

    registerUserName: h(/*
        UPDATE M_User SET UserName = $1 WHERE AuthKey = $2
    */).unindent(),

    geofenceData: h(/*
        SELECT G.Id, Longitude AS Lng, Latitude AS Lat, Radius, Address, LandmarkName AS Landmark, U.UserName, U.LocPermission
        FROM M_Geofence AS G
        INNER JOIN M_User AS U ON G.UserId = U.Id WHERE U.AuthKey = $1
    */).unindent(),

    geofenceStatus: h(/*
        SELECT * FROM (
            SELECT LG.Id, MG.NotifyIn, MG.NotifyOut, MG.NotifyStay,
            (CASE WHEN LG.CreatedAt + interval '120 minutes' > now() AT TIME ZONE 'Asia/Tokyo' THEN 0 ELSE 1 END) AS Expired
            FROM M_Geofence AS MG
            INNER JOIN M_User AS U ON MG.UserId = U.Id
            LEFT JOIN L_Geofence AS LG ON MG.UserId = LG.UserId
            WHERE U.AuthKey = $1
            AND (LG.TransitionType IS NULL OR LG.TransitionType = $2)
            ORDER BY LG.Id DESC LIMIT 1 OFFSET 0
        ) AS T1
        CROSS JOIN (
            SELECT (CASE WHEN LG2.TransitionType IS NULL THEN 0 ELSE LG2.TransitionType END) AS PrevTransitionType,
            (CASE WHEN LG2.PlaceId IS NULL THEN 0 ELSE LG2.PlaceId END) AS PlaceId
            FROM M_Geofence AS MG2
            INNER JOIN M_User AS U2 ON MG2.UserId = U2.Id
            LEFT JOIN L_Geofence AS LG2 ON MG2.UserId = LG2.UserId
            WHERE U2.AuthKey = $3
            ORDER BY LG2.Id DESC LIMIT 1 OFFSET 0
        ) AS T2
    */).unindent(),

    writeGeofenceLog: h(/*
        INSERT INTO L_Geofence (UserId, PlaceId, CreatedAt, TransitionType)
        SELECT U.Id, $1, now() AT TIME ZONE 'Asia/Tokyo', $2 FROM M_User AS U
        WHERE U.AuthKey = $3
    */).unindent(),

    userInfo: h(/*
        SELECT Id, AuthKey, LocPermission FROM M_User
        WHERE UserName = $1
    */).unindent()
};
