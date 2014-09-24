/**
 * timer.js
 * version: 0.0.1 (2014/09/24)
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2013, Ryuichi TANAKA [mapserver2007@gmail.com]
 */
'use strict';

var cron = require('cron').CronJob;
var job = new cron({
    cronTime: '* * * * *',
    onTick: function() {
        var unixtime = parseInt(new Date() / 1000, 10);
        process.send(unixtime);
    },
    start: true,
    timeZone: "Asia/Tokyo"
});
job.start();